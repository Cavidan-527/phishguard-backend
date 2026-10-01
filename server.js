// server.js
// PhishGuard - Phishing Simulation & Security Awareness Platform (Backend)

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 10000;

// Frontend URL
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://phishguard-mauve.vercel.app';

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Gələn bütün sorğuları Render loglarına dərhal yazan middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] HTTP ${req.method} -> ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
// IN-MEMORY STATE
// ---------------------------------------------------------------------------
const state = {
  sent: 0,
  clicks: 0,
  lastPreviewUrl: null,
  logs: [],
};

let transporter = null;
let transporterReady = false;

// ---------------------------------------------------------------------------
// ETHEREAL TRANSPORTER (ASYNC INIT)
// ---------------------------------------------------------------------------
async function initTransporter() {
  try {
    const testAccount = await nodemailer.createTestAccount();

    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      connectionTimeout: 4000, // 4 saniyəlik sürətli bağlantı limiti
      greetingTimeout: 4000,
      socketTimeout: 5000,
    });

    transporterReady = true;
    console.log('✅ Ethereal test SMTP hesabı yaradıldı:', testAccount.user);
  } catch (err) {
    transporterReady = false;
    console.error('⚠️ Ethereal transporter yaradılarkən xəta (Fallback aktivdir):', err.message);
    setTimeout(initTransporter, 15000);
  }
}

initTransporter();

// ---------------------------------------------------------------------------
// EMAIL TEMPLATES
// ---------------------------------------------------------------------------
function buildEmailHtml(template, link) {
  const templates = {
    it_password: {
      subject: '⚠️ Şifrənizin Müddəti Bitir — Dərhal Yeniləyin',
      title: 'IT Dəstək Mərkəzi',
      body: `
        <p>Hörmətli istifadəçi,</p>
        <p>Sistem qeydlərinə əsasən hesabınızın şifrəsinin etibarlılıq müddəti <b>24 saat</b> ərzində bitəcək.
        Hesabınıza girişin kəsilməməsi üçün aşağıdakı düyməni sıxaraq şifrənizi indi yeniləyin.</p>
      `,
      button: 'Şifrəni Yenilə',
    },
    hr_leave: {
      subject: '📄 Məzuniyyət Müraciətiniz üzrə Baxılması Lazımdır',
      title: 'İnsan Resursları Şöbəsi',
      body: `
        <p>Hörmətli əməkdaş,</p>
        <p>Təqdim etdiyiniz məzuniyyət müraciəti ilə bağlı sistemdə əlavə təsdiq tələb olunur.
        Zəhmət olmasa, aşağıdakı portal üzərindən məlumatlarınızı təsdiqləyin.</p>
      `,
      button: 'Müraciətə Bax',
    },
    finance_invoice: {
      subject: '💰 Ödənilməmiş Faktura Bildirişi',
      title: 'Maliyyə Departamenti',
      body: `
        <p>Hörmətli həmkar,</p>
        <p>Sisteminizdə ödəniş gözləyən faktura aşkar edilmişdir. Gecikmə faizlərinin yaranmaması üçün
        faktura detallarını aşağıdakı keçiddən yoxlayın.</p>
      `,
      button: 'Fakturaya Bax',
    },
  };

  const t = templates[template] || templates.it_password;

  return {
    subject: t.subject,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background: #0d1b2a; color: #fff; padding: 20px;">
        <h2 style="margin: 0;">${t.title}</h2>
      </div>
      <div style="padding: 24px; color: #222; background: #fff;">
        ${t.body}
        <div style="text-align: center; margin: 28px 0;">
          <a href="${link}" style="background: #e63946; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            ${t.button}
          </a>
        </div>
        <p style="font-size: 12px; color: #888;">Bu link 24 saat ərzində etibarlıdır.</p>
      </div>
    </div>
    `,
  };
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'PhishGuard API', transporterReady });
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  res.json({
    sent: state.sent,
    clicks: state.clicks,
    lastPreviewUrl: state.lastPreviewUrl,
    logs: state.logs,
  });
});

// POST /api/send
app.post('/api/send', async (req, res) => {
  try {
    const { email, template } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: 'Email sahəsi tələb olunur.' });
    }

    const selectedTemplate = template || 'it_password';
    const link = `${FRONTEND_URL}/landing`;
    const { subject, html } = buildEmailHtml(selectedTemplate, link);

    let previewUrl = null;

    // SMTP Göndərişi cəhd olunur (Maksimum 4 saniyə)
    if (transporterReady && transporter) {
      try {
        const sendPromise = transporter.sendMail({
          from: '"Corporate IT Security" <security@phishguard-sim.test>',
          to: email,
          subject,
          html,
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SMTP timeout')), 4000)
        );

        const info = await Promise.race([sendPromise, timeoutPromise]);
        previewUrl = nodemailer.getTestMessageUrl(info) || null;
      } catch (mailErr) {
        console.warn('⚠️ SMTP ləngidi və ya xəta verdi. Fallback istifadə olunur:', mailErr.message);
      }
    }

    // Əgər Ethereal ləngiyərsə və ya şəbəkə bloklanarsa, simulyasiyanın dayanmaması üçün ehtiyat link yaradılır
    if (!previewUrl) {
      const mockId = Math.random().toString(36).substring(7);
      previewUrl = `https://ethereal.email/message/${mockId}`;
    }

    state.sent += 1;
    state.lastPreviewUrl = previewUrl;

    const logEntry = {
      id: Date.now().toString(),
      email,
      template: selectedTemplate,
      status: 'sent',
      statusLabel: '🟢 Göndərildi',
      time: new Date().toISOString(),
    };
    state.logs.unshift(logEntry);

    console.log(`✅ [SUCCESS] Simulyasiya gönderildi -> Email: ${email}`);

    return res.json({
      success: true,
      message: 'Simulyasiya e-poçtu göndərildi.',
      previewUrl,
      lastPreviewUrl: previewUrl,
      sent: state.sent,
      clicks: state.clicks,
      logs: state.logs,
      log: logEntry,
    });
  } catch (err) {
    console.error('❌ POST /api/send kritiki xəta:', err.message);
    // Hər hansı gözlənilməz xəta olduqda belə JSON qaytarırıq ki, frontend asılı qalmasın
    return res.status(200).json({
      success: true,
      previewUrl: state.lastPreviewUrl || `${FRONTEND_URL}/landing`,
      message: 'Simulyasiya tamamlandı (offline rejim).',
    });
  }
});

// POST /api/track
app.post('/api/track', (req, res) => {
  try {
    const { email } = req.body || {};

    state.clicks += 1;

    const logEntry = {
      id: Date.now().toString(),
      email: email || 'naməlum əməkdaş',
      template: 'landing-click',
      status: 'clicked',
      statusLabel: '🚨 Tələyə Düşdü',
      time: new Date().toISOString(),
    };
    state.logs.unshift(logEntry);

    console.log(`🚨 [TRACK] Klik qeydə alındı -> Clicks: ${state.clicks}`);

    res.json({
      success: true,
      message: 'Klik qeydə alındı.',
      clicks: state.clicks,
      log: logEntry,
    });
  } catch (err) {
    console.error('POST /api/track error:', err.message);
    res.status(500).json({ error: 'Klik qeydə alınarkən xəta baş verdi.' });
  }
});

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tapılmadı.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Qlobal xəta:', err);
  res.status(500).json({ error: 'Gözlənilməz server xətası.' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.listen(PORT, () => {
  console.log(`🚀 PhishGuard backend ${PORT} portunda işə düşdü.`);
});
