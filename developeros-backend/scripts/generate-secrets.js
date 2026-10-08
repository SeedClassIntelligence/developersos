#!/usr/bin/env node
// Prints a fresh set of DeveloperOS production secrets in env-file format.
//
//   node scripts/generate-secrets.js >> deploy/.env.production
//
// Output goes to stdout only; nothing is stored. Passwords are hex so they
// are safe inside postgresql:// URLs without percent-encoding.
const crypto = require('crypto');

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const auditKey = crypto.generateKeyPairSync('ed25519').privateKey
  .export({ type: 'pkcs8', format: 'der' }).toString('base64');

process.stdout.write([
  `# Generated ${new Date().toISOString()} by scripts/generate-secrets.js`,
  '# Keep in a secrets manager, out of version control. Back up AUDIT_SIGNING_KEY together with database backups.',
  `JWT_SECRET=${hex(48)}`,
  `AUDIT_SIGNING_KEY=${auditKey}`,
  `POSTGRES_OWNER_PASSWORD=${hex(24)}`,
  `DEVOS_RUNTIME_PASSWORD=${hex(24)}`,
  '',
].join('\n'));
