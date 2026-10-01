const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

let stats = { sent: 0, clicks: 0, lastPreviewUrl: null, logs: [] };

let transporter;

// Ethereal hesabını sadəcə 1 dəfə yaradırıq, donmasın deyə
nodemailer.createTestAccount().then((acc) => {
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: { user: acc.user, pass: acc.pass }
  });
}).catch(console.error);

// Doğru Vercel linki (mauve)
const LANDING_URL = 'https://phishguard-mauve.vercel.app/landing';

const TEMPLATES = {
  it_password: {
    subject: '🚨 TƏCİLİ: Korporativ IT Şifrənizin Müddəti Bitir',
    title: 'Korporativ IT Portalı',
    text: 'Şifrənizin istifadə müddəti 24 saat ərzində bitir. Giriş imkanını itirməmək üçün şifrənizi təcili yeniləyin.',
    btn: 'Şifrəni İndi Yenilə'
  }
};

app.get('/api/stats', (req, res) => res.json(stats));

app.post('/api/send', async (req, res) => {
  const { email, template } = req.body;
  if (!email) return res.status(400).json({ error: 'Email lazımdır' });

  // Ethereal donubsa, qısa xəta verib çıxır (Səhifəni dondurmur)
  if (!transporter) return res.status(500).json({ error: 'Ethereal serveri donub, 1 dəqiqə sonra yoxlayın.' });

  const tpl = TEMPLATES[template] || TEMPLATES.it_password;

  try {
    const info = await transporter.sendMail({
      from: '"İT Dəstək" <security@sirket-portal.az>',
      to: email,
      subject: tpl.subject,
      html: `
        <div style="font-family: Arial; padding: 20px; border: 1px solid #ddd; max-width: 500px;">
          <h2>${tpl.title}</h2>
          <p>${tpl.text}</p>
          <a href="${LANDING_URL}" style="background: #2563eb; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            ${tpl.btn}
          </a>
        </div>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    
    stats.sent += 1;
    stats.logs.unshift({ id: Date.now(), email, time: new Date().toISOString(), statusLabel: 'Göndərildi' });

    res.json({ success: true, previewUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/track', (req, res) => {
  const { email } = req.body;
  stats.clicks += 1;
  const log = stats.logs.find(l => l.email === email);
  if (log) log.statusLabel = '⚠️ Klikləndi';
  res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server ${PORT} portundadır.`));
