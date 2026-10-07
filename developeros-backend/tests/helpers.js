// Test Helpers for DeveloperOS Test Suite
// NOTE: test-env MUST load first — it redirects DATABASE_URL to an isolated *_test database.
const { ensureTestDatabase } = require('./test-env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-v1-fixture.json');

let serverInstance = null;
let serverPort = 3005;

function getCanonicalFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

async function startTestServer(port = 3005, reseed = true) {
  await ensureTestDatabase();
  if (reseed) {
    const { seedDatabase } = require('../db/seed');
    await seedDatabase();
    for (const k of Object.keys(tokenCache)) delete tokenCache[k];
  }


  if (serverInstance) {
    return { server: serverInstance, port: serverPort };
  }
  serverPort = port;
  process.env.NODE_ENV = 'production';
  process.env.TEST_MODE = 'true';
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  
  // Require server
  const { server, ready } = require('../server');
  serverInstance = server;
  await ready;
  return { server: serverInstance, port: serverPort };
}

function stopTestServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null;
        try { delete require.cache[require.resolve('../server')]; } catch (e) {}
        resolve();
      });
    } else {
      try { delete require.cache[require.resolve('../server')]; } catch (e) {}
      resolve();
    }
  });
}

function apiRequest(method, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const dataPayload = options.body 
      ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) 
      : null;
    
    const headers = { ...options.headers };
    if (dataPayload) {
      headers['Content-Length'] = Buffer.byteLength(dataPayload);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const opts = {
      hostname: '127.0.0.1',
      port: serverPort,
      path: reqPath,
      method: method.toUpperCase(),
      headers,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    if (dataPayload) req.write(dataPayload);
    req.end();
  });
}

const tokenCache = {};

async function loginAs(email, password = 'password123') {
  const cacheKey = `${email}:${password}`;
  if (tokenCache[cacheKey]) {
    return tokenCache[cacheKey];
  }

  const res = await apiRequest('POST', '/api/auth/login', {
    body: { email, password },
  });
  if (res.status !== 200 || !res.body.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  tokenCache[cacheKey] = { token: res.body.token, user: res.body.user };
  return tokenCache[cacheKey];
}

function makeExpiredToken(userPayload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be set to generate test tokens');
  return jwt.sign(
    { ...userPayload, iat: Math.floor(Date.now() / 1000) - 3600 },
    secret,
    { expiresIn: -10 }
  );
}

module.exports = {
  getCanonicalFixture,
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
  makeExpiredToken,
};
