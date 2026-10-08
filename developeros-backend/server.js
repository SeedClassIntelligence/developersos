require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const bodyParser = require('body-parser');
const fs         = require('fs');
const path       = require('path');
const { sanitizeInputs } = require('./middleware/validate');
const auditContext = require('./db/audit-context');

const app = express();

// ── SECURITY HEADERS ───────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// ── CORS — whitelist only ──────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:8080,http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:8080')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// The UI is served by this server, so a request from the server's own origin
// is same-origin and always allowed (browsers send Origin on same-origin POSTs).
function isSameOrigin(req, origin) {
  try {
    return new URL(origin).host === req.get('host');
  } catch (e) {
    return false;
  }
}

app.use(cors((req, cb) => {
  const origin = req.get('origin');
  const options = {
    methods: ['GET','POST','PUT','PATCH','DELETE'],
    allowedHeaders: ['Content-Type','Authorization'],
    credentials: true,
  };
  if (!origin || isSameOrigin(req, origin) || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    return cb(null, { ...options, origin: true });
  }
  const err = new Error(`CORS blocked: ${origin}`);
  err.status = 403;
  cb(err);
}));

// ── RATE LIMITING ──────────────────────────────
const authLimit = process.env.TEST_MODE === 'true' ? 1000 : 10;
const apiLimit = process.env.TEST_MODE === 'true' ? 10000 : 100;
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: apiLimit, message: { error: 'Too many requests' } }));
app.use('/api/auth/', rateLimit({ windowMs: 15*60*1000, max: authLimit, message: { error: 'Too many login attempts. Try again in 15 minutes.' } }));

// ── LOGGING ────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  app.use(morgan('combined', { stream: fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' }) }));
} else {
  app.use(morgan('dev'));
}

// ── BODY PARSING & SANITIZATION ────────────────
app.use(bodyParser.json({ limit: '10kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));
app.use(sanitizeInputs);
app.use(auditContext.middleware);

// ── STATIC FRONTEND (if present) ───────────────
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ── ROUTES ─────────────────────────────────────
const { protect, resolveOrganizationContext, adminOnly } = require('./middleware/auth');

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/invitations', require('./routes/invitations'));
app.use('/api/projects',  protect, resolveOrganizationContext, require('./routes/projects'));
app.use('/api/tasks',     protect, resolveOrganizationContext, require('./routes/tasks'));
app.use('/api/contracts', protect, resolveOrganizationContext, require('./routes/contracts'));
app.use('/api/permits',   protect, resolveOrganizationContext, require('./routes/permits'));
app.use('/api/capital',   protect, resolveOrganizationContext, require('./routes/capital'));
app.use('/api/messages',  protect, resolveOrganizationContext, require('./routes/messages'));
app.use('/api/documents', protect, resolveOrganizationContext, require('./routes/documents'));
app.use('/api/alerts',    protect, resolveOrganizationContext, require('./routes/alerts'));
app.use('/api/team',      protect, resolveOrganizationContext, require('./routes/team'));
app.use('/api/partners',  protect, resolveOrganizationContext, require('./routes/partners'));
app.use('/api/audit',     protect, resolveOrganizationContext, require('./routes/audit'));
app.use('/api/di',        protect, resolveOrganizationContext, require('./routes/di'));
app.use('/api/admin',     protect, resolveOrganizationContext, adminOnly, require('./routes/admin'));

// ── HEALTH CHECK (public) ──────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', env: process.env.NODE_ENV || 'development' });
});

// ── SPA / 404 HANDLER ──────────────────────────
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && fs.existsSync(path.join(publicDir, 'index.html'))) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

// ── ERROR HANDLER — no stack traces in production
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({
    error: isDev ? err.message : (err.status === 403 ? err.message : 'An error occurred'),
    ...(isDev && { stack: err.stack }),
  });
});

// ── START ──────────────────────────────────────
// The API runs as the unprivileged runtime role and never migrates schema.
// Migrations run separately as the owner role (npm run db:migrate).
const { getPool } = require('./db/pool');
const { migrationFiles } = require('./db/migrate');
const auditSigning = require('./db/audit-signing');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

async function assertRuntimeReady() {
  auditSigning.load();
  const pool = await getPool(); // refuses privileged runtime roles (EF3-D1)
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(r => r.version));
  const pending = migrationFiles().filter(f => !applied.has(f));
  if (pending.length) {
    throw new Error(`pending migrations (${pending.join(', ')}); run npm run db:migrate`);
  }
}

// Listen only after the runtime role, schema, and signing key are verified, so
// no request is ever served by a misconfigured process.
const server = require('http').createServer(app);
const ready = assertRuntimeReady()
  .then(() => new Promise(resolve => server.listen(PORT, HOST, resolve)))
  .then(() => {
    console.log(`\nDeveloperOS API [${process.env.NODE_ENV||'development'}] running live on http://${HOST}:${PORT}\n`);
  })
  .catch(err => {
    console.error('[DB] FATAL: runtime not ready — refusing to serve traffic:', err.message);
    process.exit(1);
  });

module.exports = { app, server, ready };
