const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Yaddaşda saxlanılan statistika məlumatları
let stats = {
  sent: 0,
  clicks: 0,
  lastPreviewUrl: '',
  logs: []
};

let transporter;

// Ethereal Saxta SMTP Hesabının yaradılması
nodemailer.createTestAccount((err, account) => {
  if (err) {
    console.error('Ethereal hesabı yaradıla bilmədi:', err);
    return;
  }
  transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.pass
    }
  });
  console.log('Ethereal SMTP Xidməti Hazırdır!');
});

// API: Statistikanı almaq
app.get('/api/stats', (req, res) => {
  res.json(stats);
});

// API: Fişinq simulyasiya e-poçtu göndərmək
app.post('/api/send', async (req, res) => {
  const { email, template } = req.body;

  if (!transporter) {
    return res.status(500).json({ error: 'SMTP xidməti hələ başladılır, 5 saniyə sonra yenidən cəhd edin.' });
  }

  try {
    const mailOptions = {
      from: '"IT Security Support" <security@company.com>',
      to: email || 'user@example.com',
      subject: '🚨 Təcili: Hesabınızın Təhlükəsizlik Yenilənməsi',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px;">
            <h2 style="color: #d9534f;">Hesabınız Bloklana Bilər!</h2>
            <p>Hörmətli əməkdaş,</p>
            <p>Şirkətimizin təhlükəsizlik siyasətinə əsasən, 24 saat ərzində daxil olub şifrənizi təsdiqləməlisiniz.</p>
            <p>Aşağıdakı keçidə daxil olun:</p>
            <a href="https://phishguard-app.vercel.app/landing" style="display: inline-block; padding: 12px 20px; background-color: #0275d8; color: white; text-decoration: none; border-radius: 4px;">Şifrəni Yenilə</a>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);

    stats.sent += 1;
    stats.lastPreviewUrl = previewUrl;
    stats.logs.unshift({
      email: email || 'user@example.com',
      date: new Date().toLocaleTimeString(),
      status: 'Göndərildi 🟢'
    });

    res.json({
      success: true,
      previewUrl: previewUrl,
      lastPreviewUrl: previewUrl,
      sent: stats.sent,
      clicks: stats.clicks,
      logs: stats.logs
    });
  } catch (error) {
    console.error('Göndərmə xətası:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Fişinq linkinə kliklənməni izləmək
app.post('/api/track', (req, res) => {
  stats.clicks += 1;
  stats.logs.unshift({
    email: 'Naməlum Əməkdaş',
    date: new Date().toLocaleTimeString(),
    status: 'Tələyə Düşdü 🚨'
  });
  res.json({ success: true, clicks: stats.clicks });
});

app.get('/', (req, res) => {
  res.send('PhishGuard Backend Live Service Running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
