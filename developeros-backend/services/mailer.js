// ══════════════════════════════════════════════════════════════
// services/mailer.js — transactional email (invitations, password reset)
//
// Provider-neutral SMTP via nodemailer. Email is enabled only when SMTP_HOST,
// MAIL_FROM and APP_BASE_URL are all set; otherwise callers fall back to a
// shareable link and say so. MAIL_TRANSPORT=memory keeps messages in an
// in-process outbox (tests only).
// ══════════════════════════════════════════════════════════════

const outbox = [];
let transport = null;

function config() {
  return {
    memory: process.env.MAIL_TRANSPORT === 'memory',
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM,
    baseUrl: (process.env.APP_BASE_URL || '').replace(/\/+$/, ''),
  };
}

function enabled() {
  const c = config();
  return !!(c.baseUrl && c.from && (c.memory || c.host));
}

// Absolute link into the application (hash route), or null when no public base URL is configured.
function appLink(route) {
  const { baseUrl } = config();
  return baseUrl ? `${baseUrl}/#${route}` : null;
}

async function send({ to, subject, text }) {
  const c = config();
  if (!enabled()) return { delivered: false, reason: 'email not configured' };
  const message = { from: c.from, to, subject, text };
  if (c.memory) {
    outbox.push({ ...message, sentAt: new Date().toISOString() });
    return { delivered: true };
  }
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
  }
  try {
    await transport.sendMail(message);
    return { delivered: true };
  } catch (err) {
    console.error(`[MAIL] delivery to ${to} failed: ${err.message}`);
    return { delivered: false, reason: 'delivery failed' };
  }
}

module.exports = { enabled, appLink, send, outbox };
