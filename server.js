// server.js - PhishGuard Backend API
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// CORS və JSON middleware
app.use(cors());
app.use(express.json());

// Şəbəkə daxilində statistika və loglar (In-memory storage)
let stats = {
  sent: 0,
  clicks: 0,
  lastPreviewUrl: null,
  logs: []
};

// Ethereal Transporter obyektini saxlayacaq dəyişən
let transporter = null;

// Ethereal SMTP serverinə qoşulma funksiyası
async function getTransporter() {
  if (!transporter) {
    console.log('🔄 Ethereal Email test hesabı yaradılır...');
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('✅ Ethereal SMTP hesabı uğurla yaradıldı:', testAccount.user);
  }
  return transporter;
}

// Şablonların məzmunu və başlıqları
const TEMPLATE_CONTENTS = {
  it_password: {
    subject: '🚨 TƏCİLİ: Korporativ IT Şifrənizin Müddəti Bitir',
    fromName: 'İT Dəstək Xidməti',
    bodyTitle: 'Korporativ IT Portalı Bildirişi',
    bodyText: 'Şifrənizin istifadə müddəti 24 saat ərzində bitir. Giriş imkanını itirməmək üçün şifrənizi təcili yeniləyin.',
    buttonText: 'Şifrəni İndi Yenilə'
  },
  hr_leave: {
    subject: '📄 Məzuniyyət Müraciətinizin Təsdiqi və Sənəd Yoxlanışı',
    fromName: 'İnsan Resursları (HR)',
    bodyTitle: 'HR Məzuniyyət Portalı',
    bodyText: 'İllik məzuniyyət müraciətinizlə bağlı sənədlərdə dəqiqləşdirmə tələb olunur. Məlumatları yoxlamaq üçün portala daxil olun.',
    buttonText: 'Müraciətə Bax'
  },
  finance_invoice: {
    subject: '💰 Təcili Ödəniş Tələbi - Faktura #49201',
    fromName: 'Maliyyə Şöbəsi',
    bodyTitle: 'Maliyyə və Hesabat Portalı',
    bodyText: 'Şirkətinizə aid gecikdirilmiş faktura ödənişi aşkar edilmişdir. Cərimə tətbiq olunmaması üçün fakturanı dərhal təsdiqləyin.',
    buttonText: 'Fakturanı Təsdiqlə'
  }
};

// Frontend Landing Səhifəsi Ünvanı
const LANDING_URL = process.env.FRONTEND_URL || 'https://phishguard-mauve.vercel.app/landing';

// ---------------------------------------------------------------------------
// API ENDPOINTS
// ---------------------------------------------------------------------------

// Server işləkliyini yoxlamaq üçün (Health check)
app.get('/', (req, res) => {
  res.send('🛡️ PhishGuard Backend API işlək vəziyyətdədir.');
});

// Statistika və logları gətirən endpoint
app.get('/api/stats', (req, res) => {
  res.json(stats);
});

// Simulyasiya göndərən endpoint
app.post('/api/send', async (req, res) => {
  const { email, template } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Hədəf e-poçt ünvanı daxil edilməlidir.' });
  }

  const selectedTemplate = TEMPLATE_CONTENTS[template] || TEMPLATE_CONTENTS.it_password;

  try {
    const mailer = await getTransporter();

    // E-poçt göndərilir
    const info = await mailer.sendMail({
      from: `"${selectedTemplate.fromName}" <security@sirket-portal.az>`,
      to: email,
      subject: selectedTemplate.subject,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 520px; background-color: #ffffff; color: #1a202c;">
          <h2 style="color: #0f172a; margin-top: 0;">${selectedTemplate.bodyTitle}</h2>
          <p style="font-size: 15px; color: #475569; line-height: 1.6;">Hörmətli əməkdaş,</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.6;">${selectedTemplate.bodyText}</p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${LANDING_URL}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">
              ${selectedTemplate.buttonText}
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #94a3b8;">Bu bildiriş daxil korporativ təhlükəsizlik sistemi tərəfindən avtomatik yaradılmışdır.</p>
        </div>
      `,
    });

    // Ethereal ünvanında real məktubun linkini əldə edirik
    const previewUrl = nodemailer.getTestMessageUrl(info);

    // Statistika və logları yeniləyirik
    stats.sent += 1;
    stats.lastPreviewUrl = previewUrl;
    stats.logs.unshift({
      id: Date.now(),
      email: email,
      time: new Date().toISOString(),
      statusLabel: 'Göndərildi (Simulyasiya)'
    });

    console.log(`✉️ Məktub göndərildi: ${email} | Preview: ${previewUrl}`);

    return res.json({
      success: true,
      message: 'Simulyasiya e-poçtu uğurla göndərildi!',
      previewUrl: previewUrl || null
    });

  } catch (error) {
    console.error('❌ E-poçt göndərmə xətası:', error);
    return res.status(500).json({
      error: 'E-poçt göndərilərkən xəta baş verdi: ' + error.message
    });
  }
});

// Tələyə düşənlərin (klikləyənlərin) qeydiyyatı
app.post('/api/track', (req, res) => {
  const { email } = req.body;

  stats.clicks += 1;

  if (email) {
    // Uyğun email üzrə son logun statusunu yeniləyirik
    const existingLog = stats.logs.find((l) => l.email === email);
    if (existingLog) {
      existingLog.statusLabel = '⚠️ Tələyə Düşdü (Klikləndi)';
    }
  }

  console.log(`🚨 Tələyə düşən istifadəçi: ${email || 'Naməlum'}`);
  return res.json({ success: true });
});

// Serverin başlatılması
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 PhishGuard Backend serveri ${PORT} portunda çalışır.`);
});
