import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readSSE } from '../server/adapters/sse.js';

process.env.DATABASE_PATH = ':memory:';
process.env.ENCRYPTION_KEY = '22'.repeat(32);
process.env.ENABLE_DEMO_ADAPTER = 'true';
process.env.NODE_ENV = 'test';
const { initCoreSchema, db, get, run, now } = await import('../server/db.js');
const { hashToken } = await import('../server/security.js');
const { initChatSchema, chatRouter, snapshotConversation } = await import('../server/chat.js');
const { librechatCompatRouter } = await import('../server/librechat-compat.js');
let server, base;
const NO_PARENT = '00000000-0000-0000-0000-000000000000';
before(async () => {
  initCoreSchema(); initChatSchema();
  for (const userId of ['owner', 'other']) { run('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', userId, `${userId}@example.test`, userId, 'fixture-unused', now()); run('INSERT INTO user_groups(user_id,group_id) VALUES(?,?)', userId, 'member'); }
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = req.headers['x-user'] ? get('SELECT * FROM users WHERE id=?', req.headers['x-user']) : null; req.guestId = String(req.headers['x-guest'] || 'guest1'); req.identity = { id: req.user?.id || req.guestId, type: req.user ? 'user' : 'guest', groups: [req.user ? 'member' : 'guest'] }; next(); });
  app.use('/api/librechat', librechatCompatRouter); app.use('/api', chatRouter);
  app.use((error, req, res, next) => { if (res.headersSent) return res.end(); res.status(error.status || 500).json({ error: error.message, code: error.code }); });
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
function request(path, { user = 'owner', method = 'GET', body, guest = 'guest1' } = {}) { return fetch(base + '/api/librechat' + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}), 'x-guest': guest }, body: body == null ? undefined : JSON.stringify(body) }); }
async function json(path, options) { const response = await request(path, options), value = await response.json(); assert.ok(response.ok, `${response.status} ${JSON.stringify(value)}`); return value; }
async function start(body = {}, options) { const payload = { text: '原生 LibreChat 对话', messageId: randomUUID(), clientRequestId: randomUUID(), model: 'demo-campus', endpoint: 'campus', conversationId: 'new', parentMessageId: NO_PARENT, ...body }; const result = await json('/agents/chat/campus', { ...options, method: 'POST', body: payload }); return { result, payload }; }
async function stream(result, options) { const response = await request(`/agents/chat/stream/${result.streamId}?generationCreatedAt=${result.generationCreatedAt}`, options); assert.equal(response.status, 200); const events = []; for await (const frame of readSSE(response.body)) events.push(JSON.parse(frame.data)); return events; }

test('actual LibreChat JSON admission and SSE created/sync/cumulative/final reuse original campus data', async () => {
  const { result } = await start(); assert.equal(result.generationProtocolVersion, 1); assert.ok(Number.isSafeInteger(result.generationCreatedAt));
  const frames = await stream(result);
  assert.equal(frames[0].created, true); assert.equal(frames[1].sync, true);
  const final = frames.at(-1); assert.equal(final.final, true); assert.equal(final.terminalStatus, 'complete');
  assert.equal(final.requestMessage.isCreatedByUser, true); assert.equal(final.responseMessage.isCreatedByUser, false);
  assert.equal(final.responseMessage.messageId, result.streamId);
  assert.equal(final.responseMessage.parentMessageId, final.requestMessage.messageId);
  assert.equal(final.conversation.conversationId, result.conversationId);
  assert.ok(frames.filter(frame => frame.message === true).length > 2);
  const persisted = snapshotConversation(result.conversationId); assert.equal(persisted.messages[1].content, final.responseMessage.text);
  const native = await json(`/messages/${result.conversationId}`); assert.equal(native.length, 2); assert.equal(native[1].messageId, result.streamId);
  const list = await json('/convos'); assert.ok(list.conversations.some(row => row.conversationId === result.conversationId));
});

