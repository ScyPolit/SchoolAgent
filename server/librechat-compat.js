import { Router } from 'express';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { all, get, run, now, parse, setting } from './db.js';
import { HttpError, requireUser } from './security.js';
import { chatRouter, ownedConversation, activeConversationMessages } from './chat.js';
import { exportRouter } from './exporter.js';

/** LibreChat is the UI; the campus tables and authorization remain authoritative. */
export const librechatCompatRouter = Router();
const NO_PARENT = '00000000-0000-0000-0000-000000000000';
const live = new Map(); // Correlation + attached responses only; no extra copies of chat bodies.
let schemaReady = false;
function ensureSchema() {
  if (schemaReady) return;
  const columns = new Set(all('PRAGMA table_info(conversations)').map(row => row.name));
  for (const [name, definition] of [['archived_at', 'INTEGER'], ['pinned', 'INTEGER NOT NULL DEFAULT 0'], ['last_seen_at', 'INTEGER'], ['marked_unread', 'INTEGER NOT NULL DEFAULT 0']]) if (!columns.has(name)) run(`ALTER TABLE conversations ADD COLUMN ${name} ${definition}`);
  schemaReady = true;
}
librechatCompatRouter.use((req, res, next) => { ensureSchema(); next(); });
const iso = value => value == null ? undefined : new Date(value).toISOString();
const state = status => status === 'completed' ? 'complete' : status === 'stopped' ? 'aborted' : status === 'running' ? 'running' : 'error';
const argument = req => req.body?.arg || req.body || {};

