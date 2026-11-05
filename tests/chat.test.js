// This suite uses a local protocol fixture, not a
// real campus Dify application; its capacity result cannot certify production.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { readSSE } from '../server/adapters/sse.js';

process.env.DATABASE_PATH = ':memory:';
process.env.ENCRYPTION_KEY = '11'.repeat(32);
process.env.ENABLE_DEMO_ADAPTER = 'true';
process.env.NODE_ENV = 'test';
const { db, all, get, run, now, setSetting } = await import('../server/db.js');
const { initCoreSchema } = await import('../server/db.js');
const { encrypt } = await import('../server/security.js');
const { chatRouter, initChatSchema, snapshotConversation, runRetention } = await import('../server/chat.js');
let server, upstream, baseUrl, upstreamUrl, number = 0;
const requests = [], tasks = new Map();
const writeEvent = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))); }
function close(server) { return new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }); }
before(async () => {
  initCoreSchema(); initChatSchema();
  for (const [userId, role, permissions] of [['u1', 'user', []], ['u2', 'user', []], ['admin', 'superadmin', []], ['limited', 'admin', ['conversations', 'logs', 'feedback']], ['integration-only', 'admin', ['integrations']]]) {
    run('INSERT INTO users(id,email,name,password_hash,role,permissions,created_at) VALUES(?,?,?,?,?,?,?)', userId, `${userId}@example.test`, userId, 'unused-fixture-password', role, JSON.stringify(permissions), now());
  }
  upstream = http.createServer(async (req, res) => {
    if (req.method === 'GET') { const task = [...tasks.values()].find(task => req.url.includes(`/workflows/run/${task.runId}`)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: task?.status || 'running' })); }
    let body = ''; for await (const bytes of req) body += bytes;
    const parsed = JSON.parse(body || '{}');
    if (req.url.endsWith('/stop')) {
      const taskId = decodeURIComponent(req.url.split('/').at(-2)), task = tasks.get(taskId);
      if (task) { task.status = 'stopped'; clearInterval(task.timer); writeEvent(task.res, { event: 'workflow_finished', task_id: taskId, workflow_run_id: task.runId, data: { status: 'stopped' } }); task.res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"result":"success"}');
    }
    requests.push(parsed);
    const serial = ++number, taskId = `task-${serial}`, runId = `run-${serial}`;
    const task = { status: 'running', res, runId }; tasks.set(taskId, task);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    writeEvent(res, { event: 'workflow_started', task_id: taskId, workflow_run_id: runId, conversation_id: `upstream-conversation-${serial}` });
    writeEvent(res, { event: 'node_started' });
    if (parsed.query.includes('SLOW')) {
      writeEvent(res, { event: 'message', answer: '已保留的部分回答' });
      task.timer = setInterval(() => writeEvent(res, { event: 'message', answer: '迟到片段' }), 250);
      res.on('close', () => clearInterval(task.timer)); return;
    }
    const answer = `答案 ${serial}，对应问题：${parsed.query.split('当前用户问题：\n').at(-1)}`;
    writeEvent(res, { event: 'message', answer: answer.slice(0, 5) });
    writeEvent(res, { event: 'message', answer: answer.slice(5) });
    task.status = 'succeeded'; writeEvent(res, { event: 'message_end', message_id: `remote-message-${serial}` }); writeEvent(res, { event: 'workflow_finished', task_id: taskId, workflow_run_id: runId, data: { status: 'succeeded' } }); res.end();
  });
  upstreamUrl = await listen(upstream);
  run('INSERT INTO integrations(id,name,platform,base_url,secret,config,created_at) VALUES(?,?,?,?,?,?,?)', 'test-dify', 'Dify fixture', 'dify', `${upstreamUrl}/v1`, encrypt('fixture-secret'), JSON.stringify({ mode: 'chatflow' }), now());
  run('INSERT INTO agents(id,name,published,integration_id,created_at) VALUES(?,?,?,?,?)', 'test-agent', '测试智能体', 1, 'test-dify', now());
  run("UPDATE groups SET agent_ids='[\"*\"]' WHERE id IN ('guest','member')");
  const app = express(); app.use(express.json());
  // Deliberately isolated fixture identity; real cookie/auth tests live elsewhere.
  app.use((req, res, next) => {
    req.user = req.headers['x-test-user'] ? get('SELECT * FROM users WHERE id=?', req.headers['x-test-user']) : null;
    req.guestId = String(req.headers['x-test-guest'] || 'g-default');
    req.identity = { id: req.user?.id || req.guestId, type: req.user ? 'user' : 'guest', groups: [req.user ? 'member' : 'guest'], user: req.user };
    next();
  });
  app.use('/api', chatRouter);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message, code: error.code || 'ERROR' }));
  server = http.createServer(app); baseUrl = await listen(server);
});
after(async () => { for (const task of tasks.values()) clearInterval(task.timer); await close(server); await close(upstream); db.close(); });
function request(path, { user = 'u1', guest = 'g-default', method = 'GET', body } = {}) {
  return fetch(baseUrl + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}), 'x-test-guest': guest }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(path, options) { const response = await request(path, options); const value = await response.json(); assert.ok(response.ok, `${response.status} ${JSON.stringify(value)}`); return value; }
