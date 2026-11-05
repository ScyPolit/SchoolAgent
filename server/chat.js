import { Router } from 'express';
import { db, all, get, run, id, now, parse, setting, transaction } from './db.js';
import { HttpError, decrypt, audit, requireUser, requirePermission, canUseAgent, hasPermission } from './security.js';
import { createAdapter } from './adapters/index.js';
import { AdapterError } from './adapters/dify.js';

export const chatRouter = Router();
const activeRuns = new Map();
const DAY = 86400000;
const terminal = new Set(['completed', 'failed', 'stopped', 'unknown']);
const days = (key, fallback) => Number(setting('retention', {})[key] ?? fallback);
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name}不能为空且不能超过 ${max} 个字符`, 'INVALID_INPUT');
  return value.trim();
};

export function initChatSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL CHECK(owner_type IN ('user','guest')),owner_id TEXT NOT NULL,agent_id TEXT NOT NULL REFERENCES agents(id),title TEXT NOT NULL,upstream_user TEXT NOT NULL UNIQUE,active_version_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_active_at INTEGER NOT NULL,hidden_at INTEGER);
    CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner_type,owner_id,hidden_at,last_active_at);
    CREATE INDEX IF NOT EXISTS conversation_agent ON conversations(agent_id,created_at);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,parent_version_id TEXT,content TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id,created_at);
    CREATE TABLE IF NOT EXISTS answer_versions(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,invocation_id TEXT NOT NULL UNIQUE,content TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,cancellation_state TEXT NOT NULL DEFAULT '',error_code TEXT NOT NULL DEFAULT '',error_message TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,finished_at INTEGER);
    CREATE INDEX IF NOT EXISTS version_message ON answer_versions(message_id,created_at);
    CREATE TABLE IF NOT EXISTS usage_logs(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,version_id TEXT,agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,integration_id TEXT,platform TEXT,app_id TEXT,execution_requested INTEGER NOT NULL DEFAULT 0,dispatched_at INTEGER,execution_mode TEXT NOT NULL DEFAULT 'upstream',actor_type TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,duration_ms INTEGER,first_answer_ms INTEGER,error_code TEXT NOT NULL DEFAULT '',trace_id TEXT NOT NULL,cancellation_state TEXT NOT NULL DEFAULT '',upstream_user TEXT,upstream_conversation_id TEXT,upstream_task_id TEXT,upstream_run_id TEXT,upstream_message_id TEXT,source TEXT NOT NULL DEFAULT 'client',parent_invocation_id TEXT,scope TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS usage_time ON usage_logs(started_at,agent_id,actor_type);
    CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS shares_conversation ON shares(conversation_id);
    CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES answer_versions(id) ON DELETE CASCADE,actor_type TEXT NOT NULL,actor_id TEXT NOT NULL,rating INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'open',notes TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(version_id,actor_type,actor_id));
    CREATE INDEX IF NOT EXISTS feedback_state ON feedback(status,created_at);
    INSERT OR IGNORE INTO schema_migrations VALUES(2,unixepoch()*1000);
  `);
  const columns = new Set(all('PRAGMA table_info(usage_logs)').map(column => column.name));
  for (const [name, definition] of [['integration_id', 'TEXT'], ['platform', 'TEXT'], ['app_id', 'TEXT'], ['execution_requested', 'INTEGER NOT NULL DEFAULT 0'], ['dispatched_at', 'INTEGER'], ['execution_mode', "TEXT NOT NULL DEFAULT 'upstream'"]]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE usage_logs ADD COLUMN ${name} ${definition}`);
  }
  if (!columns.has('client_request_id')) db.exec('ALTER TABLE usage_logs ADD COLUMN client_request_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS usage_client_request ON usage_logs(actor_type,actor_id,client_request_id) WHERE client_request_id IS NOT NULL');
  if (!all('PRAGMA table_info(shares)').some(column => column.name === 'target_message_id')) db.exec('ALTER TABLE shares ADD COLUMN target_message_id TEXT');
  // Historical rows without a dispatch signal remain unclassified attempts;
  // never backfill a claim that an upstream request was sent.
  run('INSERT OR IGNORE INTO schema_migrations VALUES(3,?)', now());
  // A process restart cannot establish whether a remote task ended. Never report success.
  const stamp = now();
  run("UPDATE answer_versions SET status='unknown',error_code='PROCESS_RESTART',error_message='服务重启导致执行状态无法核验，请手动重试。',finished_at=? WHERE status='running'", stamp);
  run("UPDATE usage_logs SET status='unknown',error_code='PROCESS_RESTART',finished_at=?,duration_ms=?-started_at WHERE status='running'", stamp, stamp);
}

export function ownedConversation(req, conversationId) {
  const row = get('SELECT * FROM conversations WHERE id=?', conversationId);
  const identity = req.identity;
  if (!row || row.owner_type !== identity?.type || row.owner_id !== identity?.id || row.hidden_at || (row.owner_type === 'guest' && row.last_active_at < now() - days('guestBrowserDays', 7) * DAY)) throw new HttpError(404, '会话不存在或当前身份无权访问', 'CONVERSATION_NOT_FOUND');
  return row;
}

// Each user message points to its exact preceding answer version. Traversing this
// chain gives an immutable branch prefix even after regeneration or version changes.
export function activeConversationMessages(conversation) {
  const result = [], seen = new Set();
  let current = conversation.active_version_id;
  while (current) {
    if (seen.has(current) || seen.size > 10000) throw new HttpError(500, '会话版本链异常', 'INVALID_BRANCH');
    seen.add(current);
    const version = get('SELECT * FROM answer_versions WHERE id=?', current);
    const message = version && get('SELECT * FROM messages WHERE id=? AND conversation_id=?', version.message_id, conversation.id);
    if (!message) throw new HttpError(500, '会话历史关联不完整', 'INVALID_BRANCH');
    result.unshift({ message, version });
    current = message.parent_version_id;
  }
  return result;
}

export function snapshotConversation(conversationId, targetMessageId) {
  if (targetMessageId != null && (typeof targetMessageId !== 'string' || targetMessageId.length > 200)) throw new HttpError(400, '分享目标消息标识无效', 'INVALID_MESSAGE_ID');
  let conversation = get('SELECT * FROM conversations WHERE id=?', conversationId);
  if (!conversation) throw new HttpError(404, '会话不存在', 'CONVERSATION_NOT_FOUND');
  let userTail;
  if (targetMessageId) {
    const answer = get('SELECT v.id FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE v.id=? AND m.conversation_id=?', targetMessageId, conversation.id);
    if (answer) conversation = { ...conversation, active_version_id: answer.id };
    else {
      userTail = get('SELECT * FROM messages WHERE id=? AND conversation_id=?', targetMessageId, conversation.id);
      if (!userTail) throw new HttpError(404, '分享目标消息不属于此会话', 'MESSAGE_NOT_FOUND');
      conversation = { ...conversation, active_version_id: userTail.parent_version_id };
    }
  }
  const messages = activeConversationMessages(conversation).flatMap(({ message, version }) => [{ role: 'user', content: message.content }, { role: 'assistant', content: version.content }]);
  if (userTail) messages.push({ role: 'user', content: userTail.content });
  return { title: conversation.title, messages };
}
function versionView(version) {
  return { id: version.id, content: version.content, status: version.status, createdAt: version.created_at, finishedAt: version.finished_at, invocationId: version.invocation_id, cancellationState: version.cancellation_state, error: version.error_message, errorCode: version.error_code };
}
function conversationView(row, includeMessages = false) {
  const agent = get('SELECT name,published FROM agents WHERE id=?', row.agent_id);
  const result = { id: row.id, agentId: row.agent_id, agentName: agent?.name || '已移除的智能体', title: row.title, ownerType: row.owner_type, ownerId: row.owner_id, createdAt: row.created_at, updatedAt: row.updated_at, hiddenAt: row.hidden_at, agentPublished: Boolean(agent?.published) };
  if (includeMessages) result.messages = activeConversationMessages(row).map(({ message, version }) => ({ id: message.id, content: message.content, createdAt: message.created_at, activeVersionId: version.id, versions: all('SELECT * FROM answer_versions WHERE message_id=? ORDER BY created_at,id', message.id).map(versionView) }));
  return result;
}
function agentFor(req, agentId) {
  const agent = get('SELECT * FROM agents WHERE id=?', agentId);
  if (!canUseAgent(req.identity, agent)) throw new HttpError(403, agent && !agent.published ? '此智能体已下架，历史仍可查看，但不能继续调用。' : '当前身份没有此智能体的调用权限', 'AGENT_FORBIDDEN');
  return agent;
}
function integrationFor(agent) {
  const value = get('SELECT * FROM integrations WHERE id=?', agent.integration_id);
  if (!value) throw new HttpError(409, '智能体尚未配置外部平台', 'INTEGRATION_REQUIRED');
  const secret = decrypt(value.secret);
  const mode = value.platform === 'dify-workflow' ? 'workflow' : value.platform === 'dify-chatflow' ? 'chatflow' : undefined;
  return { ...value, config: { ...(mode ? { mode } : {}), ...parse(value.config, {}) }, capabilities: parse(value.capabilities, {}), secret: parse(secret, secret) };
}
function conflict(conversationId) {
  if ([...activeRuns.values()].some(ctx => ctx.conversationId === conversationId && !ctx.finalized)) throw new HttpError(409, '此会话正在生成回答，请先等待或停止。', 'CONVERSATION_BUSY');
}
function send(res, event) { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); }
function safeError(error) {
  if (error instanceof AdapterError || error instanceof HttpError) return { code: error.code, message: error.message };
  if (error?.name === 'TimeoutError') return { code: 'UPSTREAM_TIMEOUT', message: '上游处理超时；已保留部分回答，请手动重试。' };
  return { code: 'UPSTREAM_UNAVAILABLE', message: '无法完成上游请求；请检查网络或联系管理员，稍后手动重试。' };
}
function contextFor(conversation, message) {
  const prefix = { ...conversation, active_version_id: message.parent_version_id };
  return activeConversationMessages(prefix).flatMap(({ message: input, version }) => [{ role: 'user', content: input.content }, { role: 'assistant', content: version.content }]);
}
function updateMeta(ctx, event) {
  for (const key of ['taskId', 'runId', 'conversationId', 'messageId']) if (event[key]) ctx.meta[key] = event[key];
  run('UPDATE usage_logs SET upstream_task_id=?,upstream_run_id=?,upstream_conversation_id=?,upstream_message_id=? WHERE id=?', ctx.meta.taskId || null, ctx.meta.runId || null, ctx.meta.conversationId || null, ctx.meta.messageId || null, ctx.invocationId);
}
function recordDispatch(invocationId, event) {
  run('UPDATE usage_logs SET execution_requested=1,dispatched_at=coalesce(dispatched_at,?),execution_mode=? WHERE id=?', now(), event.mode === 'demo' ? 'demo' : 'upstream', invocationId);
}
function finish(ctx, status, options = {}) {
  if (ctx.finalized) return;
  ctx.finalized = true;
  clearTimeout(ctx.timeout);
  const stamp = now();
  transaction(() => {
    run('UPDATE answer_versions SET status=?,cancellation_state=?,error_code=?,error_message=?,finished_at=? WHERE id=?', status, options.cancellationState || '', options.code || '', options.message || '', stamp, ctx.versionId);
    run('UPDATE usage_logs SET status=?,cancellation_state=?,error_code=?,finished_at=?,duration_ms=? WHERE id=?', status, options.cancellationState || '', options.code || '', stamp, stamp - ctx.startedAt, ctx.invocationId);
  });
  if (status === 'failed' || status === 'unknown') send(ctx.res, { type: 'error', error: options.message, code: options.code });
  send(ctx.res, { type: 'done', status, versionId: ctx.versionId, message: options.message, cancellationState: options.cancellationState || '' });
  if (!ctx.res.writableEnded) ctx.res.end();
  activeRuns.delete(ctx.versionId);
}
async function stopContext(ctx, reason = 'USER_STOP') {
  if (ctx.finalized) return { state: 'already_finished', message: '回答已经结束。' };
  if (ctx.stopPromise) return ctx.stopPromise;
  ctx.stopRequested = true; // Discard late chunks before sending any network cancel.
  ctx.stopPromise = (async () => {
    let outcome;
    try { outcome = await ctx.adapter.stop({ ...ctx.meta, upstreamUser: ctx.upstreamUser }); }
    catch { outcome = { state: 'failed', message: '已在本地停止；上游取消失败，上游可能仍在执行。' }; }
    if (ctx.remoteTerminal === 'stopped') outcome = { state: 'confirmed', message: '已核验上游任务停止。' };
    else if (ctx.remoteTerminal === 'completed' && outcome.state === 'unknown') outcome = { state: 'completed_before_confirmation', message: '本地已停止显示；上游在取消核验前已完成。' };
    finish(ctx, 'stopped', { cancellationState: outcome.state, message: outcome.message, code: reason });
    ctx.controller.abort();
    return outcome;
  })();
  return ctx.stopPromise;
}

async function invoke(req, res, conversation, message, kind) {
  const agent = agentFor(req, conversation.agent_id);
  const history = contextFor(conversation, message);
  const versionId = id('v_'), invocationId = id('call_'), startedAt = now();
  const external = get('SELECT id,platform,app_id FROM integrations WHERE id=?', agent.integration_id);
  transaction(() => {
    run('INSERT INTO answer_versions(id,message_id,invocation_id,status,created_at) VALUES(?,?,?,?,?)', versionId, message.id, invocationId, 'running', startedAt);
    run('UPDATE conversations SET active_version_id=?,updated_at=?,last_active_at=? WHERE id=?', versionId, startedAt, startedAt, conversation.id);
    run('INSERT INTO usage_logs(id,conversation_id,version_id,agent_id,integration_id,platform,app_id,actor_type,actor_id,kind,status,started_at,trace_id,upstream_user,scope) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', invocationId, conversation.id, versionId, agent.id, external?.id || null, external?.platform || null, external?.app_id || null, req.identity.type, req.identity.id, kind, 'running', startedAt, id('trace_'), conversation.upstream_user, JSON.stringify({ agentId: agent.id }));
    if (req.schoolClientRequestId) run('UPDATE usage_logs SET client_request_id=?,scope=? WHERE id=?', req.schoolClientRequestId, JSON.stringify({ agentId: agent.id, requestFingerprint: req.schoolRequestFingerprint }), invocationId);
  });
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  send(res, { type: 'start', messageId: message.id, versionId, invocationId });
  const ctx = { conversationId: conversation.id, versionId, invocationId, startedAt, controller: new AbortController(), res, upstreamUser: conversation.upstream_user, meta: {}, finalized: false, stopRequested: false, firstAnswer: false };
  activeRuns.set(versionId, ctx);
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
  const disconnect = () => { if (!ctx.finalized) void stopContext(ctx, 'CLIENT_DISCONNECTED'); };
  res.on('close', disconnect);
  try {
    const integration = integrationFor(agent);
    ctx.adapter = createAdapter(integration);
    const timeoutMs = Math.min(600000, Math.max(1000, Number(integration.config.timeoutMs) || 120000));
    ctx.timeout = setTimeout(() => {
      if (!ctx.finalized && !ctx.stopRequested) { finish(ctx, 'unknown', { code: 'UPSTREAM_TIMEOUT', message: '上游处理超时，远端可能仍在执行；已保留部分回答，请手动重试。' }); ctx.controller.abort(); }
    }, timeoutMs);
    const outcome = await ctx.adapter.run({ content: message.content, history, upstreamUser: ctx.upstreamUser, signal: ctx.controller.signal, onEvent: event => {
      if (ctx.finalized) return;
      if (event.type === 'dispatch') { recordDispatch(invocationId, event); return; }
      if (event.type === 'meta') { updateMeta(ctx, event); return; }
      if (ctx.stopRequested) return;
      if (event.type === 'delta' || event.type === 'replace') {
        if (typeof event.text !== 'string') return;
        const updated = run(event.type === 'replace' ? 'UPDATE answer_versions SET content=? WHERE id=? AND status=?' : 'UPDATE answer_versions SET content=content||? WHERE id=? AND status=?', event.text, versionId, 'running');
        if (!updated.changes) return;
        if (!ctx.firstAnswer && event.text) { ctx.firstAnswer = true; run('UPDATE usage_logs SET first_answer_ms=? WHERE id=?', now() - startedAt, invocationId); }
        send(res, { type: event.type, text: event.text });
      } else if (event.type === 'progress') send(res, { type: 'progress', phase: event.phase, message: event.message });
    } });
    ctx.remoteTerminal = outcome.status;
    if (!ctx.stopRequested) {
      finish(ctx, outcome.status, outcome.status === 'stopped' ? { cancellationState: 'confirmed', message: '上游报告任务已停止。' } : {});
      const capabilities = { ...integration.capabilities, connection: { state: outcome.mode === 'demo' ? 'development_demo' : 'observed', at: now() }, output: { state: outcome.mode, at: now(), answerDeltas: outcome.answerDeltas }, multiTurn: { state: 'unverified', strategy: ['workflow','tool'].includes(integration.config.mode) ? (integration.config.historyMode==='question'?'active-history-in-question':integration.config.historyMode==='none'?'single-turn-only':integration.config.historyField?'explicit-history-input':'single-turn-only') : 'fresh-conversation-active-history', at: now() }, cancellation: integration.platform==='polymas'?{state:'local_only'}:integration.capabilities.cancellation || { state: 'unverified' } };
      run('UPDATE integrations SET capabilities=? WHERE id=?', JSON.stringify(capabilities), integration.id);
    }
  } catch (error) {
    if (!ctx.finalized && !ctx.stopRequested) {
      const safe = safeError(error);
      finish(ctx, ['UPSTREAM_INCOMPLETE', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT'].includes(safe.code) ? 'unknown' : 'failed', safe);
    }
  } finally {
    if (ctx.stopPromise) await ctx.stopPromise;
    clearInterval(heartbeat); res.off('close', disconnect);
  }
}

chatRouter.get('/conversations', (req, res) => {
  const clauses = ['owner_type=?', 'owner_id=?', 'hidden_at IS NULL'], params = [req.identity.type, req.identity.id];
  if (req.identity.type === 'guest') { clauses.push('last_active_at>=?'); params.push(now() - days('guestBrowserDays', 7) * DAY); }
  if (req.query.agentId) { clauses.push('agent_id=?'); params.push(String(req.query.agentId)); }
  if (req.query.q) { clauses.push('(title LIKE ? OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id AND m.content LIKE ?) OR EXISTS(SELECT 1 FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE m.conversation_id=conversations.id AND v.content LIKE ?))'); const query = `%${String(req.query.q).slice(0, 200)}%`; params.push(query, query, query); }
  res.json(all(`SELECT * FROM conversations WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, ...params).map(row => conversationView(row)));
});
chatRouter.post('/conversations', (req, res) => {
  const agent = agentFor(req, text(req.body.agentId, 150, '智能体标识'));
  const stamp = now(), conversationId = id('c_');
  run('INSERT INTO conversations(id,owner_type,owner_id,agent_id,title,upstream_user,created_at,updated_at,last_active_at) VALUES(?,?,?,?,?,?,?,?,?)', conversationId, req.identity.type, req.identity.id, agent.id, req.body.title ? text(req.body.title, 120, '会话名称') : '新对话', id('school_'), stamp, stamp, stamp);
  res.status(201).json(conversationView(get('SELECT * FROM conversations WHERE id=?', conversationId), true));
});
chatRouter.get('/conversations/:id', (req, res) => res.json(conversationView(ownedConversation(req, req.params.id), true)));
chatRouter.patch('/conversations/:id', (req, res) => { const row = ownedConversation(req, req.params.id); run('UPDATE conversations SET title=?,updated_at=? WHERE id=?', text(req.body.title, 120, '会话名称'), now(), row.id); res.json(conversationView(get('SELECT * FROM conversations WHERE id=?', row.id))); });
chatRouter.delete('/conversations/:id', async (req, res) => {
  const row = ownedConversation(req, req.params.id);
  const ctx = [...activeRuns.values()].find(value => value.conversationId === row.id);
  if (ctx) await stopContext(ctx, 'CONVERSATION_HIDDEN');
  transaction(() => { run('UPDATE conversations SET hidden_at=?,updated_at=? WHERE id=?', now(), now(), row.id); run('UPDATE shares SET revoked_at=?,snapshot=? WHERE conversation_id=?', now(), '{}', row.id); });
  res.json({ hidden: true, message: '已从本人历史隐藏，关联分享已撤销；管理员仍可按权限查看。' });
});
chatRouter.post('/conversations/:id/messages', async (req, res) => {
  const row = ownedConversation(req, req.params.id); conflict(row.id); agentFor(req, row.agent_id);
  const content = text(req.body.content, 30000, '问题'), message = { id: id('m_'), conversation_id: row.id, parent_version_id: row.active_version_id, content, created_at: now() };
  run('INSERT INTO messages(id,conversation_id,parent_version_id,content,created_at) VALUES(?,?,?,?,?)', message.id, row.id, message.parent_version_id, content, message.created_at);
  if (row.title === '新对话') run('UPDATE conversations SET title=? WHERE id=?', content.slice(0, 40), row.id);
  await invoke(req, res, row, message, 'message');
});
chatRouter.post('/conversations/:id/messages/:messageId/regenerate', async (req, res) => {
  const row = ownedConversation(req, req.params.id); conflict(row.id);
  const item = activeConversationMessages(row).find(({ message }) => message.id === req.params.messageId);
  if (!item) throw new HttpError(404, '当前活动分支中没有此消息', 'MESSAGE_NOT_FOUND');
  const kind = ['failed', 'unknown'].includes(item.version.status) ? 'retry' : 'regenerate';
  await invoke(req, res, row, item.message, kind);
});
chatRouter.post('/conversations/:id/messages/:messageId/activate', (req, res) => {
  const row = ownedConversation(req, req.params.id); conflict(row.id);
  const version = get('SELECT v.* FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE v.id=? AND m.id=? AND m.conversation_id=?', String(req.body.versionId), req.params.messageId, row.id);
  if (!version || !terminal.has(version.status)) throw new HttpError(400, '回答版本不存在或尚未结束', 'INVALID_VERSION');
  run('UPDATE conversations SET active_version_id=?,updated_at=? WHERE id=?', version.id, now(), row.id);
  res.json({ ...conversationView(get('SELECT * FROM conversations WHERE id=?', row.id), true), message: '已切换活动版本。后续新问题将从该版本继续；原分支内容保留在服务器。' });
});
chatRouter.post('/answers/:versionId/stop', async (req, res) => {
  const version = get('SELECT v.*,m.conversation_id FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE v.id=?', req.params.versionId);
  if (!version) throw new HttpError(404, '回答不存在', 'ANSWER_NOT_FOUND');
  ownedConversation(req, version.conversation_id);
  const ctx = activeRuns.get(version.id);
  const result = ctx ? await stopContext(ctx) : { state: version.cancellation_state || 'already_finished', message: '回答已经结束。' };
  res.json({ status: ctx ? 'stopped' : version.status, cancellationState: result.state, message: result.message });
});
chatRouter.post('/answers/:versionId/feedback', (req, res) => {
  const version = get('SELECT v.*,m.conversation_id FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE v.id=?', req.params.versionId);
  if (!version) throw new HttpError(404, '回答不存在', 'ANSWER_NOT_FOUND');
  ownedConversation(req, version.conversation_id);
  if (![1, -1, 0].includes(req.body.rating) || typeof (req.body.text ?? '') !== 'string' || (req.body.text || '').length > 4000) throw new HttpError(400, '反馈内容无效', 'INVALID_FEEDBACK');
  const feedbackId = id('f_'), stamp = now();
  run("INSERT INTO feedback(id,version_id,actor_type,actor_id,rating,text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(version_id,actor_type,actor_id) DO UPDATE SET rating=excluded.rating,text=excluded.text,status='open',updated_at=excluded.updated_at", feedbackId, version.id, req.identity.type, req.identity.id, req.body.rating, req.body.text || '', stamp, stamp);
  res.json({ saved: true });
});