export function librechatConversation(row) {
  const agent = get('SELECT name,avatar,published FROM agents WHERE id=?', row.agent_id);
  const last = row.active_version_id && get('SELECT id,created_at,finished_at FROM answer_versions WHERE id=?', row.active_version_id);
  return { conversationId: row.id, endpoint: 'campus', endpointType: 'custom', model: row.agent_id, spec: row.agent_id, modelLabel: agent?.name, iconURL: agent?.avatar || null, title: row.title, user: row.owner_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), isArchived: Boolean(row.archived_at), archivedAt: iso(row.archived_at), pinned: Boolean(row.pinned), isMarkedUnread: Boolean(row.marked_unread), lastSeenAt: iso(row.last_seen_at), lastResponseAt: iso(last?.finished_at || last?.created_at), lastResponseMessageId: last?.id, titleSetByUser: true, titleRevision: row.updated_at, messages: [], metadata: { campusAgentPublished: Boolean(agent?.published), activeVersionId: row.active_version_id } };
}
function userMessage(row, conversation) {
  return { messageId: row.id, conversationId: conversation.id, parentMessageId: row.parent_version_id || NO_PARENT, text: row.content, isCreatedByUser: true, sender: '用户', endpoint: 'campus', model: conversation.agent_id, createdAt: iso(row.created_at), updatedAt: iso(row.created_at) };
}
function answerMessage(row, message, conversation, identity) {
  const agent = get('SELECT name FROM agents WHERE id=?', conversation.agent_id);
  const feedback = identity && get('SELECT rating,text FROM feedback WHERE version_id=? AND actor_type=? AND actor_id=?', row.id, identity.type, identity.id);
  return { messageId: row.id, conversationId: conversation.id, parentMessageId: message.id, text: row.content, content: [{ type: 'text', text: row.content }], isCreatedByUser: false, sender: agent?.name || '校园智能体', endpoint: 'campus', model: conversation.agent_id, createdAt: iso(row.created_at), updatedAt: iso(row.finished_at || row.created_at), error: ['failed', 'unknown'].includes(row.status), unfinished: row.status === 'stopped', finish_reason: row.status === 'completed' ? 'stop' : row.status, current: row.id === conversation.active_version_id, ...(feedback?.rating ? { feedback: { rating: feedback.rating === 1 ? 'thumbsUp' : 'thumbsDown', tag: undefined, text: feedback.text } } : {}), metadata: { campusStatus: row.status, cancellationState: row.cancellation_state, errorMessage: row.error_message, errorCode: row.error_code, invocationId: row.invocation_id } };
}
export function librechatMessages(conversation, identity) {
  const activeBranch = activeConversationMessages(conversation), active = new Set(activeBranch.map(item => item.version.id)), activeUsers = new Set(activeBranch.map(item => item.message.id));
  const rows = all('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid', conversation.id), inputs = new Map(), answers = new Map();
  for (const message of rows) { const key = message.parent_version_id || NO_PARENT; if (!inputs.has(key)) inputs.set(key, []); inputs.get(key).push(message); }
  for (const version of all('SELECT v.* FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE m.conversation_id=? ORDER BY v.created_at,v.rowid', conversation.id)) { if (!answers.has(version.message_id)) answers.set(version.message_id, []); answers.get(version.message_id).push(version); }
  const result = [], seen = new Set();
  function visit(parent) {
    for (const message of (inputs.get(parent) || []).sort((a, b) => Number(activeUsers.has(a.id)) - Number(activeUsers.has(b.id)))) {
      if (seen.has(message.id)) throw new HttpError(500, '会话分支关系异常', 'INVALID_BRANCH');
      seen.add(message.id); result.push({ ...userMessage(message, conversation), current: activeUsers.has(message.id) });
      for (const version of (answers.get(message.id) || []).sort((a, b) => Number(active.has(a.id)) - Number(active.has(b.id)))) { result.push({ ...answerMessage(version, message, conversation, identity), current: active.has(version.id) }); visit(version.id); }
    }
  }
  visit(NO_PARENT);
  if (seen.size !== rows.length) throw new HttpError(500, '会话分支关系不完整', 'INVALID_BRANCH');
  return result;
}
function versionRecord(req, versionId) {
  const version = get('SELECT v.*,m.conversation_id FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE v.id=?', String(versionId));
  if (!version) throw new HttpError(404, '回答版本不存在', 'ANSWER_NOT_FOUND');
  const conversation = ownedConversation(req, version.conversation_id);
  return { version, conversation, message: get('SELECT * FROM messages WHERE id=?', version.message_id) };
}
class CampusResponse extends EventEmitter {
  constructor(onJson, onEvent, onEnd) { super(); this.onJson = onJson; this.onEvent = onEvent; this.onEnd = onEnd; this.statusCode = 200; this.destroyed = false; this.writableEnded = false; this.headersSent = false; }
  status(value) { this.statusCode = value; return this; }
  set() { return this; }
  flushHeaders() { this.headersSent = true; }
  json(value) { this.onJson?.(value, this.statusCode); this.end(); return this; }
  write(chunk) {
    for (const frame of String(chunk).split('\n\n')) if (frame.startsWith('data: ')) this.onEvent?.(JSON.parse(frame.slice(6)));
    return true;
  }
  end() { if (this.writableEnded) return; this.writableEnded = true; this.onEnd?.(); this.emit('finish'); }
}
function coreRequest(req, url, method, body) {
  const internal = Object.create(req);
  Object.assign(internal, { url, method, body, schoolClientRequestId: req.schoolClientRequestId, schoolRequestFingerprint: req.schoolRequestFingerprint });
  return internal;
}
function campus(req, url, method = 'GET', body = {}) {
  return new Promise((resolve, reject) => {
    const response = new CampusResponse((value, statusCode) => { if (statusCode >= 400) reject(new HttpError(statusCode, value.error || '请求失败', value.code)); else resolve(value); });
    chatRouter.handle(coreRequest(req, url, method, body), response, error => reject(error || new HttpError(404, '接口不存在')));
  });
}
const emit = (res, frame) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(frame)}\n\n`); };
function currentFrames(req, versionId) {
  const { version, conversation, message } = versionRecord(req, versionId);
  return { version, conversation, requestMessage: userMessage(message, conversation), responseMessage: answerMessage(version, message, conversation, req.identity) };
}
function streamRecord(req, streamId) {
  // Native LibreChat keys generation controls by conversation; older clients used a version ID.
  const conversation = get('SELECT id FROM conversations WHERE id=?', String(streamId));
  if (!conversation) return versionRecord(req, streamId);
  const owned = ownedConversation(req, conversation.id);
  if (!owned.active_version_id) throw new HttpError(404, '生成任务不存在', 'ANSWER_NOT_FOUND');
  return versionRecord(req, owned.active_version_id);
}
function finalFrame(req, versionId) {
  const value = currentFrames(req, versionId);
  return { final: true, generationProtocolVersion: 1, generationCreatedAt: value.version.created_at, terminalStatus: state(value.version.status), aborted: value.version.status === 'stopped', requestMessage: value.requestMessage, responseMessage: value.responseMessage, conversation: librechatConversation(value.conversation), runMessages: librechatMessages(value.conversation, req.identity), ...(value.version.error_message ? { error: { message: value.version.error_message } } : {}) };
}
function resumeState(req, versionId) {
  const value = currentFrames(req, versionId);
  return { runSteps: [], aggregatedContent: value.responseMessage.content, userMessage: value.requestMessage, responseMessageId: versionId, conversationId: value.conversation.id, sender: value.responseMessage.sender, model: value.conversation.agent_id, collectedUsage: [], pendingSteers: [] };
}
function statusView(req, versionId) {
  const value = currentFrames(req, versionId);
  return { active: value.version.status === 'running', streamId: value.conversation.id, status: state(value.version.status), createdAt: value.version.created_at, elapsedMs: (value.version.finished_at || now()) - value.version.created_at, generationProtocolVersion: 1, aggregatedContent: value.responseMessage.content, resumeState: resumeState(req, versionId), unrecoveredSteers: [] };
}

librechatCompatRouter.get('/convos', (req, res) => {
  const clauses = ['owner_type=?', 'owner_id=?', 'hidden_at IS NULL'], params = [req.identity.type, req.identity.id];
  if (req.identity.type === 'guest') { clauses.push('last_active_at>=?'); params.push(now() - setting('retention').guestBrowserDays * 86400000); }
  clauses.push(req.query.isArchived === 'true' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
  if (req.query.pinned === 'true') clauses.push('pinned=1');
  if (req.query.search) { const term = `%${String(req.query.search).slice(0, 200)}%`; clauses.push('(title LIKE ? OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id AND m.content LIKE ?) OR EXISTS(SELECT 1 FROM answer_versions v JOIN messages m ON v.message_id=m.id WHERE m.conversation_id=conversations.id AND v.content LIKE ?))'); params.push(term, term, term); }
  if (req.query.sharedOnly === 'true') { clauses.push('EXISTS(SELECT 1 FROM shares s WHERE s.conversation_id=conversations.id AND s.revoked_at IS NULL AND s.expires_at>?)'); params.push(now()); }
  if (req.query.hasFiles === 'true' || req.query.projectId) return res.json({ conversations: [], nextCursor: null });
  for (const [query, column] of [['updatedAfter', 'updated_at'], ['createdAfter', 'created_at']]) if (req.query[query]) { const stamp = Date.parse(String(req.query[query])); if (!Number.isFinite(stamp)) throw new HttpError(400, '日期筛选无效'); clauses.push(`${column}>=?`); params.push(stamp); }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 30)), offset = Math.max(0, Number(req.query.cursor) || 0);
  const column = { title: 'title', createdAt: 'created_at', updatedAt: 'updated_at', archivedAt: 'archived_at' }[req.query.sortBy] || 'updated_at', direction = req.query.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT * FROM conversations WHERE ${clauses.join(' AND ')} ORDER BY pinned DESC,${column} ${direction},id ${direction} LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  res.json({ conversations: rows.slice(0, limit).map(librechatConversation), nextCursor: rows.length > limit ? String(offset + limit) : null });
});
librechatCompatRouter.post('/convos/update', async (req, res) => { const body = argument(req); await campus(req, `/conversations/${encodeURIComponent(body.conversationId)}`, 'PATCH', { title: body.title }); res.json(librechatConversation(ownedConversation(req, body.conversationId))); });
librechatCompatRouter.post('/convos/archive', (req, res) => { const body = argument(req), row = ownedConversation(req, body.conversationId); if (typeof body.isArchived !== 'boolean') throw new HttpError(400, '归档设置无效'); run('UPDATE conversations SET archived_at=? WHERE id=?', body.isArchived ? now() : null, row.id); res.json(librechatConversation(ownedConversation(req, row.id))); });
librechatCompatRouter.post('/convos/archive/all', (req, res) => { const result = run('UPDATE conversations SET archived_at=? WHERE owner_type=? AND owner_id=? AND hidden_at IS NULL', now(), req.identity.type, req.identity.id); res.json({ archivedCount: Number(result.changes) }); });
librechatCompatRouter.post('/convos/pin', (req, res) => { const body = argument(req), row = ownedConversation(req, body.conversationId); if (typeof body.pinned !== 'boolean') throw new HttpError(400, '置顶设置无效'); run('UPDATE conversations SET pinned=? WHERE id=?', Number(body.pinned), row.id); res.json(librechatConversation(ownedConversation(req, row.id))); });
librechatCompatRouter.post('/convos/seen', (req, res) => { const row = ownedConversation(req, argument(req).conversationId); run('UPDATE conversations SET last_seen_at=?,marked_unread=0 WHERE id=?', now(), row.id); res.json({ modified: true }); });
librechatCompatRouter.post('/convos/unread', (req, res) => { const row = ownedConversation(req, argument(req).conversationId); run('UPDATE conversations SET marked_unread=1 WHERE id=?', row.id); res.json({ modified: true, lastResponseAt: iso(row.updated_at), lastResponseMessageId: row.active_version_id, isMarkedUnread: true }); });
librechatCompatRouter.delete('/convos', async (req, res) => { const row = ownedConversation(req, argument(req).conversationId); await campus(req, `/conversations/${row.id}`, 'DELETE'); res.json({ acknowledged: true, deletedCount: 1, messages: { acknowledged: true, deletedCount: 0 } }); });
librechatCompatRouter.delete('/convos/all', async (req, res) => {
  const clauses = ['owner_type=?', 'owner_id=?', 'hidden_at IS NULL'], params = [req.identity.type, req.identity.id];
  if (req.identity.type === 'guest') { clauses.push('last_active_at>=?'); params.push(now() - setting('retention').guestBrowserDays * 86400000); }
  // The public history list is paginated. Selecting IDs here ensures the native
  // "delete all" action includes archives and histories beyond its page limit.
  const rows = all(`SELECT id FROM conversations WHERE ${clauses.join(' AND ')}`, ...params);
  for (const row of rows) await campus(req, `/conversations/${row.id}`, 'DELETE');
  res.json({ acknowledged: true, deletedCount: rows.length });
});
librechatCompatRouter.get('/convos/gen_title/:id', (req, res) => { const row = ownedConversation(req, req.params.id); res.json({ title: row.title, titleSetByUser: true, titleRevision: row.updated_at }); });
librechatCompatRouter.get('/convos/:id', (req, res) => res.json(librechatConversation(ownedConversation(req, req.params.id))));
librechatCompatRouter.get('/messages', (req, res) => {
  const clauses = ['c.owner_type=?', 'c.owner_id=?', 'c.hidden_at IS NULL'], params = [req.identity.type, req.identity.id];
  if (req.identity.type === 'guest') { clauses.push('c.last_active_at>=?'); params.push(now() - setting('retention').guestBrowserDays * 86400000); }
  const term = String(req.query.search || '').slice(0, 200), limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)), offset = Math.max(0, Number(req.query.cursor) || 0);
  if (term) { clauses.push('(m.content LIKE ? OR EXISTS(SELECT 1 FROM answer_versions v WHERE v.message_id=m.id AND v.content LIKE ?))'); params.push(`%${term}%`, `%${term}%`); }
  const matches = all(`SELECT m.id,c.id conversation_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  const conversations = new Map(), messages = [];
  for (const match of matches.slice(0, limit)) {
    let graph = conversations.get(match.conversation_id);
    if (!graph) { graph = librechatMessages(ownedConversation(req, match.conversation_id), req.identity); conversations.set(match.conversation_id, graph); }
    for (const message of graph) if ((message.messageId === match.id || message.parentMessageId === match.id) && (!term || message.text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) messages.push({ ...message, searchResult: true, title: get('SELECT title FROM conversations WHERE id=?', match.conversation_id).title });
  }
  res.json({ messages, nextCursor: matches.length > limit ? String(offset + limit) : null });
});
librechatCompatRouter.get('/messages/:conversationId', (req, res) => res.json(librechatMessages(ownedConversation(req, req.params.conversationId), req.identity)));
librechatCompatRouter.get('/messages/:conversationId/:messageId', (req, res) => { const rows = librechatMessages(ownedConversation(req, req.params.conversationId), req.identity).filter(message => message.messageId === req.params.messageId); if (!rows.length) throw new HttpError(404, '消息不存在'); res.json(rows); });
librechatCompatRouter.post('/messages/:conversationId/:messageId/activate', async (req, res) => { const value = versionRecord(req, req.params.messageId); if (value.conversation.id !== req.params.conversationId) throw new HttpError(404, '消息不存在'); await campus(req, `/conversations/${value.conversation.id}/messages/${value.message.id}/activate`, 'POST', { versionId: value.version.id }); res.json({ conversation: librechatConversation(ownedConversation(req, value.conversation.id)), messages: librechatMessages(ownedConversation(req, value.conversation.id), req.identity) }); });
librechatCompatRouter.put('/messages/:conversationId/:messageId/feedback', async (req, res) => {
  const value = versionRecord(req, req.params.messageId); if (value.conversation.id !== req.params.conversationId) throw new HttpError(404, '消息不存在');
  const feedback = req.body.feedback;
  if (feedback != null && !['thumbsUp', 'thumbsDown'].includes(feedback.rating)) throw new HttpError(400, '反馈评价无效');
  await campus(req, `/answers/${value.version.id}/feedback`, 'POST', { rating: feedback == null ? 0 : feedback.rating === 'thumbsUp' ? 1 : -1, text: feedback?.text || '' });
  res.json({ messageId: value.version.id, feedback: feedback || null });
});