async function conversation(options) { return json('/conversations', { ...options, method: 'POST', body: { agentId: 'test-agent' } }); }
async function message(id, content, options = {}) {
  const response = await request(`/conversations/${id}/messages`, { ...options, method: 'POST', body: { content } }); assert.equal(response.status, 200);
  const events = []; for await (const frame of readSSE(response.body)) events.push(JSON.parse(frame.data));
  return events;
}
async function partialMessage(id, options = {}) {
  const response = await request(`/conversations/${id}/messages`, { ...options, method: 'POST', body: { content: 'SLOW waiting for cancel' } });
  assert.equal(response.status, 200);
  const iterator = readSSE(response.body)[Symbol.asyncIterator](); let versionId;
  while (true) {
    const frame = await iterator.next(); assert.equal(frame.done, false);
    const event = JSON.parse(frame.value.data);
    if (event.type === 'start') versionId = event.versionId;
    if (event.type === 'delta') return { iterator, versionId, text: event.text };
  }
}

test('ownership, guest share ban, and serving historical content after agent unpublish', async () => {
  const row = await conversation(); await message(row.id, '隔离测试');
  assert.equal((await request(`/conversations/${row.id}`, { user: 'u2' })).status, 404);
  assert.equal((await request(`/conversations/${row.id}/messages`, { user: 'u2', method: 'POST', body: { content: '越权' } })).status, 404);
  const guest = await conversation({ user: null, guest: 'guest-own' });
  assert.equal((await request(`/conversations/${guest.id}/shares`, { user: null, guest: 'guest-own', method: 'POST', body: {} })).status, 401);
  run('UPDATE agents SET published=0 WHERE id=?', 'test-agent');
  try {
    assert.equal((await request(`/conversations/${row.id}`)).status, 200);
    assert.equal((await request(`/conversations/${row.id}/messages`, { method: 'POST', body: { content: '拒绝新调用' } })).status, 403);
  } finally { run('UPDATE agents SET published=1 WHERE id=?', 'test-agent'); }
});

test('regeneration preserves old versions; activating an old answer controls exact subsequent upstream history', async () => {
  const row = await conversation(); await message(row.id, '第一问');
  const first = await json(`/conversations/${row.id}`), messageId = first.messages[0].id, oldVersion = first.messages[0].activeVersionId;
  await message(row.id, '废弃分支中的后续问题');
  const regenerate = await request(`/conversations/${row.id}/messages/${messageId}/regenerate`, { method: 'POST', body: {} }); await regenerate.text();
  const after = await json(`/conversations/${row.id}`);
  assert.equal(after.messages.length, 1); assert.equal(after.messages[0].versions.length, 2);
  assert.notEqual(after.messages[0].activeVersionId, oldVersion);
  assert.equal(requests.at(-1).query, '第一问');
  await json(`/conversations/${row.id}/messages/${messageId}/activate`, { method: 'POST', body: { versionId: oldVersion } });
  await message(row.id, '继续旧版本');
  const last = requests.at(-1), oldAnswer = first.messages[0].versions[0].content;
  assert.ok(last.query.includes(oldAnswer));
  assert.ok(!last.query.includes('废弃分支中的后续问题'));
  assert.equal('conversation_id' in last, false);
  const snapshot = snapshotConversation(row.id);
  assert.deepEqual(snapshot.messages.filter(m => m.role === 'user').map(m => m.content), ['第一问', '继续旧版本']);
  assert.equal(snapshot.messages[1].content, oldAnswer);
});

