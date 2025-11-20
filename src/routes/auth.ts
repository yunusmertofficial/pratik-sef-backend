import { Router } from "express"
import { OAuth2Client } from "google-auth-library"
import { signSession } from "../middleware/auth"
import { User } from "../models"
import nodemailer from "nodemailer"
import { z } from "zod"

const router = Router()
const clientId = process.env.GOOGLE_CLIENT_ID || ""
const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || ""
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || ""
const oauthClient = new OAuth2Client(clientId)

router.post("/google", async (req, res) => {
  const { idToken } = req.body as { idToken?: string }
  if (!idToken) return res.status(400).json({ error: "Missing idToken" })
  try {
    const audiences = [clientId, androidClientId, iosClientId].filter(a => a && a.length > 0)
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: audiences.length === 1 ? audiences[0] : audiences })
    const payload = ticket.getPayload()
    if (!payload?.sub || !payload.email) return res.status(401).json({ error: "Invalid token" })
    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      { $setOnInsert: { googleId: payload.sub }, email: payload.email, name: payload.name || null, avatar: payload.picture || null },
      { new: true, upsert: true }
    )
    const token = signSession({ id: String(user!._id), email: user!.email, name: user!.name || undefined, avatar: user!.avatar || undefined })
    res.json({ token, user: { id: String(user!._id), email: user!.email, name: user!.name, avatar: user!.avatar } })
  } catch (e) {
    res.status(401).json({ error: "Token verification failed" })
  }
})

const smtpHost = process.env.SMTP_HOST || ""
const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587
const smtpUser = process.env.SMTP_USER || ""
const smtpPass = process.env.SMTP_PASS || ""
const transporter = nodemailer.createTransport({ host: smtpHost || "smtp.gmail.com", port: smtpPort, secure: false, auth: { user: smtpUser, pass: smtpPass } })

const requestSchema = z.object({ email: z.string().email() })
router.post("/request-code", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid email" })
  try {
    const email = parsed.data.email.toLowerCase()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expires = new Date(Date.now() + 10 * 60 * 1000)
    let user = await User.findOne({ email })
    if (!user) user = await User.create({ email, googleId: `email_${Date.now()}` })
    user.loginCode = code
    user.loginCodeExpires = expires
    await user.save()
    try {
      await transporter.verify()
      await transporter.sendMail({ from: smtpUser, to: email, subject: "Giris Kodu", text: `Giris kodunuz: ${code}` })
      res.json({ ok: true })
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Send failed" })
    }
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Send failed" })
  }
})

const verifySchema = z.object({ email: z.string().email(), code: z.string().min(4).max(8) })
router.post("/verify-code", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" })
  try {
    const email = parsed.data.email.toLowerCase()
    const code = parsed.data.code
    const user = await User.findOne({ email })
    if (!user || !user.loginCode || !user.loginCodeExpires) return res.status(401).json({ error: "Invalid code" })
    if (user.loginCode !== code || user.loginCodeExpires.getTime() < Date.now()) return res.status(401).json({ error: "Invalid code" })
    user.loginCode = undefined as any
    user.loginCodeExpires = undefined as any
    await user.save()
    const token = signSession({ id: String(user._id), email: user.email, name: user.name || undefined, avatar: user.avatar || undefined })
    res.json({ token, user: { id: String(user._id), email: user.email, name: user.name, avatar: user.avatar } })
  } catch {
    res.status(500).json({ error: "Verify failed" })
  }
})

export default router