import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { signSession } from "../middleware/auth";
import { User } from "../models";
import nodemailer from "nodemailer";
import { z } from "zod";

const router = Router();
const clientId = process.env.GOOGLE_CLIENT_ID || "";
const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || "";
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || "";
const oauthClient = new OAuth2Client(clientId);

// --- GOOGLE LOGIN ---
router.post("/google", async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) return res.status(400).json({ error: "Missing idToken" });
  try {
    const audiences = [clientId, androidClientId, iosClientId].filter(
      (a) => a && a.length > 0
    );
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: audiences.length === 1 ? audiences[0] : audiences,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email)
      return res.status(401).json({ error: "Invalid token" });
    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      {
        $setOnInsert: { googleId: payload.sub },
        email: payload.email,
        name: payload.name || null,
        avatar: payload.picture || null,
      },
      { new: true, upsert: true }
    );
    const token = signSession({
      id: String(user!._id),
      email: user!.email,
      name: user!.name || undefined,
      avatar: user!.avatar || undefined,
    });
    res.json({
      token,
      user: {
        id: String(user!._id),
        email: user!.email,
        name: user!.name,
        avatar: user!.avatar,
      },
    });
  } catch (e) {
    res.status(401).json({ error: "Token verification failed" });
  }
});

// --- SMTP AYARLARI (SİHİRLİ GMAIL MODU) ---
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s/g, "");

console.log("📧 [SERVER] Mail Ayarları (Servis Modu):");
console.log(`   Service: Gmail`);
console.log(`   User: ${smtpUser ? "✅ Var" : "❌ Yok"}`);

// KANKA DİKKAT: Host/Port yerine direkt 'service: gmail' kullanıyoruz.
const transporter = nodemailer.createTransport({
  service: "gmail", // <--- BU SATIR HAYAT KURTARIR
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

// Sunucu başlarken bağlantıyı test et
transporter
  .verify()
  .then(() =>
    console.log("✅ [SERVER] SMTP Bağlantısı BAŞARILI! (Gmail Service)")
  )
  .catch((err) => {
    console.error("🔥 [SERVER] SMTP Bağlantı Hatası:", err);
  });

const requestSchema = z.object({ email: z.string().email() });

// --- REQUEST CODE ---
router.post("/request-code", async (req, res) => {
  console.log("📥 [SERVER] /request-code isteği geldi");
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    const email = parsed.data.email.toLowerCase();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, googleId: `email_${Date.now()}` });
    }

    user.loginCode = code;
    user.loginCodeExpires = expires;
    await user.save();

    console.log(`📤 [SERVER] ${email} adresine mail gönderiliyor...`);

    const info = await transporter.sendMail({
      from: `"Pratik Şef" <${smtpUser}>`,
      to: email,
      subject: "Giriş Kodunuz - Pratik Şef",
      text: `Kodunuz: ${code}`,
      html: `<b>Kodunuz: ${code}</b>`,
    });

    console.log("✅ [SERVER] Mail gönderildi! ID:", info.messageId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("❌ [SERVER] Mail Gönderme Hatası:", e);
    res.status(500).json({ error: e?.message || "Mail gönderilemedi" });
  }
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});

// --- VERIFY CODE ---
router.post("/verify-code", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  try {
    const email = parsed.data.email.toLowerCase();
    const code = parsed.data.code;

    const user = await User.findOne({ email });
    if (!user || !user.loginCode || !user.loginCodeExpires) {
      return res.status(401).json({ error: "Kod geçersiz" });
    }

    if (
      user.loginCode !== code ||
      user.loginCodeExpires.getTime() < Date.now()
    ) {
      return res.status(401).json({ error: "Hatalı kod" });
    }

    user.loginCode = undefined as any;
    user.loginCodeExpires = undefined as any;
    await user.save();

    const token = signSession({
      id: String(user._id),
      email: user.email,
      name: user.name || undefined,
      avatar: user.avatar || undefined,
    });

    res.json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Verify failed" });
  }
});

export default router;
