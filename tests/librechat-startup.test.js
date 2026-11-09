import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ENABLE_DEMO_ADAPTER = 'true';
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
const { createApp } = await import('../server/index.js');
const { db, get, run, now, setSetting } = await import('../server/db.js');
const { hashPassword, hashToken } = await import('../server/security.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.PUBLIC_URL = origin;
const password = randomBytes(24).toString('hex');
for (const [id, role] of [['native-member', 'user'], ['native-admin', 'admin']]) {
 run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)', id, `${id}@example.test`, id, await hashPassword(password), role, JSON.stringify(role === 'admin' ? ['users'] : []), now());
 run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')", id);
}
function client() {
 const cookies = new Map();
 return async (path, method = 'GET', body, headers = {}) => {
  const response = await fetch(`${origin}/api/librechat${path}`, { method, headers: { origin, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join(';'), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const header of response.headers.getSetCookie()) { const [pair] = header.split(';'), split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
  return { status: response.status, body: await response.json() };
 };
}
test.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });

test('native guest shell preserves guest identity and never grants account or administrative access', async () => {
 const request = client();
 const refresh = await request('/auth/refresh', 'POST');
 assert.equal(refresh.status, 200); assert.equal(refresh.body.user.provider, 'school-guest');
 assert.equal(refresh.body.user.school.guest, true);
 assert.equal((await request('/user')).body.id, refresh.body.user.id);
 assert.equal((await request('/roles/ADMIN')).status, 403);
 const role = (await request('/roles/USER')).body;
 assert.equal(role.permissions.AGENTS.USE, true); assert.equal(role.permissions.AGENTS.CREATE, false);
 assert.equal(role.permissions.SHARED_LINKS.CREATE, false);
 assert.equal((await request('/convos/new/export', 'GET', undefined, { authorization: 'Bearer school-cookie-session' })).status, 401);
 const config = (await request('/config')).body;
 assert.equal(config.emailEnabled,false);assert.equal(config.emailLoginEnabled,true);
 assert.equal(config.adminPanelURL, undefined); assert.equal(config.interface.temporaryChat, false);
 assert.equal(config.interface.runCode, false); assert.equal(config.sharedLinksEnabled, false);
 assert.equal(config.minPasswordLength, 12); assert.ok(config.modelSpecs.list.some(spec => spec.name === 'demo-campus'));
 assert.equal((await request('/files/config')).body.endpoints.campus.disabled, true);
});

test('native login shares revocable cookie sessions with campus APIs and logout returns to guest', async () => {
 const request = client();
 const result = await request('/auth/login', 'POST', { email: 'native-admin@example.test', password });
 assert.equal(result.status, 200); assert.equal(result.body.user.role, 'ADMIN');
 assert.equal(result.body.user.schoolRole, 'admin'); assert.deepEqual(result.body.user.schoolPermissions, ['users']);
 assert.equal((await request('/config')).body.adminPanelURL, '/school/admin');
 assert.equal((await request('/auth/refresh', 'POST')).body.user.id, 'native-admin');
 assert.equal((await request('/roles/ADMIN')).status, 200);
 run('UPDATE users SET session_version=session_version+1 WHERE id=?', 'native-admin');
 assert.equal((await request('/auth/refresh', 'POST')).body.user.provider, 'school-guest');
 assert.equal((await request('/auth/login', 'POST', { email: 'native-member@example.test', password })).status, 200);
 assert.equal((await request('/auth/logout', 'POST', {})).status, 200);
 assert.equal((await request('/auth/refresh', 'POST')).body.user.provider, 'school-guest');
});

test('native registration and sign-in work without email delivery when verification is off',async()=>{
 const request=client();
 const created=await request('/auth/register','POST',{email:'native-direct@example.test',name:'直接登录',password});
 assert.equal(created.status,201);assert.equal(created.body.verificationRequired,false);assert.equal(created.body.mailSent,false);
 const login=await request('/auth/login','POST',{email:'native-direct@example.test',password});
 assert.equal(login.status,200);assert.equal(login.body.user.provider,'school-account');assert.equal(login.body.user.emailVerified,false);
});

test('native directory and model selector enforce publication/group access and hide workflow configuration', async () => {
 const request = client();
 const agents = (await request('/agents?requiredPermission=1')).body.data;
 assert.ok(agents.some(agent => agent.id === 'demo-campus'));
 assert.equal(JSON.stringify(agents).includes('integration_id'), false);
 assert.equal((await request('/agents/directory')).status, 403);
 assert.equal((await request('/agents?requiredPermission=2')).body.data.length, 0);
 run('UPDATE agents SET homepage_visible=0 WHERE id=?', 'demo-campus');
 try {
  assert.equal((await request('/agents?requiredPermission=1')).body.data.length, 0);
  assert.ok((await request('/models')).body.campus.includes('demo-campus'));
  assert.equal((await request('/agents/demo-campus')).status, 200);
 } finally { run('UPDATE agents SET homepage_visible=1 WHERE id=?', 'demo-campus'); }
 assert.equal((await request('/agents?search=does-not-exist')).body.data.length, 0);
 const categories = (await request('/agents/categories')).body;
 assert.equal(categories.find(category => category.value === '开发测试').count, 1);
 run("UPDATE groups SET agent_ids='[]' WHERE id='guest'");
 try { assert.deepEqual((await request('/models')).body.campus, []); assert.equal((await request('/agents/demo-campus')).status, 403); }
 finally { run("UPDATE groups SET agent_ids='[\"demo-campus\"]' WHERE id='guest'"); }
});

test('native registration reports unsent verification truthfully and native verification/reset aliases consume one-time tokens', async () => {
 const request = client();
 setSetting('registration',{requireEmailVerification:true});
 assert.equal((await request('/config')).body.emailEnabled,true);
 setSetting('smtp', { host: '', from: '' });
 const created = await request('/auth/register', 'POST', { email: 'native-new@example.test', name: '原生注册', username: 'ignored', password });
 assert.equal(created.status, 201); assert.equal(created.body.mailSent, false);
 assert.equal((await request('/auth/login', 'POST', { email: 'native-new@example.test', password })).body.code, 'EMAIL_NOT_VERIFIED');
 const user = get('SELECT * FROM users WHERE email=?', 'native-new@example.test');
 for (const purpose of ['verify', 'reset']) {
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO email_tokens(id,user_id,purpose,expires_at) VALUES(?,?,?,?)', hashToken(token), user.id, purpose, now() + 60000);
  const path = purpose === 'verify' ? '/user/verify' : '/auth/resetPassword';
  const payload = purpose === 'verify' ? { token, email: user.email } : { token, userId: user.id, password: password + '-changed' };
  assert.equal((await request(path, 'POST', payload)).status, 200);
  assert.equal((await request(path, 'POST', payload)).body.code, 'INVALID_TOKEN');
 }
});
