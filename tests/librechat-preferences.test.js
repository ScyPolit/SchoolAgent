import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ENABLE_DEMO_ADAPTER = 'true';
process.env.ENCRYPTION_KEY = '33'.repeat(32);
process.env.COOKIE_SECURE = 'false';
const { createApp } = await import('../server/index.js');
const { db, run, get, now } = await import('../server/db.js');
const { hashToken } = await import('../server/security.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.PUBLIC_URL = origin;
after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
function client(session) {
 const cookies = new Map(session ? [['school_session', session]] : []);
 return async (path, method = 'GET', body) => {
  const response = await fetch(origin + '/api/librechat' + path, { method, headers: { origin, 'content-type': 'application/json', cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join(';') }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
  return { status: response.status, body: await response.json() };
 };
}
function account(id) {
 run('INSERT INTO users(id,email,name,password_hash,email_verified,created_at) VALUES(?,?,?,?,1,?)', id, `${id}@example.test`, id, 'fixture-unused', now());
 run('INSERT INTO user_groups(user_id,group_id) VALUES(?,?)', id, 'member');
 const session = randomUUID(); run('INSERT INTO sessions(id,user_id,version,created_at,expires_at) VALUES(?,?,?,?,?)', hashToken(session), id, 0, now(), now() + 60000);
 return client(session);
}

test('native favorite wire arrays persist separately for each real user and each guest browser', async () => {
 const guest = client(), anotherGuest = client(), member = account('favorite-owner'), other = account('favorite-other');
 const favorite = [{ agentId: 'demo-campus' }, { spec: 'demo-campus' }, { endpoint: 'campus', model: 'demo-campus' }];
 assert.deepEqual((await guest('/user/settings/favorites')).body, []);
 assert.deepEqual(await guest('/user/settings/favorites', 'POST', { favorites: favorite }), { status: 200, body: favorite });
 assert.deepEqual((await guest('/user/settings/favorites')).body, favorite);
 for (const request of [anotherGuest, member, other]) assert.deepEqual((await request('/user/settings/favorites')).body, []);
 assert.deepEqual((await member('/user/settings/favorites', 'POST', { favorites: [{ spec: 'demo-campus' }] })).body, [{ spec: 'demo-campus' }]);
 assert.deepEqual((await guest('/user/settings/favorites')).body, favorite);
 assert.equal(get('SELECT count(*) count FROM native_preferences').count, 2);
});

test('native favorites reject unavailable agents, unknown metadata and ambiguous variants without storing them', async () => {
 const request = client();
 for (const favorites of [[{ agentId: 'directory' }], [{ agentId: 'demo-campus', spec: 'demo-campus' }], [{ endpoint: 'openAI', model: 'demo-campus' }], [{ agentId: 'demo-campus', secret: 'must-not-store' }], [{ agentId: 'demo-campus' }, { agentId: 'demo-campus' }], 'invalid']) {
  const response = await request('/user/settings/favorites', 'POST', { favorites });
  assert.equal(response.status, 400); assert.equal(response.body.code, 'INVALID_FAVORITES');
 }
 assert.deepEqual((await request('/user/settings/favorites')).body, []);
 assert.equal(get("SELECT count(*) count FROM native_preferences WHERE value LIKE '%must-not-store%'").count, 0);
 const favorite = [{ agentId: 'demo-campus' }]; await request('/user/settings/favorites', 'POST', { favorites: favorite });
 run("UPDATE groups SET agent_ids='[]' WHERE id='guest'");
 try { assert.deepEqual((await request('/user/settings/favorites')).body, []); assert.equal((await request('/user/settings/favorites', 'POST', { favorites: favorite })).status, 400); }
 finally { run("UPDATE groups SET agent_ids='[\"demo-campus\"]' WHERE id='guest'"); }
});

test('native pinned ordering survives reload and validates actual owner membership', async () => {
 const request = account('pin-owner'), other = account('pin-other');
 // A fresh database can load preferences before the compatibility conversation schema.
 assert.deepEqual((await request('/user/settings/pinned-order')).body, []);
 await request('/user/settings/favorites', 'POST', { favorites: [{ spec: 'demo-campus' }] });
 const conversationId = 'c_' + randomUUID();
 run('INSERT INTO conversations(id,owner_type,owner_id,agent_id,title,upstream_user,created_at,updated_at,last_active_at) VALUES(?,?,?,?,?,?,?,?,?)', conversationId, 'user', 'pin-owner', 'demo-campus', '置顶历史', randomUUID(), now(), now(), now());
 assert.equal((await request('/convos/pin', 'POST', { arg: { conversationId, pinned: true } })).status, 200);
 const pinnedOrder = [`convo:${conversationId}`, 'spec:demo-campus'];
 assert.deepEqual(await request('/user/settings/pinned-order', 'POST', { pinnedOrder }), { status: 200, body: pinnedOrder });
 assert.deepEqual((await request('/user/settings/pinned-order')).body, pinnedOrder);
 assert.deepEqual((await other('/user/settings/pinned-order')).body, []);
 assert.equal((await other('/user/settings/pinned-order', 'POST', { pinnedOrder })).status, 400);
 assert.equal((await request('/user/settings/pinned-order', 'POST', { pinnedOrder: [...pinnedOrder, pinnedOrder[0]] })).status, 400);
 await request('/convos/pin', 'POST', { arg: { conversationId, pinned: false } });
 assert.deepEqual((await request('/user/settings/pinned-order')).body, ['spec:demo-campus']);
});