chatRouter.post('/guest/migrate', requireUser, (req, res) => {
  if (typeof req.body.consent !== 'boolean') throw new HttpError(400, '必须明确选择是否转入游客记录', 'CONSENT_REQUIRED');
  if (!req.body.consent) return res.json({ migrated: 0, message: '未转入游客记录，账号历史保持独立。' });
  const rows = all("SELECT * FROM conversations WHERE owner_type='guest' AND owner_id=? AND hidden_at IS NULL AND last_active_at>=?", req.guestId, now() - days('guestBrowserDays', 7) * DAY);
  if (rows.some(row => [...activeRuns.values()].some(ctx => ctx.conversationId === row.id))) throw new HttpError(409, '请先停止游客会话生成后再转入；可以重试。', 'MIGRATION_BUSY');
  const migrated = transaction(() => {
    let count = 0;
    for (const row of rows) {
      // Keep upstream_user and immutable message/version links: migration changes
      // local ownership only, never the upstream execution identity.
      count += Number(run("UPDATE conversations SET owner_type='user',owner_id=?,updated_at=? WHERE id=? AND owner_type='guest' AND owner_id=?", req.user.id, now(), row.id, req.guestId).changes);
      run("UPDATE feedback SET actor_type='user',actor_id=? WHERE actor_type='guest' AND actor_id=? AND version_id IN(SELECT v.id FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE m.conversation_id=?)", req.user.id, req.guestId, row.id);
    }
    return count;
  });
  audit(req, 'guest.migrate', req.user.id, { count: migrated });
  res.json({ migrated, message: `已将 ${migrated} 个游客会话转入账号；重复提交不会重复导入。` });
});