test('network retry request IDs deduplicate execution, reject changed payload and preserve settled reconnect', async () => {
  const { result, payload } = await start();
  const duplicate = await json('/agents/chat/campus', { method: 'POST', body: payload }); assert.equal(duplicate.streamId, result.streamId); assert.equal(duplicate.status, 'resumed');
  const changed = await request('/agents/chat/campus', { method: 'POST', body: { ...payload, text: '重复标识换问题' } }); assert.equal(changed.status, 409);
  await stream(result);
  const replay = await stream(result); assert.equal(replay.at(-1).final, true);
  assert.equal(get('SELECT count(*) count FROM usage_logs WHERE conversation_id=?', result.conversationId).count, 1);
});

test('native stop is generation-fenced and retains partial body/cancellation fact', async () => {
  const { result } = await start({ text: '足够长的开发演示停止生成问题，用于验证原生停止按钮。' });
  const stale = await request('/agents/chat/abort', { method: 'POST', body: { streamId: result.streamId, generationCreatedAt: result.generationCreatedAt - 1 } }); assert.equal(stale.status, 409);
  const stopped = await json('/agents/chat/abort', { method: 'POST', body: { conversationId: result.conversationId, generationCreatedAt: result.generationCreatedAt } });
  assert.equal(stopped.cancellationState, 'local_only');
  const replay = await stream(result); assert.equal(replay.at(-1).aborted, true); assert.equal(replay.at(-1).responseMessage.metadata.campusStatus, 'stopped');
  assert.equal((await json(`/agents/chat/status/${result.conversationId}`)).active, false);
});

test('native branch regeneration preserves sibling IDs and next turn follows explicitly selected version', async () => {
  const first = await start(); const frames = await stream(first.result), original = frames.at(-1);
  const regenerated = await start({ conversationId: first.result.conversationId, text: first.payload.text, messageId: original.requestMessage.messageId, parentMessageId: original.requestMessage.parentMessageId, isRegenerate: true });
  await stream(regenerated.result);
  let messages = await json(`/messages/${first.result.conversationId}`);
  assert.equal(messages.filter(message => !message.isCreatedByUser).length, 2);
  assert.equal(messages.at(-1).messageId, regenerated.result.streamId);
  await json(`/messages/${first.result.conversationId}/${first.result.streamId}/activate`, { method: 'POST', body: {} });
  messages = await json(`/messages/${first.result.conversationId}`); assert.equal(messages.at(-1).messageId, first.result.streamId);
  const next = await start({ conversationId: first.result.conversationId, text: '旧分支继续提问', parentMessageId: first.result.streamId }); await stream(next.result);
  const question = get('SELECT m.* FROM messages m JOIN answer_versions v ON v.message_id=m.id WHERE v.id=?', next.result.streamId); assert.equal(question.parent_version_id, first.result.streamId);
});

test('actual native regeneration accepts a validated override user ID with fresh optimistic IDs', async () => {
  const first = await start({ text: '原生重新生成按钮的问题' });
  const original = (await stream(first.result)).at(-1);
  const body = { conversationId: first.result.conversationId, text: first.payload.text, messageId: randomUUID(), parentMessageId: NO_PARENT, overrideParentMessageId: original.requestMessage.messageId, responseMessageId: first.result.streamId + '_', isRegenerate: true, generationProtocolVersion: 2 };
  const regenerated = await start(body); const final = (await stream(regenerated.result)).at(-1);
  assert.equal(final.requestMessage.messageId, original.requestMessage.messageId);
  assert.notEqual(final.responseMessage.messageId, original.responseMessage.messageId);
  const graph = await json(`/messages/${first.result.conversationId}`);
  assert.equal(graph.filter(message => message.isCreatedByUser).length, 1);
  assert.equal(graph.filter(message => !message.isCreatedByUser).length, 2);
  const changed = await request('/agents/chat/campus', { method: 'POST', body: { ...regenerated.payload, overrideParentMessageId: 'm_foreign' } }); assert.equal(changed.status, 409);
  for (const invalid of [{ ...body, overrideParentMessageId: 'm_foreign' }, { ...body, text: '换过的原始问题' }]) {
    const rejected = await request('/agents/chat/campus', { method: 'POST', body: { ...invalid, clientRequestId: randomUUID() } }); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, 'INVALID_REGENERATION');
  }
});

