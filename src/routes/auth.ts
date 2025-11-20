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

const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const transporter = nodemailer.createTransport({
  host: smtpHost || "smtp.gmail.com",
  port: smtpPort,
  secure: false,
  auth: { user: smtpUser, pass: smtpPass },
});

const requestSchema = z.object({ email: z.string().email() });
router.post("/request-code", async (req, res) => {
  const startTime = Date.now();
  console.log("📥 [SERVER] /request-code endpoint'ine istek geldi");
  console.log("📥 [SERVER] Request body:", JSON.stringify(req.body, null, 2));
  console.log("📥 [SERVER] Request headers:", {
    "content-type": req.headers["content-type"],
    "user-agent": req.headers["user-agent"],
  });

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("❌ [SERVER] Schema validation başarısız:", parsed.error);
    return res.status(400).json({ error: "Invalid email" });
  }
  console.log("✅ [SERVER] Schema validation başarılı");

  try {
    const email = parsed.data.email.toLowerCase();
    console.log("📧 [SERVER] Email:", email);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    console.log("🔐 [SERVER] Oluşturulan kod:", code);

    const expires = new Date(Date.now() + 10 * 60 * 1000);
    console.log("⏰ [SERVER] Kod geçerlilik süresi:", expires.toISOString());

    console.log("🔍 [SERVER] Kullanıcı aranıyor...");
    let user = await User.findOne({ email });
    if (!user) {
      console.log(
        "👤 [SERVER] Kullanıcı bulunamadı, yeni kullanıcı oluşturuluyor..."
      );
      user = await User.create({ email, googleId: `email_${Date.now()}` });
      console.log("✅ [SERVER] Yeni kullanıcı oluşturuldu:", user._id);
    } else {
      console.log("👤 [SERVER] Mevcut kullanıcı bulundu:", user._id);
    }

    user.loginCode = code;
    user.loginCodeExpires = expires;
    console.log("💾 [SERVER] Kullanıcı bilgileri güncelleniyor...");
    await user.save();
    console.log("✅ [SERVER] Kullanıcı bilgileri kaydedildi");

    try {
      console.log("📧 [SERVER] SMTP bağlantısı kontrol ediliyor...");
      await transporter.verify();
      console.log("✅ [SERVER] SMTP bağlantısı başarılı");

      console.log("📧 [SERVER] E-posta gönderiliyor...");
      console.log("📧 [SERVER] E-posta detayları:", {
        from: smtpUser,
        to: email,
        subject: "Giris Kodu",
      });
      await transporter.sendMail({
        from: smtpUser,
        to: email,
        subject: "Giris Kodu",
        text: `Giris kodunuz: ${code}`,
      });
      console.log("✅ [SERVER] E-posta başarıyla gönderildi");

      const elapsed = Date.now() - startTime;
      console.log(`✅ [SERVER] İstek başarıyla tamamlandı (${elapsed}ms)`);
      res.json({ ok: true });
    } catch (e: any) {
      const elapsed = Date.now() - startTime;
      console.error(`❌ [SERVER] E-posta gönderme hatası (${elapsed}ms):`, e);
      console.error("❌ [SERVER] Hata mesajı:", e?.message);
      console.error("❌ [SERVER] Hata stack:", e?.stack);
      res.status(500).json({ error: e?.message || "Send failed" });
    }
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [SERVER] Genel hata (${elapsed}ms):`, e);
    console.error("❌ [SERVER] Hata mesajı:", e?.message);
    console.error("❌ [SERVER] Hata stack:", e?.stack);
    res.status(500).json({ error: e?.message || "Send failed" });
  }
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});
router.post("/verify-code", async (req, res) => {
  const startTime = Date.now();
  console.log("📥 [SERVER] /verify-code endpoint'ine istek geldi");
  console.log("📥 [SERVER] Request body:", JSON.stringify(req.body, null, 2));

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("❌ [SERVER] Schema validation başarısız:", parsed.error);
    return res.status(400).json({ error: "Invalid input" });
  }
  console.log("✅ [SERVER] Schema validation başarılı");

  try {
    const email = parsed.data.email.toLowerCase();
    const code = parsed.data.code;
    console.log("📧 [SERVER] Email:", email);
    console.log("🔐 [SERVER] Girilen kod:", code);

    console.log("🔍 [SERVER] Kullanıcı aranıyor...");
    const user = await User.findOne({ email });
    if (!user || !user.loginCode || !user.loginCodeExpires) {
      console.error("❌ [SERVER] Kullanıcı bulunamadı veya kod yok");
      return res.status(401).json({ error: "Invalid code" });
    }
    console.log("👤 [SERVER] Kullanıcı bulundu:", user._id);
    console.log("🔐 [SERVER] Kayıtlı kod:", user.loginCode);
    console.log(
      "⏰ [SERVER] Kod geçerlilik süresi:",
      user.loginCodeExpires.toISOString()
    );
    console.log("⏰ [SERVER] Şu anki zaman:", new Date().toISOString());

    if (
      user.loginCode !== code ||
      user.loginCodeExpires.getTime() < Date.now()
    ) {
      console.error("❌ [SERVER] Kod doğrulama başarısız");
      console.error("❌ [SERVER] Kod eşleşmesi:", user.loginCode === code);
      console.error(
        "❌ [SERVER] Kod geçerliliği:",
        user.loginCodeExpires.getTime() >= Date.now()
      );
      return res.status(401).json({ error: "Invalid code" });
    }
    console.log("✅ [SERVER] Kod doğrulandı");

    user.loginCode = undefined as any;
    user.loginCodeExpires = undefined as any;
    console.log("💾 [SERVER] Kullanıcı kod bilgileri temizleniyor...");
    await user.save();
    console.log("✅ [SERVER] Kullanıcı bilgileri güncellendi");

    console.log("🔑 [SERVER] Token oluşturuluyor...");
    const token = signSession({
      id: String(user._id),
      email: user.email,
      name: user.name || undefined,
      avatar: user.avatar || undefined,
    });
    console.log("✅ [SERVER] Token oluşturuldu");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [SERVER] İstek başarıyla tamamlandı (${elapsed}ms)`);
    res.json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [SERVER] Genel hata (${elapsed}ms):`, e);
    console.error("❌ [SERVER] Hata mesajı:", e?.message);
    console.error("❌ [SERVER] Hata stack:", e?.stack);
    res.status(500).json({ error: "Verify failed" });
  }
});

export default router;