chatRouter.post('/conversations/:id/shares', requireUser, (req, res) => {
  const row = ownedConversation(req, req.params.id);
  conflict(row.id);
  const shareDays = req.body.days == null ? days('shareDays', 7) : Number(req.body.days);
  if (!Number.isFinite(shareDays) || shareDays <= 0 || shareDays > 36500) throw new HttpError(400, '分享有效期须大于 0 且不超过 36500 天', 'INVALID_EXPIRY');
  const shareId = id('share_'), createdAt = now(), expiresAt = createdAt + shareDays * DAY;
  run('INSERT INTO shares(id,conversation_id,owner_id,snapshot,created_at,expires_at,target_message_id) VALUES(?,?,?,?,?,?,?)', shareId, row.id, req.user.id, JSON.stringify(snapshotConversation(row.id, req.body.targetMessageId)), createdAt, expiresAt, req.body.targetMessageId || null);
  const base = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  res.status(201).json({ id: shareId, url: `${base}/share/${shareId}`, createdAt, expiresAt, targetMessageId: req.body.targetMessageId || null });
});
chatRouter.get('/conversations/:id/shares', requireUser, (req, res) => { const row = ownedConversation(req, req.params.id); res.json(all('SELECT id,created_at createdAt,expires_at expiresAt,revoked_at revokedAt FROM shares WHERE conversation_id=? ORDER BY created_at DESC', row.id)); });
chatRouter.delete('/shares/:id', requireUser, (req, res) => {
  const share = get('SELECT * FROM shares WHERE id=? AND owner_id=?', req.params.id, req.user.id);
  if (!share) throw new HttpError(404, '分享不存在', 'SHARE_NOT_FOUND');
  run('UPDATE shares SET revoked_at=?,snapshot=? WHERE id=?', now(), '{}', share.id); res.json({ revoked: true });
});
chatRouter.get('/shares/:id', (req, res) => {
  const share = get('SELECT s.* FROM shares s JOIN conversations c ON s.conversation_id=c.id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.hidden_at IS NULL', req.params.id, now());
  if (!share) throw new HttpError(404, '分享不存在、已撤销或已到期', 'SHARE_NOT_FOUND');
  res.json({ ...parse(share.snapshot), createdAt: share.created_at, expiresAt: share.expires_at });
});