test('activating the visible descendant leaf restores full native history and immediate export after an ancestor switch', async () => {
  const first = await start({ text: '有后续子分支的原问题' }), original = (await stream(first.result)).at(-1);
  const second = await start({ conversationId: first.result.conversationId, parentMessageId: first.result.streamId, text: '已保存的第二轮应在导出中保留' }); await stream(second.result);
  const regenerated = await start({ conversationId: first.result.conversationId, text: first.payload.text, isRegenerate: true, overrideParentMessageId: original.requestMessage.messageId }); await stream(regenerated.result);
  // Exact ancestor activation is deliberately a prefix selection, used when
  // explicitly forking a new question from that parent. Keep that contract.
  await json(`/messages/${first.result.conversationId}/${first.result.streamId}/activate`, { method: 'POST', body: {} });
  assert.equal(snapshotConversation(first.result.conversationId).messages.length, 2);
  const graph = await json(`/messages/${first.result.conversationId}`);
  assert.ok(graph.some(message => message.messageId === second.result.streamId));
  // Native sibling switching displays existing descendants, so the UI hook
  // resolves and activates that visible leaf before committing the switch.
  await json(`/messages/${first.result.conversationId}/${second.result.streamId}/activate`, { method: 'POST', body: {} });
  assert.equal(snapshotConversation(first.result.conversationId).messages.length, 4);
  assert.equal(get('SELECT active_version_id FROM conversations WHERE id=?', first.result.conversationId).active_version_id, second.result.streamId);
  const exported = await request(`/convos/${first.result.conversationId}/export?format=md`);
  assert.equal(exported.status, 200); assert.ok((await exported.text()).includes('已保存的第二轮应在导出中保留'));
  const share = await json(`/share/${first.result.conversationId}`, { method: 'POST', body: {} });
  assert.equal((await json(`/share/${share.shareId}`, { user: null })).messages.length, 4);
});

test('native conv rename/archive/pin persist and native feedback traces exact canonical answer', async () => {
  const { result } = await start(); await stream(result);
  const renamed = await json('/convos/update', { method: 'POST', body: { arg: { conversationId: result.conversationId, title: '原生重命名' } } }); assert.equal(renamed.title, '原生重命名');
  const pinned = await json('/convos/pin', { method: 'POST', body: { arg: { conversationId: result.conversationId, pinned: true } } }); assert.equal(pinned.pinned, true);
  const archived = await json('/convos/archive', { method: 'POST', body: { arg: { conversationId: result.conversationId, isArchived: true } } }); assert.equal(archived.isArchived, true);
  assert.ok((await json('/convos?isArchived=true')).conversations.some(row => row.conversationId === result.conversationId));
  await json(`/messages/${result.conversationId}/${result.streamId}/feedback`, { method: 'PUT', body: { feedback: { rating: 'thumbsDown', tag: 'inaccurate', text: '原生反馈正文' } } });
  assert.equal(get('SELECT text FROM feedback WHERE version_id=?', result.streamId).text, '原生反馈正文');
});

test('native edit of first question preserves both root branches and orders the selected root last on reload', async () => {
  const first = await start({ text: '最初的问题' }); await stream(first.result);
  const edited = await start({ text: '编辑后的第一问', conversationId: first.result.conversationId, parentMessageId: NO_PARENT }); await stream(edited.result);
  let graph = await json(`/messages/${first.result.conversationId}`); assert.equal(graph.filter(message => message.isCreatedByUser && message.parentMessageId === NO_PARENT).length, 2); assert.equal(graph.at(-1).messageId, edited.result.streamId);
  await json(`/messages/${first.result.conversationId}/${first.result.streamId}/activate`, { method: 'POST', body: {} });
  graph = await json(`/messages/${first.result.conversationId}`); assert.equal(graph.at(-1).messageId, first.result.streamId); assert.equal(snapshotConversation(first.result.conversationId).messages[0].content, '最初的问题');
});

