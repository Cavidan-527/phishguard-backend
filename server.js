const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

let stats = { sent: 0, clicks: 0, lastPreviewUrl: null, logs: [] };

// ⚠️ DİQQƏT: Ethereal.email/create saytından aldığın məlumatları bura yaz!
const ETHEREAL_USER = 'katelin.price27@ethereal.email'; 
const ETHEREAL_PASS = 'nWY4XAFg9pjaUYEVjD';

// Artıq donma olmayacaq, çünki hazır hesabdan istifadə edirik
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
    user: ETHEREAL_USER,
    pass: ETHEREAL_PASS
  }
});

// Doğru Vercel linkin
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
    console.error("Xəta:", err);
    res.status(500).json({ error: 'E-poçt göndərilmədi: ' + err.message });
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
