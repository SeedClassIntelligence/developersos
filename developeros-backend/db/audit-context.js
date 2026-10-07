const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const storage = new AsyncLocalStorage();

// EF3-D5: X-Request-Id is untrusted correlation metadata. Anything outside
// this pattern is replaced with a server-generated ID, so the header can never
// overflow the audit column or fail an audited write. It is never used as
// identity or authority.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function resolveRequestId(header) {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

function middleware(req, res, next) {
  const requestId = resolveRequestId(req.get('X-Request-Id'));
  res.setHeader('X-Request-Id', requestId);
  storage.run({
    requestId,
    actorUserId: null,
    organizationId: null,
  }, next);
}

function update(values) {
  const context = storage.getStore();
  if (context) Object.assign(context, values);
}

function current() {
  return storage.getStore() || {};
}

async function applyToClient(client) {
  const context = current();
  await client.query("SELECT set_config('app.request_id', $1, true), set_config('app.actor_user_id', $2, true), set_config('app.organization_id', $3, true)", [
    context.requestId || '',
    context.actorUserId || '',
    context.organizationId || '',
  ]);
}

module.exports = { middleware, update, current, applyToClient, resolveRequestId, REQUEST_ID_PATTERN };
