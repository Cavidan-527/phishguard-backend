const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Statistikaları yaddaşda saxlayırıq
let stats = {
  sent: 0,
  clicks: 0,
  lastPreviewUrl: '',
  logs: []
};

app.get('/api/stats', (req, res) => {
  res.json(stats);
});

app.post('/api/send', async (req, res) => {
  const { email } = req.body;
  stats.sent += 1;
  
  // Fake test poçt hesabı
  const testAccount = await nodemailer.createTestAccount(); 
  const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email", port: 587, 
      auth: { user: testAccount.user, pass: testAccount.pass }
  });

  const info = await transporter.sendMail({
      from: '"IT-Support@your-company.com" <admin@phishguard.demo>',
      to: email,
      subject: "Təcili: Parolunuzun vaxtı bitir - Təsdiqləyin",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; max-width: 500px;">
          <h3 style="color: #c0392b;">İstifadəçi Diqqətinə!</h3>
          <p>Hesabınızda şübhəli fəaliyyət aşkar edilmişdir. Girişin dayandırılmaması üçün 24 saat ərzində şifrənizi təsdiqləyin.</p>
          <br/>
          <a href="http://localhost:3000/landing" style="background: #e74c3c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Hesabınızı Təsdiqləyin</a>
          <br/><br/>
          <hr/>
          <small style="color: #7f8c8d;">PhishGuard Security Simulation System</small>
        </div>
      `
  });

  stats.lastPreviewUrl = nodemailer.getTestMessageUrl(info);
  stats.logs.unshift({ email, date: new Date().toLocaleTimeString(), status: 'Göndərildi' });

  res.json(stats);
});

app.post('/api/track', (req, res) => {
  stats.clicks += 1;
  if (stats.logs.length > 0) {
    stats.logs[0].status = '🚨 Klikləndi (Tələyə düşdü)';
  }
  res.json(stats);
});

app.listen(3001, () => console.log('Backend 3001 portunda hazırdır!'));