test('guest migration decline, consent, idempotence and stable upstream identity', async () => {
  const options = { user: null, guest: 'migrate-guest' }, row = await conversation(options);
  await message(row.id, '游客历史', options);
  const upstreamUser = get('SELECT upstream_user FROM conversations WHERE id=?', row.id).upstream_user;
  const declined = await json('/guest/migrate', { user: 'u1', guest: 'migrate-guest', method: 'POST', body: { consent: false } }); assert.equal(declined.migrated, 0);
  assert.equal((await request(`/conversations/${row.id}`)).status, 404);
  const accepted = await json('/guest/migrate', { user: 'u1', guest: 'migrate-guest', method: 'POST', body: { consent: true } }); assert.equal(accepted.migrated, 1);
  const again = await json('/guest/migrate', { user: 'u1', guest: 'migrate-guest', method: 'POST', body: { consent: true } }); assert.equal(again.migrated, 0);
  assert.equal((await request(`/conversations/${row.id}`, options)).status, 404);
  await message(row.id, '账号继续追问');
  assert.equal(requests.at(-1).user, upstreamUser);
  assert.ok(requests.at(-1).query.includes('游客历史'));
});

test('guest migration transaction rolls back every ownership change on failure and remains retryable', async () => {
  const options = { user: null, guest: 'migration-fail-guest' };
  const rows = [await conversation(options), await conversation(options)];
  const original = rows.map(row => get('SELECT upstream_user FROM conversations WHERE id=?', row.id).upstream_user);
  db.exec("CREATE TRIGGER fail_guest_migration BEFORE UPDATE OF owner_type ON conversations WHEN OLD.owner_id='migration-fail-guest' AND NEW.owner_type='user' BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END");
  try {
    const response = await request('/guest/migrate', { user: 'u1', guest: options.guest, method: 'POST', body: { consent: true } });
    assert.equal(response.status, 500);
    assert.ok(rows.every(row => get('SELECT owner_type FROM conversations WHERE id=?', row.id).owner_type === 'guest'));
  } finally { db.exec('DROP TRIGGER fail_guest_migration'); }
  const retry = await json('/guest/migrate', { user: 'u1', guest: options.guest, method: 'POST', body: { consent: true } });
  assert.equal(retry.migrated, 2);
  assert.deepEqual(rows.map(row => get('SELECT upstream_user FROM conversations WHERE id=?', row.id).upstream_user), original);
});

test('running guest migration is blocked without changing ownership, then succeeds after stop', async () => {
  const options = { user: null, guest: 'migration-busy-guest' }, row = await conversation(options);
  const partial = await partialMessage(row.id, options);
  const blocked = await request('/guest/migrate', { user: 'u1', guest: options.guest, method: 'POST', body: { consent: true } });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'MIGRATION_BUSY');
  assert.equal(get('SELECT owner_type FROM conversations WHERE id=?', row.id).owner_type, 'guest');
  await json(`/answers/${partial.versionId}/stop`, { ...options, method: 'POST', body: {} });
  while (!(await partial.iterator.next()).done) {}
  const retry = await json('/guest/migrate', { user: 'u1', guest: options.guest, method: 'POST', body: { consent: true } });
  assert.equal(retry.migrated, 1);
});

