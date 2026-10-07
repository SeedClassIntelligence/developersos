// ══════════════════════════════════════════════════════════════
// db/pg-engine.js — PostgreSQL Engine Lifecycle Manager
// Ensures native PostgreSQL engine is initialized and running.
// Port / credentials are derived from DATABASE_URL (no hardcoded values).
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const path = require('path');
const net = require('net');

let pgInstance = null;
let isStarting = false;

function parseConnection() {
  const raw = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Configure it in .env (see .env.example).');
  }
  const u = new URL(raw);
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
  };
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function ensurePostgresRunning() {
  const conn = parseConnection();

  // If the configured port is already open and accepting connections, connect directly
  const alreadyOpen = await isPortOpen(conn.port, '127.0.0.1');
  if (alreadyOpen) {
    return { status: 'already-running', port: conn.port };
  }

  if (isStarting) {
    while (isStarting) {
      await new Promise(r => setTimeout(r, 200));
    }
    return { status: 'started', port: conn.port };
  }

  isStarting = true;
  try {
    const EmbeddedPostgres = require('embedded-postgres').default;
    // Tests and deployments may select a short/writable data path. This also
    // avoids native initdb path parsing limitations on Windows while retaining
    // the repository-local directory as the compatibility default.
    const dbDir = process.env.PG_DATA_DIR
      ? path.resolve(process.env.PG_DATA_DIR)
      : path.join(__dirname, '..', '.pgdata');

    pgInstance = new EmbeddedPostgres({
      databaseDir: dbDir,
      port: conn.port,
      user: conn.user,
      password: conn.password,
      persistent: true,
      initdbFlags: ['--encoding=UTF8'],
    });

    try {
      await pgInstance.initialise();
    } catch (initErr) {
      // Directory may already be initialized
    }

    await pgInstance.start();
    isStarting = false;
    return { status: 'started', port: conn.port };
  } catch (err) {
    isStarting = false;
    throw err;
  }
}

async function stopPostgresEngine() {
  if (pgInstance) {
    try {
      await pgInstance.stop();
    } catch (e) {
      // Ignore cleanup error on process exit
    }
    pgInstance = null;
  }
}

module.exports = {
  ensurePostgresRunning,
  stopPostgresEngine,
  parseConnection,
};
