import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { signSession } from "../middleware/auth";
import { User, Recipe } from "../models";
import { Resend } from "resend";
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

// --- RESEND AYARLARI ---
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail =
  process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

console.log("📧 [SERVER] Resend Mail Ayarları:");
console.log(`   API Key: ${resendApiKey ? "✅ Var" : "❌ Yok"}`);
console.log(`   From Email: ${resendFromEmail}`);

const resend = new Resend(resendApiKey);

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

    const data = await resend.emails.send({
      from: resendFromEmail || "onboarding@resend.dev",
      to: email,
      subject: "Giriş Kodunuz - Pratik Şef",
      html: `<p>Merhaba,</p><p>Giriş kodunuz: <strong>${code}</strong></p><p>Bu kod 10 dakika geçerlidir.</p>`,
    });

    if (data.error) {
      throw new Error(data.error.message);
    }

    console.log("✅ [SERVER] Mail gönderildi! ID:", data.data?.id || "N/A");
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

// --- DELETE ACCOUNT PAGE (GET) ---
router.get("/delete-account", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hesap Silme - Pratik Şef</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 450px;
      width: 100%;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 25px;
      color: #856404;
      font-size: 14px;
      line-height: 1.5;
    }
    .warning strong {
      display: block;
      margin-bottom: 5px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-weight: 500;
      font-size: 14px;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      margin-top: 10px;
    }
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover:not(:disabled) {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .btn-danger {
      background: #dc3545;
      color: white;
    }
    .btn-danger:hover:not(:disabled) {
      background: #c82333;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(220, 53, 69, 0.4);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .message {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    .message.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
      display: block;
    }
    .message.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
      display: block;
    }
    .step {
      display: none;
    }
    .step.active {
      display: block;
    }
    .code-sent {
      color: #28a745;
      font-size: 13px;
      margin-top: 8px;
      display: none;
    }
    .code-sent.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🗑️ Hesap Silme</h1>
    <p class="subtitle">Hesabınızı kalıcı olarak silmek için aşağıdaki adımları takip edin</p>
    
    <div class="warning">
      <strong>⚠️ Dikkat!</strong>
      Bu işlem geri alınamaz. Tüm tarifleriniz ve verileriniz kalıcı olarak silinecektir.
    </div>

    <div id="message" class="message"></div>

    <div class="step active" id="step1">
      <div class="form-group">
        <label for="email">E-posta Adresiniz</label>
        <input type="email" id="email" placeholder="ornek@email.com" required>
      </div>
      <button class="btn-primary" onclick="requestCode()">Kod Gönder</button>
      <div class="code-sent" id="codeSent">✅ Kod e-posta adresinize gönderildi!</div>
    </div>

    <div class="step" id="step2">
      <div class="form-group">
        <label for="code">Doğrulama Kodu</label>
        <input type="text" id="code" placeholder="123456" maxlength="6" required>
      </div>
      <button class="btn-danger" onclick="deleteAccount()">Hesabı Kalıcı Olarak Sil</button>
      <button class="btn-primary" onclick="backToStep1()" style="margin-top: 10px;">Geri</button>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin + '/api/auth';
    
    function showMessage(text, type) {
      const msgEl = document.getElementById('message');
      msgEl.textContent = text;
      msgEl.className = 'message ' + type;
      setTimeout(() => {
        msgEl.className = 'message';
      }, 5000);
    }

    function showStep(stepNum) {
      document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
      document.getElementById('step' + stepNum).classList.add('active');
    }

    function backToStep1() {
      showStep(1);
      document.getElementById('code').value = '';
    }

    async function requestCode() {
      const email = document.getElementById('email').value.trim();
      if (!email) {
        showMessage('Lütfen e-posta adresinizi girin', 'error');
        return;
      }

      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor...';

      try {
        const res = await fetch(API_BASE + '/delete-account-request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Kod gönderilemedi');
        }

        document.getElementById('codeSent').classList.add('show');
        showMessage('Kod e-posta adresinize gönderildi. Lütfen e-postanızı kontrol edin.', 'success');
        setTimeout(() => {
          showStep(2);
          document.getElementById('code').focus();
        }, 1500);
      } catch (error) {
        showMessage(error.message || 'Bir hata oluştu', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Kod Gönder';
      }
    }

    async function deleteAccount() {
      const email = document.getElementById('email').value.trim();
      const code = document.getElementById('code').value.trim();

      if (!code) {
        showMessage('Lütfen doğrulama kodunu girin', 'error');
        return;
      }

      if (!confirm('Hesabınızı kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!')) {
        return;
      }

      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Siliniyor...';

      try {
        const res = await fetch(API_BASE + '/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Hesap silinemedi');
        }

        showMessage('✅ Hesabınız başarıyla silindi. Sayfa 3 saniye içinde kapanacak...', 'success');
        document.querySelector('.container').innerHTML = 
          '<h1 style="text-align: center; color: #28a745; margin-top: 50px;">✅ Hesabınız Başarıyla Silindi</h1>' +
          '<p style="text-align: center; color: #666; margin-top: 20px;">Tüm verileriniz kalıcı olarak silindi.</p>';
        
        setTimeout(() => {
          window.close();
        }, 3000);
      } catch (error) {
        showMessage(error.message || 'Bir hata oluştu', 'error');
        btn.disabled = false;
        btn.textContent = 'Hesabı Kalıcı Olarak Sil';
      }
    }

    // Enter tuşu ile form gönderme
    document.getElementById('email').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') requestCode();
    });
    document.getElementById('code').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') deleteAccount();
    });
  </script>