librechatCompatRouter.get('/agents/tools/calls', (req, res) => {
  if (typeof req.query.conversationId !== 'string' || !req.query.conversationId || req.query.conversationId.length > 200) throw new HttpError(400, '会话标识无效', 'INVALID_CONVERSATION_ID');
  ownedConversation(req, req.query.conversationId);
  // ToolCallResults is an array in the original client. Native tool execution
  // is disabled; external workflow progress is not a LibreChat tool-call log.
  res.json([]);
});

async function startGeneration(req, res) {
  const body = req.body;
  if (body.isTemporary || body.compact || body.isContinued || body.files?.length) throw new HttpError(400, '当前校园工作流不支持临时聊天、压缩、续写或文件输入', 'CAMPUS_FEATURE_UNAVAILABLE');
  const content = typeof body.text === 'string' ? body.text : '';
  if (!content.trim() || content.length > 30000) throw new HttpError(400, '问题不能为空且不能超过 30000 个字符', 'INVALID_INPUT');
  const clientId = body.clientRequestId || body.messageId;
  if (typeof clientId !== 'string' || !clientId || clientId.length > 200) throw new HttpError(400, '缺少有效的客户端请求标识', 'CLIENT_REQUEST_ID_REQUIRED');
  const fingerprint = createHash('sha256').update(JSON.stringify([content, body.model, body.agent_id, body.agentId, body.parentMessageId, body.overrideParentMessageId, Boolean(body.isRegenerate), body.conversationId])).digest('hex');
  const previous = get('SELECT * FROM usage_logs WHERE actor_type=? AND actor_id=? AND client_request_id=?', req.identity.type, req.identity.id, clientId);
  if (previous) {
    if (parse(previous.scope).requestFingerprint !== fingerprint) throw new HttpError(409, '请求标识已用于不同内容，禁止重复执行', 'CLIENT_REQUEST_CONFLICT');
    const value = versionRecord(req, previous.version_id);
    return res.json({ streamId: value.conversation.id, versionId: value.version.id, conversationId: value.conversation.id, generationCreatedAt: value.version.created_at, generationProtocolVersion: 1, status: 'resumed' });
  }
  let conversation = body.conversationId && get('SELECT * FROM conversations WHERE id=?', body.conversationId);
  if (conversation) conversation = ownedConversation(req, conversation.id);
  else {
    if (body.isRegenerate || (body.parentMessageId && body.parentMessageId !== NO_PARENT)) throw new HttpError(404, '原会话或父回答不存在', 'CONVERSATION_NOT_FOUND');
    const created = await campus(req, '/conversations', 'POST', { agentId: body.agent_id || body.agentId || body.model });
    conversation = ownedConversation(req, created.id);
  }
  const agentId = body.agent_id || body.agentId || body.model;
  if (agentId && agentId !== conversation.agent_id) throw new HttpError(409, '历史会话的智能体不可替换，请新建会话', 'CONVERSATION_AGENT_MISMATCH');
  if (live.size && [...live.values()].some(job => job.conversationId === conversation.id)) throw new HttpError(409, '会话正在生成，请先等待或停止', 'CONVERSATION_BUSY');
  let url = `/conversations/${conversation.id}/messages`, requestBody = { content };
  if (body.isRegenerate) {
    // Native LibreChat allocates fresh optimistic message/response IDs when
    // regenerating. overrideParentMessageId identifies the persisted user turn;
    // validate it within this owned conversation rather than trusting those IDs.
    const message = body.overrideParentMessageId != null
      ? (typeof body.overrideParentMessageId === 'string' && get('SELECT * FROM messages WHERE id=? AND conversation_id=?', body.overrideParentMessageId, conversation.id))
      : get('SELECT * FROM messages WHERE id=? AND conversation_id=?', body.messageId, conversation.id) || get('SELECT m.* FROM messages m JOIN answer_versions v ON v.message_id=m.id WHERE v.id=? AND m.conversation_id=?', body.parentMessageId, conversation.id);
    if (!message || message.content !== content) throw new HttpError(400, '重新生成必须引用本会话已保存的原始问题', 'INVALID_REGENERATION');
    const candidate = get('SELECT id FROM answer_versions WHERE message_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', message.id);
    if (!candidate) throw new HttpError(400, '原始问题没有可重新生成的回答版本', 'INVALID_REGENERATION');
    await campus(req, `/conversations/${conversation.id}/messages/${message.id}/activate`, 'POST', { versionId: candidate.id });
    url = `/conversations/${conversation.id}/messages/${message.id}/regenerate`; requestBody = {};
  } else if (body.parentMessageId && body.parentMessageId !== NO_PARENT) {
    const parent = versionRecord(req, body.parentMessageId);
    if (parent.conversation.id !== conversation.id) throw new HttpError(404, '父回答不属于本会话', 'INVALID_PARENT');
    if (parent.version.id !== conversation.active_version_id) await campus(req, `/conversations/${conversation.id}/messages/${parent.message.id}/activate`, 'POST', { versionId: parent.version.id });
  } else if (conversation.active_version_id) {
    // Native editing of the first user turn creates a new root sibling rather
    // than overwriting the prior prompt/answer branch.
    if (body.parentMessageId !== NO_PARENT) throw new HttpError(409, '继续对话必须携带选定的父回答版本', 'PARENT_VERSION_REQUIRED');
    run('UPDATE conversations SET active_version_id=NULL WHERE id=?', conversation.id);
  }
  req.schoolClientRequestId = clientId; req.schoolRequestFingerprint = fingerprint;
  let job;
  const admitted = new Promise((resolve, reject) => {
    const capture = new CampusResponse((data, code) => reject(new HttpError(code, data.error || '请求被拒绝', data.code)), event => {
      if (event.type === 'start') {
        const version = get('SELECT * FROM answer_versions WHERE id=?', event.versionId);
        job = { versionId: event.versionId, messageId: event.messageId, conversationId: conversation.id, generationCreatedAt: version.created_at, identity: req.identity, listeners: new Set(), req };
        live.set(event.versionId, job); resolve(job);
      }
      if (!job) return;
      try {
        let frame;
        if (event.type === 'delta' || event.type === 'replace') {
          // The admitted job owns these IDs; the core has already persisted this fragment.
          // Avoid rebuilding conversation, feedback and message metadata for every token.
          const value = get('SELECT content FROM answer_versions WHERE id=?', job.versionId);
          if (value) frame = { message: true, text: value.content, messageId: job.versionId, parentMessageId: job.messageId };
        }
        if (event.type === 'progress') {
          job.progress = { phase: ['connecting', 'processing', 'generating'].includes(event.phase) ? event.phase : 'processing', startedAt: job.generationCreatedAt };
          frame = { event: 'on_agent_update', data: { runId: job.versionId, campusProgress: job.progress } };
        }
        if (event.type === 'done') frame = finalFrame(req, job.versionId);
        if (frame) for (const response of job.listeners) emit(response, frame);
        if (event.type === 'done') { for (const response of job.listeners) response.end(); job.listeners.clear(); live.delete(job.versionId); }
      } catch { for (const response of job.listeners) response.end(); job.listeners.clear(); live.delete(job.versionId); }
    });
    chatRouter.handle(coreRequest(req, url, 'POST', requestBody), capture, error => reject(error || new HttpError(404, '调用接口不存在')));
  });
  const started = await admitted;
  res.json({ streamId: started.conversationId, versionId: started.versionId, conversationId: started.conversationId, generationCreatedAt: started.generationCreatedAt, generationProtocolVersion: 1, status: 'started' });
}
librechatCompatRouter.post('/agents/chat/campus', startGeneration);
librechatCompatRouter.post('/agents/chat/custom', startGeneration);
librechatCompatRouter.post('/agents/chat/agents', startGeneration);
librechatCompatRouter.get('/agents/chat/active', (req, res) => res.json({ activeJobIds: [...live.values()].filter(job => job.identity.id === req.identity.id && job.identity.type === req.identity.type).map(job => job.conversationId) }));
librechatCompatRouter.get('/agents/chat/status/:conversationId', (req, res) => { const row = ownedConversation(req, req.params.conversationId); if (!row.active_version_id) return res.json({ active: false, generationProtocolVersion: 1, unrecoveredSteers: [] }); res.json(statusView(req, row.active_version_id)); });
librechatCompatRouter.get('/agents/chat/stream/:streamId', (req, res) => {
  const record = streamRecord(req, req.params.streamId);
  const value = currentFrames(req, record.version.id);
  if (req.query.generationCreatedAt && Number(req.query.generationCreatedAt) !== value.version.created_at) throw new HttpError(409, '生成轮次已变化，请刷新会话', 'GENERATION_REPLACED');
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  emit(res, { created: true, streamId: value.conversation.id, message: value.requestMessage });
  emit(res, { sync: true, conversationId: value.conversation.id, requestMessage: value.requestMessage, responseMessage: value.responseMessage, resumeState: resumeState(req, value.version.id), pendingEvents: [] });
  emit(res, { message: true, text: value.responseMessage.text, messageId: value.version.id, parentMessageId: value.requestMessage.messageId });
  if (value.version.status !== 'running') { emit(res, finalFrame(req, value.version.id)); return res.end(); }
  const job = live.get(value.version.id);
  if (!job) { emit(res, { final: true, reconcile: true, terminalStatus: 'error', conversation: librechatConversation(value.conversation) }); return res.end(); }
  job.listeners.add(res);
  if (job.progress) emit(res, { event: 'on_agent_update', data: { runId: job.versionId, campusProgress: job.progress } });
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
  res.on('close', () => { clearInterval(heartbeat); job.listeners.delete(res); });
});
librechatCompatRouter.post('/agents/chat/abort', async (req, res) => {
  let row;
  if (req.body.streamId) row = streamRecord(req, req.body.streamId);
  else if (req.body.conversationId && req.body.conversationId !== 'new') { const conversation = ownedConversation(req, req.body.conversationId); row = currentFrames(req, conversation.active_version_id); }
  else { const candidate = [...live.values()].find(job => job.identity.id === req.identity.id && job.identity.type === req.identity.type && job.generationCreatedAt === Number(req.body.generationCreatedAt)); if (candidate) row = currentFrames(req, candidate.versionId); }
  if (!row) throw new HttpError(404, '生成任务不存在', 'ANSWER_NOT_FOUND');
  if (!Number.isSafeInteger(req.body.generationCreatedAt) || req.body.generationCreatedAt !== row.version.created_at) throw new HttpError(409, '停止请求不属于当前生成轮次', 'GENERATION_REPLACED');
  const result = await campus(req, `/answers/${row.version.id}/stop`, 'POST');
  res.json({ success: true, aborted: row.conversation.id, streamId: row.version.id, generationCreatedAt: row.version.created_at, generationProtocolVersion: 1, cancellationState: result.cancellationState, message: result.message, pendingSteers: [] });
});