const filterDate = value => {
  const numeric = Number(value), stamp = String(value).trim() && Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  if (!Number.isFinite(stamp)) throw new HttpError(400, '时间筛选无效', 'INVALID_DATE');
  return stamp;
};
function filters(query, alias = 'u') {
  const clauses = [], params = [];
  for (const [key, column] of [['from', 'started_at'], ['to', 'started_at']]) if (query[key]) {
    const value = filterDate(query[key]);
    clauses.push(`${alias}.${column}${key === 'from' ? '>=' : '<='}?`); params.push(value);
  }
  if (query.agentId) { clauses.push(`${alias}.agent_id=?`); params.push(String(query.agentId)); }
  if (query.userType) { if (!['guest', 'user', 'admin'].includes(query.userType)) throw new HttpError(400, '用户类型无效', 'INVALID_USER_TYPE'); clauses.push(`${alias}.actor_type=?`); params.push(query.userType); }
  return { clauses, params, sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '' };
}
function usageView(row) { return { id: row.id, conversationId: row.conversation_id, agentId: row.agent_id, agentName: row.agent_name, integrationId: row.integration_id, platform: row.platform, appId: row.app_id, executionRequested: Boolean(row.execution_requested), dispatchedAt: row.dispatched_at, executionMode: row.execution_mode, actorType: row.actor_type, actorId: row.actor_id, kind: row.kind, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms, firstAnswerMs: row.first_answer_ms, errorCode: row.error_code, traceId: row.trace_id, cancellationState: row.cancellation_state, upstreamTaskId: row.upstream_task_id, upstreamRunId: row.upstream_run_id }; }
chatRouter.get('/admin/usage', requirePermission('logs'), (req, res) => {
  const { sql, params } = filters(req.query);
  res.json(all(`SELECT u.*,a.name agent_name FROM usage_logs u LEFT JOIN agents a ON u.agent_id=a.id ${sql} ORDER BY u.started_at DESC LIMIT 1000`, ...params).map(usageView));
});
chatRouter.get('/admin/statistics', requirePermission('statistics'), (req, res) => {
  const { sql, params } = filters(req.query);
  const counts = `count(*) attempts,coalesce(sum(u.execution_requested=1 AND u.execution_mode='upstream'),0) calls,coalesce(sum(u.execution_requested=1 AND u.execution_mode='demo'),0) demoCalls,coalesce(sum(u.execution_requested=0 AND u.status='failed'),0) configRejected,coalesce(sum(u.status='completed' AND u.execution_requested=1 AND u.execution_mode='upstream'),0) success,coalesce(sum(u.status='failed' AND u.execution_requested=1 AND u.execution_mode='upstream'),0) failed,coalesce(sum(u.status='stopped' AND u.execution_requested=1 AND u.execution_mode='upstream'),0) stopped,coalesce(sum(u.status='unknown' AND u.execution_requested=1 AND u.execution_mode='upstream'),0) unknown,round(avg(CASE WHEN u.execution_requested=1 AND u.execution_mode='upstream' THEN u.duration_ms END)) avgDurationMs`;
  const totals = get(`SELECT count(DISTINCT actor_type||':'||actor_id) people,count(DISTINCT conversation_id) conversations,${counts} FROM usage_logs u ${sql}`, ...params);
  const byAgent = all(`SELECT u.agent_id agentId,coalesce(a.name,'连接测试') agentName,${counts} FROM usage_logs u LEFT JOIN agents a ON u.agent_id=a.id ${sql} GROUP BY u.agent_id`, ...params);
  const byDay = all(`SELECT strftime('%Y-%m-%d',started_at/1000,'unixepoch','+8 hours') day,${counts} FROM usage_logs u ${sql} GROUP BY day ORDER BY day`, ...params);
  const byKind = all(`SELECT kind,${counts} FROM usage_logs u ${sql} GROUP BY kind`, ...params);
  const byUserType = all(`SELECT actor_type userType,count(DISTINCT actor_id) people,${counts} FROM usage_logs u ${sql} GROUP BY actor_type`, ...params);
  res.json({ totals, byAgent, byDay, byKind, byUserType, peopleNote: '游客人数按匿名浏览器标识估算，不能等同自然人数。attempts 是接受的请求尝试；calls 仅统计已发出真实上游 HTTP 请求的执行，demoCalls 独立列出开发演示，configRejected 表示未发出请求的配置失败。连接测试按类型独立统计。无上游用量时不估算 token 或费用。' });
});
chatRouter.get('/admin/conversations', requirePermission('conversations'), (req, res) => {
  const clauses = [], params = [];
  if (req.query.userType) { clauses.push('c.owner_type=?'); params.push(String(req.query.userType)); }
  if (req.query.ownerId) { clauses.push('c.owner_id=?'); params.push(String(req.query.ownerId)); }
  if (req.query.agentId) { clauses.push('c.agent_id=?'); params.push(String(req.query.agentId)); }
  for (const key of ['from', 'to']) if (req.query[key]) { const value = filterDate(req.query[key]); clauses.push(`c.created_at${key === 'from' ? '>=' : '<='}?`); params.push(value); }
  if (req.query.q) {
    const query = `%${String(req.query.q).slice(0, 200)}%`;
    if (hasPermission(req.user, 'content_view')) { clauses.push('(c.title LIKE ? OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.content LIKE ?) OR EXISTS(SELECT 1 FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE m.conversation_id=c.id AND v.content LIKE ?))'); params.push(query, query, query); }
    else throw new HttpError(403, '关键词可能检索正文，需正文查看权限', 'CONTENT_PERMISSION_REQUIRED');
  }
  const items = all(`SELECT c.* FROM conversations c ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY c.updated_at DESC LIMIT 1000`, ...params).map(row => {
    const value = conversationView(row); if (!hasPermission(req.user, 'content_view')) value.title = '会话正文受限'; return value;
  });
  res.json(items);
});
chatRouter.get('/admin/conversations/:id', requirePermission('content_view'), (req, res) => {
  const row = get('SELECT * FROM conversations WHERE id=?', req.params.id);
  if (!row) throw new HttpError(404, '会话不存在', 'CONVERSATION_NOT_FOUND');
  audit(req, 'conversation.view', row.id);
  const value = conversationView(row, true);
  // Authorized administrators can inspect all retained branches, including abandoned answers.
  value.allMessages = all('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,id', row.id).map(message => ({ id: message.id, content: message.content, parentVersionId: message.parent_version_id, versions: all('SELECT * FROM answer_versions WHERE message_id=? ORDER BY created_at,id', message.id).map(versionView) }));
  res.json(value);
});