test('native shares freeze content, revoke on hide, and cross-user/guest actions cannot bypass original authorization', async () => {
  const { result } = await start(); await stream(result);
  for (const path of [`/convos/${result.conversationId}`, `/messages/${result.conversationId}`, `/agents/chat/stream/${result.streamId}`, `/agents/chat/status/${result.conversationId}`]) assert.equal((await request(path, { user: 'other' })).status, 404);
  const share = await json(`/share/${result.conversationId}`, { method: 'POST', body: {} });
  assert.ok((await json('/share')).links.some(link => link.shareId === share.shareId));
  const publicContent = await json(`/share/${share.shareId}`, { user: null }); assert.equal(publicContent.messages.length, 2); assert.equal(publicContent.conversationId, null);
  assert.equal(Date.parse(publicContent.createdAt), get('SELECT created_at FROM shares WHERE id=?', share.shareId).created_at);
  assert.equal(publicContent.updatedAt, publicContent.createdAt); assert.ok(Number.isFinite(Date.parse(publicContent.expiresAt)));
  for (const message of publicContent.messages) { assert.ok(Number.isFinite(Date.parse(message.createdAt))); assert.equal(message.updatedAt, publicContent.createdAt); }
  assert.equal((await request(`/share/${result.conversationId}`, { user: null, method: 'POST', body: {} })).status, 401);
  assert.equal((await request(`/convos/${result.conversationId}/export?format=md`, { user: 'other' })).status, 404);
  assert.equal((await request(`/convos/${result.conversationId}/export?format=md`, { user: null })).status, 401);
  const markdown = await request(`/convos/${result.conversationId}/export?format=md`); assert.equal(markdown.status, 200); assert.ok((await markdown.text()).includes('原生 LibreChat 对话'));
  await json('/convos', { method: 'DELETE', body: { arg: { conversationId: result.conversationId } } });
  assert.equal((await request(`/share/${share.shareId}`, { user: null })).status, 404);
});

test('native guest history can read its empty share metadata without triggering account auth recovery', async () => {
  const { result } = await start({}, { user: null, guest: 'share-metadata-guest' }); await stream(result, { user: null, guest: 'share-metadata-guest' });
  const metadata = await json(`/share/link/${result.conversationId}`, { user: null, guest: 'share-metadata-guest' });
  assert.deepEqual(metadata, { shareId: null, conversationId: result.conversationId, success: true, snapshotFiles: false });
  assert.equal((await request(`/share/link/${result.conversationId}`, { user: null, guest: 'different-guest' })).status, 404);
  assert.equal((await request(`/share/link/${result.conversationId}`, { user: 'owner' })).status, 404);
  assert.equal((await request(`/share/${result.conversationId}`, { user: null, guest: 'share-metadata-guest', method: 'POST', body: {} })).status, 401);
  assert.equal((await request(`/convos/${result.conversationId}/export?format=md`, { user: null, guest: 'share-metadata-guest' })).status, 401);
});

