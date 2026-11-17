// ══════════════════════════════════════════════════════════════
// services/storage.js — document file storage
//
// Local-filesystem driver (a mounted volume in production). Files are keyed
// <organizationId>/<projectId>/<documentId>, written to a temporary file while
// streaming (size-capped, SHA-256 computed on the way in) and renamed into
// place only once complete. Only an allowlist of document types is accepted,
// and binary types must carry the matching file signature, so a renamed HTML
// or script file cannot be stored as a "PDF". An object-store driver can
// implement the same three functions (put/open/remove) when hosting is chosen.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// content type → { ext, label, magic? (expected leading bytes) }
const TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF', magic: [Buffer.from('%PDF-')] },
  'image/png': { ext: 'png', label: 'PNG', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
  'image/jpeg': { ext: 'jpg', label: 'JPEG', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', label: 'DOCX', magic: [Buffer.from('PK\x03\x04', 'binary')] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', label: 'XLSX', magic: [Buffer.from('PK\x03\x04', 'binary')] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', label: 'PPTX', magic: [Buffer.from('PK\x03\x04', 'binary')] },
  'application/msword': { ext: 'doc', label: 'DOC', magic: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])] },
  'application/vnd.ms-excel': { ext: 'xls', label: 'XLS', magic: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])] },
  'image/vnd.dwg': { ext: 'dwg', label: 'DWG', magic: [Buffer.from('AC10')] },
  'text/csv': { ext: 'csv', label: 'CSV' },
  'text/plain': { ext: 'txt', label: 'TXT' },
};

function maxBytes() {
  return Number(process.env.DOCUMENT_MAX_BYTES || 25 * 1024 * 1024);
}

// Production must name its storage volume explicitly; development/test default under the app.
function root() {
  if (process.env.DOCUMENT_STORAGE_DIR) return path.resolve(process.env.DOCUMENT_STORAGE_DIR);
  if (process.env.NODE_ENV === 'production' && process.env.TEST_MODE !== 'true') return null;
  return path.join(__dirname, '..', 'data', 'documents');
}

function configured() {
  return !!root();
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
function keyFor(organizationId, projectId, documentId) {
  for (const s of [organizationId, projectId, documentId]) {
    if (!SAFE_SEGMENT.test(String(s)) || s === '.' || s === '..') throw new Error('unsafe storage key segment');
  }
  return `${organizationId}/${projectId}/${documentId}`;
}

function pathFor(key) {
  const base = root();
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error('storage key escapes the storage root');
  return full;
}

class StorageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Streams `input` into storage under `key`. Resolves { size, sha256 }.
// Rejects with StorageError(413) when too large, (415) when the bytes do not
// match the declared type, (503) when storage is not configured.
function put(key, input, contentType) {
  return new Promise((resolve, reject) => {
    if (!configured()) return reject(new StorageError(503, 'Document storage is not configured'));
    const type = TYPES[contentType];
    if (!type) return reject(new StorageError(415, 'This file type is not accepted'));
    const target = pathFor(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomBytes(6).toString('hex')}.part`;
    const out = fs.createWriteStream(temp, { flags: 'wx', mode: 0o640 });
    const hash = crypto.createHash('sha256');
    const limit = maxBytes();
    let size = 0;
    let head = Buffer.alloc(0);
    let failed = false;

    const fail = err => {
      if (failed) return;
      failed = true;
      input.unpipe && input.unpipe(out);
      input.resume && input.resume(); // drain the rest of the request
      // The temp file is opened asynchronously: remove it only once the stream has
      // fully closed, or a late open would leave an orphaned partial file behind.
      out.once('close', () => fs.rm(temp, { force: true }, () => reject(err)));
      out.destroy();
    };

    input.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) return fail(new StorageError(413, `File exceeds the ${Math.round(limit / 1048576)} MB limit`));
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      hash.update(chunk);
      if (!out.write(chunk)) { input.pause(); out.once('drain', () => input.resume()); }
    });
    input.on('error', fail);
    out.on('error', fail);
    input.on('end', () => {
      if (failed) return;
      if (size === 0) return fail(new StorageError(400, 'The file is empty'));
      if (type.magic && !type.magic.some(m => head.subarray(0, m.length).equals(m))) {
        return fail(new StorageError(415, `The file content is not a valid ${type.label}`));
      }
      out.end(() => {
        fs.rename(temp, target, err => (err ? fail(err) : resolve({ size, sha256: hash.digest('hex') })));
      });
    });
  });
}

function open(key) {
  return fs.createReadStream(pathFor(key));
}

async function remove(key) {
  await fs.promises.rm(pathFor(key), { force: true });
}

module.exports = { TYPES, put, open, remove, keyFor, configured, maxBytes, StorageError };