function purge(conversationIds) {
  return transaction(() => {
    let count = 0;
    for (const conversationId of conversationIds) {
      run('UPDATE usage_logs SET version_id=NULL WHERE conversation_id=?', conversationId);
      count += Number(run('DELETE FROM conversations WHERE id=?', conversationId).changes);
    }
    return count;
  });
}
chatRouter.post('/admin/conversations/purge', requirePermission('cleanup'), async (req, res) => {
  if (req.body.confirm !== true || !Array.isArray(req.body.ids) || req.body.ids.length > 1000 || !req.body.ids.length || req.body.ids.some(value => typeof value !== 'string')) throw new HttpError(400, '永久清理须提供明确确认及 1～1000 条会话标识', 'PURGE_CONFIRM_REQUIRED');
  const ids = [...new Set(req.body.ids)];
  await Promise.all([...activeRuns.values()].filter(ctx => ids.includes(ctx.conversationId)).map(ctx => stopContext(ctx, 'ADMIN_PURGE')));
  const count = purge(ids);
  audit(req, 'conversation.purge', 'conversations', { count, ids });
  res.json({ deleted: count, message: '已永久清理本平台正文、回答版本、分享副本及关联反馈。原平台数据及离线备份不受此操作影响。' });
});
chatRouter.get('/admin/feedback', requirePermission('feedback'), (req, res) => {
  const params = [], condition = req.query.status ? 'WHERE f.status=?' : '';
  if (req.query.status) params.push(String(req.query.status));
  const full = hasPermission(req.user, 'content_view');
  const rows = all(`SELECT f.*,m.conversation_id,a.name agent_name ${full ? ',m.content question,v.content answer' : ''} FROM feedback f JOIN answer_versions v ON f.version_id=v.id JOIN messages m ON v.message_id=m.id JOIN conversations c ON m.conversation_id=c.id LEFT JOIN agents a ON c.agent_id=a.id ${condition} ORDER BY f.updated_at DESC LIMIT 1000`, ...params);
  if (full) audit(req, 'feedback.view_content', 'feedback', { count: rows.length });
  res.json(rows.map(row => ({ id: row.id, versionId: row.version_id, conversationId: row.conversation_id, rating: row.rating, text: full ? row.text : undefined, textRestricted: !full, status: row.status, notes: row.notes, createdAt: row.created_at, actorType: row.actor_type, actorId: row.actor_id, agentName: row.agent_name, ...(full ? { question: row.question, answer: row.answer } : {}) })));
});
chatRouter.patch('/admin/feedback/:id', requirePermission('feedback'), (req, res) => {
  if (!['open', 'processing', 'resolved', 'closed'].includes(req.body.status) || typeof (req.body.notes || '') !== 'string' || (req.body.notes || '').length > 4000) throw new HttpError(400, '反馈处理信息无效', 'INVALID_FEEDBACK_STATUS');
  if (!get('SELECT id FROM feedback WHERE id=?', req.params.id)) throw new HttpError(404, '反馈不存在', 'FEEDBACK_NOT_FOUND');
  run('UPDATE feedback SET status=?,notes=?,updated_at=? WHERE id=?', req.body.status, req.body.notes || '', now(), req.params.id);
  audit(req, 'feedback.update', req.params.id, { status: req.body.status }); res.json({ saved: true });
});