test('disabled native tool-call history returns a real empty array only for an owned visible conversation', async () => {
  const own = await start(); await stream(own.result);
  const path = `/agents/tools/calls?conversationId=${own.result.conversationId}`;
  const attempts = get('SELECT count(*) count FROM usage_logs WHERE conversation_id=?', own.result.conversationId).count;
  assert.deepEqual(await json(path), []);
  assert.equal((await request(path, { user: 'other' })).status, 404);
  assert.equal((await request(path, { user: null })).status, 404);
  assert.equal((await request('/agents/tools/calls')).status, 400);
  assert.equal((await request(path + '&conversationId=another')).status, 400);
  assert.equal(get('SELECT count(*) count FROM usage_logs WHERE conversation_id=?', own.result.conversationId).count, attempts);
  const guest = await start({}, { user: null, guest: 'native-tool-guest' }); await stream(guest.result, { user: null, guest: 'native-tool-guest' });
  const guestPath = `/agents/tools/calls?conversationId=${guest.result.conversationId}`;
  assert.deepEqual(await json(guestPath, { user: null, guest: 'native-tool-guest' }), []);
  assert.equal((await request(guestPath, { user: null, guest: 'another-tool-guest' })).status, 404);
  await json('/convos', { method: 'DELETE', body: { arg: { conversationId: own.result.conversationId } } });
  assert.equal((await request(path)).status, 404);
});

test('native share target contains only the chosen branch prefix and history search stays owner scoped', async () => {
  const first = await start({ text: '只分享这一问' }); await stream(first.result);
  const next = await start({ text: '后续敏感内容不应泄露', conversationId: first.result.conversationId, parentMessageId: first.result.streamId }); await stream(next.result);
  const share = await json(`/share/${first.result.conversationId}`, { method: 'POST', body: { targetMessageId: first.result.streamId } });
  const snapshot = await json(`/share/${share.shareId}`, { user: null }); assert.equal(snapshot.messages.length, 2); assert.ok(!JSON.stringify(snapshot).includes('后续敏感内容'));
  const selected = await json(`/share/link/${first.result.conversationId}`); assert.equal(selected.targetMessageId, first.result.streamId);
  const matches = await json('/messages?search=' + encodeURIComponent('后续敏感内容')); assert.ok(matches.messages.some(message => message.conversationId === first.result.conversationId));
  const denied = await json('/messages?search=' + encodeURIComponent('后续敏感内容'), { user: 'other' }); assert.equal(denied.messages.length, 0);
  const foreign = await start({}, { user: 'other' }); await stream(foreign.result, { user: 'other' });
  const invalid = await request(`/share/${first.result.conversationId}`, { method: 'POST', body: { targetMessageId: foreign.result.streamId } }); assert.equal(invalid.status, 404);
});

test('native delete all hides more than one history page while preserving another owner', async () => {
  run('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', 'bulk-owner', 'bulk@example.test', 'bulk', 'fixture-unused', now());
  const foreign = get('SELECT id FROM conversations WHERE owner_id=? AND hidden_at IS NULL LIMIT 1', 'owner');
  for (let index = 0; index < 501; index++) run('INSERT INTO conversations(id,owner_type,owner_id,agent_id,title,upstream_user,created_at,updated_at,last_active_at) VALUES(?,?,?,?,?,?,?,?,?)', 'bulk-' + index, 'user', 'bulk-owner', 'demo-campus', '分页历史', 'bulk-upstream-' + index, now(), now(), now());
  const deleted = await json('/convos/all', { user: 'bulk-owner', method: 'DELETE' });
  assert.equal(deleted.deletedCount, 501); assert.equal(get('SELECT count(*) count FROM conversations WHERE owner_id=? AND hidden_at IS NULL', 'bulk-owner').count, 0);
  assert.equal(get('SELECT hidden_at FROM conversations WHERE id=?', foreign.id).hidden_at, null);
});