test('shares freeze active-version content, expire immediately, and revoke on owner hide', async () => {
  const row = await conversation(); await message(row.id, '分享之前');
  const share = await json(`/conversations/${row.id}/shares`, { method: 'POST', body: {} });
  await message(row.id, '不得进入旧快照');
  const publicSnapshot = await json(`/shares/${share.id}`, { user: null });
  assert.equal(publicSnapshot.messages.length, 2); assert.ok(!JSON.stringify(publicSnapshot).includes('不得进入旧快照'));
  assert.equal('ownerId' in publicSnapshot, false);
  run('UPDATE shares SET expires_at=? WHERE id=?', now() - 1, share.id);
  assert.equal((await request(`/shares/${share.id}`, { user: null })).status, 404);
  const second = await json(`/conversations/${row.id}/shares`, { method: 'POST', body: {} });
  await json(`/conversations/${row.id}`, { method: 'DELETE' });
  assert.equal((await request(`/shares/${second.id}`, { user: null })).status, 404);
  assert.equal((await request(`/conversations/${row.id}`)).status, 404);
  assert.equal((await request(`/admin/conversations/${row.id}`, { user: 'admin' })).status, 200);
});

test('stop race preserves partial answer, verifies remote cancellation, and suppresses late fragments', async () => {
  const row = await conversation();
  const response = await request(`/conversations/${row.id}/messages`, { method: 'POST', body: { content: 'SLOW cancellation' } });
  const events = readSSE(response.body)[Symbol.asyncIterator](); let versionId, first;
  while (true) { const event = JSON.parse((await events.next()).value.data); if (event.type === 'start') versionId = event.versionId; if (event.type === 'delta') { first = event.text; break; } }
  const outcome = await json(`/answers/${versionId}/stop`, { method: 'POST', body: {} });
  assert.equal(outcome.status, 'stopped'); assert.equal(outcome.cancellationState, 'confirmed');
  while (!(await events.next()).done) {}
  const version = get('SELECT * FROM answer_versions WHERE id=?', versionId);
  assert.equal(version.status, 'stopped'); assert.equal(version.content, first); assert.ok(!version.content.includes('迟到片段'));
  const invocation = get('SELECT * FROM usage_logs WHERE version_id=?', versionId);
  assert.equal(invocation.status, 'stopped'); assert.equal(invocation.cancellation_state, 'confirmed');
});

test('client disconnect attempts remote cancellation and preserves the partial answer without success', async () => {
  const row = await conversation(), partial = await partialMessage(row.id);
  await partial.iterator.return();
  const deadline = now() + 2500;
  let version;
  do { version = get('SELECT * FROM answer_versions WHERE id=?', partial.versionId); if (version.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 10)); } while (now() < deadline);
  assert.equal(version.status, 'stopped'); assert.equal(version.content, partial.text);
  assert.equal(version.cancellation_state, 'confirmed'); assert.equal(version.error_code, 'CLIENT_DISCONNECTED');
  assert.equal(get('SELECT status FROM usage_logs WHERE version_id=?', partial.versionId).status, 'stopped');
});

test('restart recovery records unknown status and preserves previously stored partial content', async () => {
  const row = await conversation(), messageId = 'restart-message', versionId = 'restart-version';
  run('INSERT INTO messages(id,conversation_id,content,created_at) VALUES(?,?,?,?)', messageId, row.id, '服务重启问题', now());
  run('INSERT INTO answer_versions(id,message_id,invocation_id,content,status,created_at) VALUES(?,?,?,?,?,?)', versionId, messageId, 'restart-invocation', '重启前的部分回答', 'running', now());
  run('UPDATE conversations SET active_version_id=? WHERE id=?', versionId, row.id);
  run('INSERT INTO usage_logs(id,conversation_id,version_id,actor_type,actor_id,kind,status,started_at,trace_id,execution_requested,dispatched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', 'restart-invocation', row.id, versionId, 'user', 'u1', 'message', 'running', now(), 'restart-trace', 1, now());
  initChatSchema();
  const version = get('SELECT * FROM answer_versions WHERE id=?', versionId);
  assert.equal(version.status, 'unknown'); assert.equal(version.error_code, 'PROCESS_RESTART'); assert.equal(version.content, '重启前的部分回答');
  assert.equal(get('SELECT status FROM usage_logs WHERE id=?', 'restart-invocation').status, 'unknown');
});