chatRouter.post('/admin/integrations/:id/test', requirePermission('integrations'), requirePermission('credentials'), async (req, res) => {
  const raw = get('SELECT * FROM integrations WHERE id=?', req.params.id);
  if (!raw) throw new HttpError(404, '接入配置不存在', 'INTEGRATION_NOT_FOUND');
  const invocationId = id('test_'), stamp = now(), upstreamUser = id('connection_test_');
  run('INSERT INTO usage_logs(id,integration_id,platform,app_id,actor_type,actor_id,kind,status,started_at,trace_id,upstream_user,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', invocationId, raw.id, raw.platform, raw.app_id, 'admin', req.user.id, 'connection_test', 'running', stamp, id('trace_'), upstreamUser, 'admin');
  let adapter, meta = {}, deltaCount = 0, answerSeen = false;
  try {
    const integration = integrationFor({ integration_id: raw.id }); adapter = createAdapter(integration);
    const result = await adapter.run({ content: text(req.body.prompt || '请简短回复接口测试。', 2000, '测试问题'), history: [], upstreamUser, signal: AbortSignal.timeout(30000), onEvent: event => {
      if (event.type === 'dispatch') { recordDispatch(invocationId, event); return; }
      if (event.type === 'meta') { meta = { ...meta, ...event }; run('UPDATE usage_logs SET upstream_task_id=?,upstream_run_id=?,upstream_conversation_id=?,upstream_message_id=? WHERE id=?', meta.taskId || null, meta.runId || null, meta.conversationId || null, meta.messageId || null, invocationId); }
      if (event.type === 'delta' || event.type === 'replace') { deltaCount++; if (!answerSeen && event.text) { answerSeen = true; run('UPDATE usage_logs SET first_answer_ms=? WHERE id=?', now() - stamp, invocationId); } }
    } });
    const capabilities = { connection: { state: result.mode === 'demo' ? 'development_demo' : result.status === 'completed' ? 'observed' : 'failed', at: now() }, output: { state: result.mode, answerDeltas: result.answerDeltas || 0, at: now() }, multiTurn: { state: 'unverified' }, cancellation: { state: raw.platform==='polymas'?'local_only':'unverified' }, branchRestore: { state: 'unverified', strategy: ['workflow','tool'].includes(integration.config.mode)?(integration.config.historyMode==='question'?'active-history-in-question':integration.config.historyMode==='none'?'single-turn-only':integration.config.historyField?'explicit-history-input':'single-turn-only'):'fresh-conversation-active-history' } };
    run('UPDATE integrations SET capabilities=? WHERE id=?', JSON.stringify(capabilities), raw.id);
    run('UPDATE usage_logs SET status=?,finished_at=?,duration_ms=? WHERE id=?', result.status, now(), now() - stamp, invocationId);
    audit(req, 'integration.test', raw.id, { outcome: result.status });
    res.json({ invocationId, capabilities, message: '单次请求已实测。多轮、分支恢复及取消仍需真实应用专项验证。' });
  } catch (error) {
    const safe = safeError(error);
    if (adapter) await adapter.stop({ taskId: meta.taskId, runId: meta.runId, upstreamUser }).catch(() => {});
    run('UPDATE usage_logs SET status=?,finished_at=?,duration_ms=?,error_code=? WHERE id=?', error?.name === 'TimeoutError' ? 'unknown' : 'failed', now(), now() - stamp, safe.code, invocationId);
    const capabilities = { ...parse(raw.capabilities), connection: { state: 'failed', code: safe.code, at: now() }, multiTurn: { state: 'unverified' }, cancellation: { state: 'unverified' } };
    run('UPDATE integrations SET capabilities=? WHERE id=?', JSON.stringify(capabilities), raw.id);
    audit(req, 'integration.test', raw.id, { outcome: 'failed' });
    res.status(error.status || 502).json({ error: safe.message, code: safe.code, invocationId, capabilities });
  }
});

export async function runRetention() {
  const stamp = now(), cutoff = stamp - days('guestServerDays', 180) * DAY;
  const ids = all("SELECT id FROM conversations WHERE owner_type='guest' AND last_active_at<?", cutoff).map(row => row.id);
  await Promise.all([...activeRuns.values()].filter(ctx => ids.includes(ctx.conversationId)).map(ctx => stopContext(ctx, 'RETENTION')));
  const count = purge(ids);
  transaction(() => {
    run("UPDATE shares SET snapshot='{}',revoked_at=coalesce(revoked_at,?) WHERE expires_at<=?", stamp, stamp);
    run('DELETE FROM usage_logs WHERE started_at<?', stamp - days('usageDays', 180) * DAY);
    run('DELETE FROM audit_logs WHERE created_at<?', stamp - days('auditDays', 180) * DAY);
    run('DELETE FROM sessions WHERE expires_at<?', stamp);
    run('DELETE FROM email_tokens WHERE expires_at<?', stamp);
  });
  return { guestConversationsPurged: count };
}