test('production createApp mount and real campus cookie authorize native admission, stream and history', async () => {
  const { createApp } = await import('../server/index.js');
  const mounted = http.createServer(createApp()); await new Promise(resolve => mounted.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${mounted.address().port}`, session = randomUUID();
  run('INSERT INTO sessions(id,user_id,version,created_at,expires_at) VALUES(?,?,?,?,?)', hashToken(session), 'owner', 0, now(), now() + 60000);
  const headers = { 'Content-Type': 'application/json', Cookie: `school_session=${session}` };
  try {
    const config = await (await fetch(origin + '/api/librechat/config', { headers })).json(), spec = config.modelSpecs.list.find(value => value.name === 'demo-campus');
    assert.equal(spec.preset.endpoint, 'campus'); assert.equal(spec.preset.model, 'demo-campus');
    const response = await fetch(origin + '/api/librechat/agents/chat/campus', { method: 'POST', headers, body: JSON.stringify({ text: '实际服务挂载验证', model: spec.preset.model, spec: spec.name, conversationId: 'new', messageId: randomUUID(), clientRequestId: randomUUID(), parentMessageId: NO_PARENT }) });
    assert.equal(response.status, 200); const started = await response.json();
    const streamed = await fetch(origin + `/api/librechat/agents/chat/stream/${started.streamId}`, { headers }); const frames = [];
    for await (const frame of readSSE(streamed.body)) frames.push(JSON.parse(frame.data));
    assert.equal(frames.at(-1).final, true); assert.equal(frames.at(-1).responseMessage.metadata.campusStatus, 'completed');
    const finalConversation = frames.at(-1).conversation;
    assert.equal(finalConversation.spec, spec.name); assert.equal(finalConversation.model, spec.preset.model); assert.equal(finalConversation.endpoint, spec.preset.endpoint); assert.equal(finalConversation.endpointType, 'custom');
    const detail = await (await fetch(origin + `/api/librechat/convos/${started.conversationId}`, { headers })).json(); assert.equal(detail.spec, spec.name);
    const history = await (await fetch(origin + '/api/librechat/convos', { headers })).json(); assert.equal(history.conversations.find(value => value.conversationId === started.conversationId).spec, spec.name);
    const native = await fetch(origin + `/api/librechat/messages/${started.conversationId}`, { headers }); assert.equal(native.status, 200); assert.equal((await native.json()).length, 2);
    const tools = await fetch(origin + `/api/librechat/agents/tools/calls?conversationId=${started.conversationId}`, { headers }); assert.equal(tools.status, 200); assert.deepEqual(await tools.json(), []);
    const campus = await fetch(origin + `/api/conversations/${started.conversationId}`, { headers }); assert.equal(campus.status, 200); assert.equal((await campus.json()).messages[0].content, '实际服务挂载验证');
    const memberAccess = get('SELECT agent_ids FROM groups WHERE id=?', 'member').agent_ids;
    for (const restriction of ['unpublished', 'group-revoked']) {
      if (restriction === 'unpublished') run('UPDATE agents SET published=0 WHERE id=?', 'demo-campus');
      else run('UPDATE groups SET agent_ids=? WHERE id=?', '[]', 'member');
      try {
        const restrictedConfig = await (await fetch(origin + '/api/librechat/config', { headers })).json(); assert.ok(!restrictedConfig.modelSpecs.list.some(value => value.name === spec.name));
        const retained = await fetch(origin + `/api/librechat/convos/${started.conversationId}`, { headers }); assert.equal(retained.status, 200); assert.equal((await retained.json()).model, spec.preset.model);
        const retainedMessages = await fetch(origin + `/api/librechat/messages/${started.conversationId}`, { headers }); assert.equal(retainedMessages.status, 200); assert.equal((await retainedMessages.json()).length, 2);
        const denied = await fetch(origin + '/api/librechat/agents/chat/campus', { method: 'POST', headers, body: JSON.stringify({ text: '权限变化后禁止新执行', model: spec.preset.model, spec: spec.name, conversationId: started.conversationId, messageId: randomUUID(), clientRequestId: randomUUID(), parentMessageId: started.streamId }) }); assert.equal(denied.status, 403);
        assert.equal(get('SELECT count(*) count FROM usage_logs WHERE conversation_id=?', started.conversationId).count, 1);
      } finally { run('UPDATE agents SET published=1 WHERE id=?', 'demo-campus'); run('UPDATE groups SET agent_ids=? WHERE id=?', memberAccess, 'member'); }
    }
  } finally { mounted.closeIdleConnections(); await new Promise(resolve => mounted.close(resolve)); }
});