</body>
</html>
  `);
});

// --- DELETE ACCOUNT REQUEST CODE ---
router.post("/delete-account-request-code", async (req, res) => {
  console.log("📥 [SERVER] /delete-account-request-code isteği geldi");
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    const email = parsed.data.email.toLowerCase();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    user.deleteCode = code;
    user.deleteCodeExpires = expires;
    await user.save();

    console.log(
      `📤 [SERVER] ${email} adresine hesap silme kodu gönderiliyor...`
    );

    const data = await resend.emails.send({
      from: resendFromEmail || "onboarding@resend.dev",
      to: email,
      subject: "Hesap Silme Kodunuz - Pratik Şef",
      html: `<p>Merhaba,</p><p>Hesabınızı silmek için kodunuz: <strong>${code}</strong></p><p>Bu kod 10 dakika geçerlidir.</p><p><strong>Dikkat:</strong> Bu işlem geri alınamaz. Tüm tarifleriniz ve verileriniz kalıcı olarak silinecektir.</p>`,
    });

    if (data.error) {
      throw new Error(data.error.message);
    }

    console.log(
      "✅ [SERVER] Hesap silme kodu gönderildi! ID:",
      data.data?.id || "N/A"
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error("❌ [SERVER] Mail Gönderme Hatası:", e);
    res.status(500).json({ error: e?.message || "Mail gönderilemedi" });
  }
});

const deleteAccountSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});

// --- DELETE ACCOUNT ---
router.post("/delete-account", async (req, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  try {
    const email = parsed.data.email.toLowerCase();
    const code = parsed.data.code;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Böyle bir hesap bulunmuyor" });
    }

    if (!user.deleteCode || !user.deleteCodeExpires) {
      return res.status(401).json({ error: "Kod geçersiz" });
    }

    if (
      user.deleteCode !== code ||
      user.deleteCodeExpires.getTime() < Date.now()
    ) {
      return res
        .status(401)
        .json({ error: "Hatalı kod veya kod süresi dolmuş" });
    }

    // Kullanıcının tüm tariflerini sil
    const userId = user._id;
    await Recipe.deleteMany({ userId });

    // Kullanıcıyı sil
    await User.deleteOne({ _id: userId });

    console.log(`✅ [SERVER] ${email} hesabı ve tüm verileri silindi`);

    res.json({ ok: true, message: "Hesabınız başarıyla silindi" });
  } catch (e: any) {
    console.error("❌ [SERVER] Hesap silme hatası:", e);
    res.status(500).json({ error: e?.message || "Hesap silinemedi" });
  }
});

export default router;
