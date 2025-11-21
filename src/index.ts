import "dotenv/config";
import express from "express";
import cors from "cors";
import auth from "./routes/auth";
import recipes from "./routes/recipes";
import { connectMongo } from "./db";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/privacy-policy", (_req, res) => {
  const policyHtml = `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <title>Pratik Şef Gizlilik Politikası</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 30px auto; padding: 0 20px; }
        h2 { border-bottom: 2px solid #ea580c; padding-bottom: 5px; margin-top: 30px; color: #333; }
        .highlight { font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Gizlilik Politikası</h1>
      <p>Bu politika, Pratik Şef mobil uygulamasının topladığı, kullandığı ve koruduğu kişisel verileri açıklamaktadır.</p>

      <h2>1. Toplanan Veri Türleri</h2>
      <p>Uygulamamız, aşağıdaki kullanıcı verilerini toplamaktadır:</p>
      <ul>
        <li><span class="highlight">Kimlik Bilgileri:</span> E-posta adresi (Giriş ve iletişim amacıyla).</li>
        <li><span class="highlight">Uygulama Verileri:</span> Kaydedilen tarifler, tarif üretmek için girilen malzemeler ve kullanım tercihleri.</li>
      </ul>

      <h2>2. Verilerin Kullanımı</h2>
      <p>Toplanan veriler, yalnızca hesabınızı yönetmek, size özel tarifler üretmek ve uygulama deneyiminizi kişiselleştirmek amacıyla kullanılır.</p>

      <h2>3. Veri Güvenliği ve Şifreleme</h2>
      <p>Uygulamamız ile sunucumuz arasındaki tüm veri akışı (HTTPS) ile şifrelenmektedir.</p>

      <h2>4. Veri Silme Talebi</h2>
      <p>Kullanıcılar, hesaplarının ve tüm kişisel verilerinin silinmesini istedikleri takdirde, aşağıdaki adrese giderek bu işlemi gerçekleştirebilirler:</p>
      <p>
        <span class="highlight">Hesap Silme Adresi:</span> <a href="/api/auth/delete-account">/api/auth/delete-account</a>
        <br>
        (Bu linkteki formu doldurarak e-posta onayı ile hesabınızı kalıcı olarak silebilirsiniz.)
      </p>

      <p style="margin-top: 50px; font-size: 0.9em; color: #666;">Son Güncelleme: 21 Kasım 2025</p>
    </body>
    </html>
  `;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(policyHtml);
});

app.use("/api/auth", auth);
app.use("/api", recipes);

const port = process.env.PORT ? parseInt(process.env.PORT) : 4000;
app.listen(port, () => {});
connectMongo().catch((e) => {
  console.error("MongoDB connection failed:", e?.message || e);
});
