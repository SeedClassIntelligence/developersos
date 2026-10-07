// ══════════════════════════════════════════════════════════════
// db/audit-signing.js — Ed25519 signing for audit chain checkpoints
//
// The private key lives only in the application environment
// (AUDIT_SIGNING_KEY), never in PostgreSQL. A receipt signed with it is
// evidence that survives a full database compromise: whoever holds the
// receipt can prove the chain once contained that position and hash.
//
//   AUDIT_SIGNING_KEY          base64 PKCS#8 DER (or PEM) Ed25519 private key
//   AUDIT_TRUSTED_PUBLIC_KEYS  optional comma-separated base64 SPKI DER keys of
//                              retired signing keys still accepted for verify
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const RECEIPT_TYPE = 'devos.audit.checkpoint';
const RECEIPT_VERSION = 1;

let active = null;
let trusted = null;

function keyIdFor(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
}

function parsePrivateKey(raw) {
  const text = raw.trim();
  return text.startsWith('-----BEGIN')
    ? crypto.createPrivateKey(text)
    : crypto.createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' });
}

function load() {
  if (active) return;
  let privateKey;
  if (process.env.AUDIT_SIGNING_KEY) {
    privateKey = parsePrivateKey(process.env.AUDIT_SIGNING_KEY);
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('AUDIT_SIGNING_KEY is required in production (Ed25519 private key, base64 PKCS#8 DER). See .env.example.');
  } else {
    privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
    console.warn('[AUDIT] AUDIT_SIGNING_KEY not set — using an ephemeral checkpoint key; receipts will not verify after restart.');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('AUDIT_SIGNING_KEY must be an Ed25519 private key.');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  active = { privateKey, publicKey, keyId: keyIdFor(publicKey) };
  trusted = new Map([[active.keyId, publicKey]]);
  for (const entry of (process.env.AUDIT_TRUSTED_PUBLIC_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const key = crypto.createPublicKey({ key: Buffer.from(entry, 'base64'), format: 'der', type: 'spki' });
    trusted.set(keyIdFor(key), key);
  }
}

// Fixed field order; every value is a string or integer, so this is canonical.
function signedPayload(fields) {
  return JSON.stringify({
    type: RECEIPT_TYPE,
    version: RECEIPT_VERSION,
    organizationId: String(fields.organizationId),
    chainSeq: Number(fields.chainSeq),
    eventHash: String(fields.eventHash),
    hashVersion: Number(fields.hashVersion),
    issuedAt: String(fields.issuedAt),
    keyId: String(fields.keyId),
  });
}

function signCheckpoint({ organizationId, chainSeq, eventHash, hashVersion }) {
  load();
  const fields = { organizationId, chainSeq: Number(chainSeq), eventHash, hashVersion: Number(hashVersion), issuedAt: new Date().toISOString(), keyId: active.keyId };
  // Hex, not base64: the request sanitizer rewrites "on…=" runs, which base64
  // can contain; hex cannot, so receipts survive a round trip through the API.
  const signature = crypto.sign(null, Buffer.from(signedPayload(fields)), active.privateKey).toString('hex');
  return { type: RECEIPT_TYPE, version: RECEIPT_VERSION, ...fields, signature };
}

// Verifies only against trusted keys held by this deployment — never against
// a key supplied inside the receipt itself.
function verifyCheckpointSignature(receipt) {
  load();
  if (!receipt || receipt.type !== RECEIPT_TYPE || receipt.version !== RECEIPT_VERSION) return { ok: false, reason: 'RECEIPT_MALFORMED' };
  const key = trusted.get(receipt.keyId);
  if (!key) return { ok: false, reason: 'CHECKPOINT_UNTRUSTED_KEY' };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(signedPayload(receipt)), key, Buffer.from(String(receipt.signature || ''), 'hex'));
  } catch (err) {
    ok = false;
  }
  return ok ? { ok: true } : { ok: false, reason: 'CHECKPOINT_SIGNATURE_INVALID' };
}

function publicKeyInfo() {
  load();
  return {
    algorithm: 'Ed25519',
    keyId: active.keyId,
    publicKey: active.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    trustedKeyIds: [...trusted.keys()],
  };
}

module.exports = { signCheckpoint, verifyCheckpointSignature, publicKeyInfo, load, RECEIPT_TYPE, RECEIPT_VERSION };
