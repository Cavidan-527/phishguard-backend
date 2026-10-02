// server.js
// PhishGuard - Phishing Simulation & Security Awareness Platform (Backend)
// Node.js + Express + Resend (HTTPS email API — works on Render free tier,
// unlike raw SMTP, which Render blocks outbound on ports 25/465/587 for
// free web services).

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Frontend URL used inside the phishing email's link target
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://phishguard-mauve.vercel.app';

// Resend config — set RESEND_API_KEY in Render's Environment tab.
// RESEND_FROM defaults to Resend's shared sandbox sender, which works
// without verifying your own domain (but can then only deliver to the
// email address you signed up to Resend with).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'PhishGuard <onboarding@resend.dev>';

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ---------------------------------------------------------------------------
// IN-MEMORY STATE
// ---------------------------------------------------------------------------
const state = {
  sent: 0,
  clicks: 0,
  lastPreviewUrl: null,
  logs: [], // { id, email, template, status, time }
};

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
        <p style="font-size: 12px; color: #888;">Bu link 24 saat ərzində etibarlıdır. Əgər bu müraciəti siz etməmisinizsə, bu e-poçtu nəzərə almayın.</p>
      </div>
      <div style="background: #f1f1f1; padding: 12px; text-align: center; font-size: 11px; color: #999;">
        © Corporate IT Security — Daxili Bildiriş Sistemi
      </div>
    </div>
    `,
  };
}

// Builds a data-URI preview of the given HTML so the exact email content can
// still be opened/viewed even when no real delivery is available.
function buildSimulatedPreview(html) {
  const encodedHtml = Buffer.from(html, 'utf-8').toString('base64');
  return `data:text/html;base64,${encodedHtml}`;
}

// Sends via the Resend HTTPS API (fetch is global in Node 18+). This avoids
// raw SMTP sockets entirely, so it is not affected by Render's free-tier
// block on outbound SMTP ports (25/465/587).
async function sendViaResend({ to, subject, html }, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Surface Resend's own error message (e.g. sandbox restriction:
      // "You can only send testing emails to your own email address").
      const msg = (data && (data.message || data.error)) || `Resend API xətası (HTTP ${res.status}).`;
      throw new Error(msg);
    }

    return data; // { id: "..." }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'PhishGuard API', resendConfigured: Boolean(RESEND_API_KEY) });
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  try {
    res.json({
      sent: state.sent,
      clicks: state.clicks,
      lastPreviewUrl: state.lastPreviewUrl,
      logs: state.logs,
    });
  } catch (err) {
    console.error('GET /api/stats error:', err.message);
    res.status(500).json({ error: 'Stats alınarkən xəta baş verdi.' });
  }
});

// POST /api/send
app.post('/api/send', async (req, res) => {
  try {
    const { email, template } = req.body || {};

    if (!email || !template) {
      return res.status(400).json({ error: 'Email və template sahələri tələb olunur.' });
    }

    const link = `${FRONTEND_URL}/landing`;
    const { subject, html } = buildEmailHtml(template, link);

    let previewUrl = null;
    let deliveryMode = 'real'; // 'real' | 'simulated'
    let deliveryNote = null;

    if (!RESEND_API_KEY) {
      console.error('⚠️ RESEND_API_KEY təyin olunmayıb, simulyasiya rejiminə keçilir.');
      deliveryMode = 'simulated';
      deliveryNote = 'RESEND_API_KEY konfiqurasiya olunmayıb.';
      previewUrl = buildSimulatedPreview(html);
    } else {
      try {
        await sendViaResend({ to: email, subject, html });
        console.log(`✅ Resend ilə göndərildi: ${email}`);
      } catch (sendErr) {
        // FALLBACK: covers an invalid/missing API key, Resend's sandbox
        // recipient restriction, rate limits, or any transient API error.
        // We never fail the whole simulation because of a delivery hiccup.
        console.error('⚠️ Resend göndərmədi, fallback rejiminə keçilir:', sendErr.message);
        deliveryMode = 'simulated';
        deliveryNote = sendErr.message;
        previewUrl = buildSimulatedPreview(html);
      }
    }

    state.sent += 1;
    state.lastPreviewUrl = previewUrl;

    const logEntry = {
      id: Date.now().toString(),
      email,
      template,
      status: 'sent',
      statusLabel: deliveryMode === 'real' ? '🟢 Göndərildi (Real)' : '🟡 Göndərildi (Simulyasiya rejimi)',
      time: new Date().toISOString(),
    };
    state.logs.unshift(logEntry);

    res.json({
      success: true,
      message:
        deliveryMode === 'real'
          ? `E-poçt real olaraq ${email} ünvanına göndərildi. Inboxunuzu yoxlayın.`
          : `Real göndəriş alınmadı (${deliveryNote || 'bilinməyən səbəb'}), e-poçt lokal olaraq simulyasiya edildi.`,
      deliveryMode,
      previewUrl,
      log: logEntry,
    });
  } catch (err) {
    console.error('POST /api/send error:', err.message);
    res.status(500).json({ error: 'E-poçt göndərilərkən xəta baş verdi.', details: err.message });
  }
});

// POST /api/track
app.post('/api/track', (req, res) => {
  try {
    const { email } = req.body || {};

    state.clicks += 1;

    const logEntry = {
      id: Date.now().toString(),
      email: email || 'naməlum',
      template: 'landing-click',
      status: 'clicked',
      statusLabel: '🚨 Tələyə Düşdü',
      time: new Date().toISOString(),
    };
    state.logs.unshift(logEntry);

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

// Global error handler (keeps the process alive)
app.use((err, req, res, next) => {
  console.error('Qlobal xəta:', err);
  res.status(500).json({ error: 'Gözlənilməz server xətası.' });
});

// Prevent process crash on unexpected errors
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.listen(PORT, () => {
  console.log(`🚀 PhishGuard backend ${PORT} portunda işə düşdü. Resend konfiqurasiyası: ${RESEND_API_KEY ? 'VAR' : 'YOXDUR'}`);
});
