const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const storage = new AsyncLocalStorage();

function middleware(req, res, next) {
  storage.run({
    requestId: req.get('X-Request-Id') || randomUUID(),
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

module.exports = { middleware, update, current, applyToClient };
