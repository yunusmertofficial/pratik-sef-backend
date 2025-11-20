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

// --- SMTP AYARLARI (RENDER İLE UYUMLU) ---
// Ortam değişkenlerini zorluyoruz, yoksa varsayılanları kullanıyoruz
const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
const smtpPort = parseInt(process.env.SMTP_PORT || "465"); // String'i sayıya çeviriyoruz
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s/g, ""); // Boşlukları temizle
const isSecure = process.env.SECURE === "true" || smtpPort === 465; // 465 ise secure true olmalı

console.log("📧 [SERVER] Mail Ayarları Başlatılıyor...");
console.log(`   Host: ${smtpHost}`);
console.log(`   Port: ${smtpPort}`);
console.log(`   Secure: ${isSecure}`);
console.log(`   User: ${smtpUser ? "✅ Var" : "❌ Yok"}`);
console.log(
  `   Pass: ${
    smtpPass ? "✅ Var (Uzunluk: " + smtpPass.length + ")" : "❌ Yok"
  }`
);

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: isSecure, // SSL (465 için true, 587 için false)
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  tls: {
    // Render'da bazen sertifika zinciri hatası olur, bunu yok sayıyoruz
    rejectUnauthorized: false,
  },
});

// Sunucu başlarken bağlantıyı test et
transporter
  .verify()
  .then(() =>
    console.log("✅ [SERVER] SMTP Bağlantısı BAŞARILI! Mail atabilirim.")
  )
  .catch((err) => {
    console.error("🔥 [SERVER] SMTP Bağlantı Hatası:", err);
    // Hata olsa bile sunucuyu çökertmiyoruz, sadece logluyoruz
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

    // Kullanıcıyı bul veya oluştur
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, googleId: `email_${Date.now()}` });
    }

    user.loginCode = code;
    user.loginCodeExpires = expires;
    await user.save();

    console.log(`📤 [SERVER] ${email} adresine mail gönderiliyor...`);

    // Mail Gönderme
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
    // Hatayı detaylı olarak logluyoruz ki Render'da görelim
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
      return res.status(401).json({ error: "Hatalı veya süresi dolmuş kod" });
    }

    // Temizlik
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