function sharedView(share, conversationId) { return { shareId: share.id, conversationId, targetMessageId: share.targetMessageId || share.target_message_id || null, success: true, snapshotFiles: false, createdAt: iso(share.createdAt || share.created_at), expiresAt: iso(share.expiresAt || share.expires_at), url: share.url }; }
librechatCompatRouter.get('/share', requireUser, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)), offset = Math.max(0, Number(req.query.cursor) || 0), terms = ['s.owner_id=?', 's.revoked_at IS NULL', 's.expires_at>?', 'c.hidden_at IS NULL'], params = [req.user.id, now()];
  if (req.query.search) { terms.push('c.title LIKE ?'); params.push(`%${String(req.query.search).slice(0, 200)}%`); }
  const column = req.query.sortBy === 'title' ? 'c.title' : 's.created_at', order = req.query.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT s.id,s.conversation_id,s.created_at,s.expires_at,c.title FROM shares s JOIN conversations c ON c.id=s.conversation_id WHERE ${terms.join(' AND ')} ORDER BY ${column} ${order},s.id ${order} LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  res.json({ links: rows.slice(0, limit).map(row => ({ shareId: row.id, conversationId: row.conversation_id, title: row.title, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) })), nextCursor: rows.length > limit ? String(offset + limit) : null, hasNextPage: rows.length > limit });
});
librechatCompatRouter.get('/share/link/:conversationId', (req, res) => { const row = ownedConversation(req, req.params.conversationId); const share = req.user && get('SELECT * FROM shares WHERE conversation_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1', row.id, now()); res.json(share ? sharedView(share, row.id) : { shareId: null, conversationId: row.id, success: true, snapshotFiles: false }); });
librechatCompatRouter.post('/share/:conversationId', requireUser, async (req, res) => { const share = await campus(req, `/conversations/${req.params.conversationId}/shares`, 'POST', { days: req.body.days, targetMessageId: req.body.targetMessageId }); res.json({ ...sharedView(share, req.params.conversationId), targetMessageId: req.body.targetMessageId || null }); });
librechatCompatRouter.delete('/share/:id', requireUser, async (req, res) => { await campus(req, `/shares/${req.params.id}`, 'DELETE'); res.json({ acknowledged: true, deletedCount: 1 }); });
librechatCompatRouter.patch('/share/:id', requireUser, async (req, res) => { const share = get('SELECT * FROM shares WHERE id=? AND owner_id=?', req.params.id, req.user.id); if (!share) throw new HttpError(404, '分享不存在'); const created = await campus(req, `/conversations/${share.conversation_id}/shares`, 'POST', { days: req.body.days, targetMessageId: req.body.targetMessageId }); await campus(req, `/shares/${share.id}`, 'DELETE'); res.json({ ...sharedView(created, share.conversation_id), targetMessageId: req.body.targetMessageId || null }); });
librechatCompatRouter.get('/share/:id', async (req, res) => {
  const snapshot = await campus(req, `/shares/${req.params.id}`);
  const publishedAt = iso(snapshot.createdAt);
  res.json({ shareId: req.params.id, title: snapshot.title, conversationId: null, createdAt: publishedAt, updatedAt: publishedAt, expiresAt: iso(snapshot.expiresAt), hasConfiguredSender: true, messages: snapshot.messages.map((message, index) => ({ messageId: `shared-${index}`, conversationId: null, parentMessageId: index ? `shared-${index - 1}` : NO_PARENT, text: message.content, content: [{ type: 'text', text: message.content }], isCreatedByUser: message.role === 'user', sender: message.role === 'user' ? '用户' : '校园智能体', createdAt: publishedAt, updatedAt: publishedAt })) });
});
librechatCompatRouter.get('/convos/:conversationId/export', requireUser, (req, res, next) => {
  const internal = coreRequest(req, `/conversations/${encodeURIComponent(req.params.conversationId)}/export?format=${encodeURIComponent(req.query.format || 'md')}`, 'GET', {});
  exportRouter.handle(internal, res, next);
});