test('restricted administrators cannot infer body from records, feedback or export-like direct paths', async () => {
  const row = await conversation(); await message(row.id, '权限隔离正文');
  const full = await json(`/conversations/${row.id}`), versionId = full.messages[0].activeVersionId;
  await json(`/answers/${versionId}/feedback`, { method: 'POST', body: { rating: -1, text: '敏感反馈正文' } });
  const records = await json('/admin/conversations', { user: 'limited' });
  assert.ok(records.every(record => !record.messages && record.title === '会话正文受限'));
  const feedback = await json('/admin/feedback', { user: 'limited' });
  assert.ok(feedback.every(record => record.question === undefined && record.answer === undefined && record.text === undefined));
  assert.equal((await request(`/admin/conversations/${row.id}`, { user: 'limited' })).status, 403);
  assert.equal((await request('/admin/conversations?q=权限', { user: 'limited' })).status, 403);
  assert.equal((await request('/admin/integrations/test-dify/test', { user: 'integration-only', method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/admin/conversations/purge', { user: 'limited', method: 'POST', body: { ids: [row.id], confirm: true } })).status, 403);
});

test('permanent purge removes every body-bearing local copy and keeps body-free invocation metadata', async () => {
  const row = await conversation(); await message(row.id, '永久清理正文');
  const full = await json(`/conversations/${row.id}`), versionId = full.messages[0].activeVersionId;
  const invocationId = full.messages[0].versions[0].invocationId;
  await json(`/answers/${versionId}/feedback`, { method: 'POST', body: { rating: 1, text: '清理反馈' } });
  const share = await json(`/conversations/${row.id}/shares`, { method: 'POST', body: {} });
  assert.equal((await request('/admin/conversations/purge', { user: 'admin', method: 'POST', body: { ids: [row.id] } })).status, 400);
  const result = await json('/admin/conversations/purge', { user: 'admin', method: 'POST', body: { ids: [row.id], confirm: true } }); assert.equal(result.deleted, 1);
  assert.equal(get('SELECT * FROM conversations WHERE id=?', row.id), undefined);
  assert.equal(get('SELECT * FROM answer_versions WHERE id=?', versionId), undefined);
  assert.equal(get('SELECT * FROM shares WHERE id=?', share.id), undefined);
  assert.equal(get('SELECT * FROM feedback WHERE version_id=?', versionId), undefined);
  const usage = get('SELECT * FROM usage_logs WHERE id=?', invocationId); assert.ok(usage); assert.equal(usage.conversation_id, null); assert.equal(usage.version_id, null);
  assert.ok(!JSON.stringify(usage).includes('永久清理正文'));
});

test('guest browser access and server retention have different clocks; user records survive', async () => {
  const guestOptions = { user: null, guest: 'retention-guest' }, guest = await conversation(guestOptions), user = await conversation();
  await message(guest.id, '游客保留测试', guestOptions); await message(user.id, '账号长期保留');
  run('UPDATE conversations SET last_active_at=? WHERE id=?', now() - 8 * 86400000, guest.id);
  assert.equal((await request(`/conversations/${guest.id}`, guestOptions)).status, 404);
  assert.equal((await request(`/admin/conversations/${guest.id}`, { user: 'admin' })).status, 200);
  await runRetention(); assert.ok(get('SELECT id FROM conversations WHERE id=?', guest.id));
  run('UPDATE conversations SET last_active_at=? WHERE id IN (?,?)', now() - 181 * 86400000, guest.id, user.id);
  await runRetention();
  assert.equal(get('SELECT id FROM conversations WHERE id=?', guest.id), undefined);
  assert.ok(get('SELECT id FROM conversations WHERE id=?', user.id));
});

test('configuration rejection stays an attempt; development demonstration is separate from real upstream calls', async () => {
  run('INSERT INTO integrations(id,name,platform,created_at) VALUES(?,?,?,?)', 'test-polymas-blocked', '正式资料未配置', 'polymas', now());
  run('INSERT INTO agents(id,name,published,integration_id,created_at) VALUES(?,?,?,?,?)', 'test-blocked-agent', '未配置智能体', 1, 'test-polymas-blocked', now());
  const blocked = await json('/conversations', { method: 'POST', body: { agentId: 'test-blocked-agent' } });
  const rejected = await message(blocked.id, '不能假报执行');
  assert.equal(rejected.find(event => event.type === 'error').code, 'POLYMAS_CREDENTIALS_REQUIRED');
  const rejectedLog = get('SELECT * FROM usage_logs WHERE conversation_id=?', blocked.id);
  assert.equal(rejectedLog.execution_requested, 0); assert.equal(rejectedLog.dispatched_at, null);
  const rejectedStats = await json('/admin/statistics?agentId=test-blocked-agent', { user: 'admin' });
  assert.equal(rejectedStats.totals.attempts, 1); assert.equal(rejectedStats.totals.calls, 0); assert.equal(rejectedStats.totals.configRejected, 1);
  const failedMessage = rejected.find(event => event.type === 'start').messageId;
  const retry = await request(`/conversations/${blocked.id}/messages/${failedMessage}/regenerate`, { method: 'POST', body: {} });await retry.text();
  const retryLogs = all('SELECT kind,id FROM usage_logs WHERE conversation_id=? ORDER BY started_at,id', blocked.id);
  assert.equal(retryLogs.length,2);assert.deepEqual(retryLogs.map(log=>log.kind),['message','retry']);assert.notEqual(retryLogs[0].id,retryLogs[1].id);
  const demo = await json('/conversations', { method: 'POST', body: { agentId: 'demo-campus' } });
  await message(demo.id, '演示不等于上游执行');
  const demoStats = await json('/admin/statistics?agentId=demo-campus', { user: 'admin' });
  assert.equal(demoStats.totals.calls, 0); assert.equal(demoStats.totals.demoCalls, 1);
});

test('20 concurrent fixture HTTP calls keep independent conversation, invocation, identity and answer records', async context => {
  const identities = Array.from({ length: 20 }, (_, index) => ({ user: null, guest: `capacity-guest-${index}` }));
  const rows = await Promise.all(identities.map(identity => conversation(identity)));
  const stamp = performance.now();
  const outcomes = await Promise.all(rows.map((row, index) => message(row.id, `并发请求-${index}`, identities[index])));
  const elapsedMs = performance.now() - stamp;
  const ids = outcomes.map(events => events.find(event => event.type === 'start').invocationId);
  assert.equal(new Set(ids).size, 20);
  for (const [index, events] of outcomes.entries()) {
    assert.equal(events.at(-1).status, 'completed');
    const snapshot = snapshotConversation(rows[index].id);
    assert.equal(snapshot.messages.length, 2);
    assert.ok(snapshot.messages[1].content.endsWith(`并发请求-${index}`));
  }
  assert.equal(new Set(rows.map(row => get('SELECT upstream_user FROM conversations WHERE id=?', row.id).upstream_user)).size, 20);
  const calls = ids.map(invocationId => get('SELECT * FROM usage_logs WHERE id=?', invocationId));
  assert.equal(new Set(calls.map(call => call.actor_id)).size, 20);
  assert.ok(calls.every(call => call.status === 'completed' && Number.isFinite(call.first_answer_ms) && call.execution_requested === 1 && call.execution_mode === 'upstream' && Number.isFinite(call.dispatched_at)));
  context.diagnostic(JSON.stringify({ source: 'local-protocol-fixture-only', concurrent: 20, succeeded: calls.length, elapsedMs, firstAnswerMs: calls.map(call => call.first_answer_ms), durationMs: calls.map(call => call.duration_ms), rssBytes: process.memoryUsage().rss }));
});
