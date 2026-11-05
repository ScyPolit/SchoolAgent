import { createCipheriv, createHash } from 'node:crypto';
import { AdapterError } from './dify.js';
import { readSSE } from './sse.js';

// Cache is private to this process and transport. Credentials never appear in cache keys.
const caches = new WeakMap();
const md5 = value => createHash('md5').update(value).digest('hex');
const fail = (code, message, status = 502) => new AdapterError(code, message, status);
const businessErrors = {
  40000: '此 API 尚未向网关应用所属组织授权。',
  40001: 'Polymas 访问令牌已失效，请重新测试连接。',
  40002: 'Polymas 未收到 Authorization 请求头，请核对网关鉴权方式。',
  40004: 'Polymas 拒绝了请求参数，请核对发布应用及加密配置。',
  40005: 'Polymas 网关应用已停用。',
  40006: 'Polymas 应用所属团队已停用。',
  40007: 'Polymas 应用所属学校已停用。',
};

function checkEnvelope(value) {
  if (value?.code != null && Number(value.code) !== 200) {
    const code = Number(value.code);
    throw fail(`POLYMAS_${Number.isFinite(code) ? code : 'ERROR'}`, businessErrors[code] || 'Polymas 返回业务错误，请联系平台管理员核对调用记录。');
  }
  return value;
}
async function checked(response) {
  if (response.ok) return response;
  await response.body?.cancel().catch(() => {});
  throw fail(`UPSTREAM_HTTP_${response.status}`, [401, 403].includes(response.status) ? 'Polymas 鉴权失败，请核对服务端凭据和网关配置。' : response.status === 429 ? 'Polymas 调用频率受限，请稍后手动重试。' : `Polymas 返回 HTTP ${response.status}。`);
}
async function json(response) {
  try { return checkEnvelope(await response.json()); }
  catch (error) {
    if (error instanceof AdapterError) throw error;
    throw fail('POLYMAS_INVALID_JSON', 'Polymas 返回了无法解析的数据。');
  }
}
function endpoint(integration) {
  let url;
  try { url = new URL(integration.base_url || integration.baseUrl || 'https://openapi.polymas.com'); }
  catch { throw fail('API_URL_INVALID', 'Polymas API 基础地址无效。', 409); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('API_URL_INVALID', 'Polymas API 基础地址格式无效。', 409);
  return url.toString().replace(/\/$/, '');
}
function field(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value);
}
function outputAt(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((result, key) => result && Object.hasOwn(result, key) ? result[key] : undefined, value);
}

export function encryptPolymasPayload(body, paramKey, encoding = 'md5-hex') {
  if (!paramKey) throw fail('POLYMAS_PARAM_KEY_REQUIRED', '此接口需要管理员提供的 paramkey；请在服务端凭据中录入。', 409);
  if (!['md5-hex', 'md5-bytes'].includes(encoding)) throw fail('POLYMAS_ENCRYPTION_INVALID', '请选择已核对的 AES 密钥编码。', 409);
  const digest = md5(paramKey);
  // The documented 32-character lowercase MD5 key is used as UTF-8 by default.
  // A digest-byte compatibility choice must be confirmed against the actual gateway.
  const key = Buffer.from(digest, encoding === 'md5-bytes' ? 'hex' : 'utf8');
  const plain = Buffer.from(JSON.stringify(body), 'utf8');
  const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16);
  plain.copy(padded);
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  cipher.setAutoPadding(false);
  return { secretParam: Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64') };
}

export function buildPolymasRequest({ integration, content, history, upstreamUser }) {
  const config = integration.config || {};
  const appCode = integration.app_id || integration.appId;
  if (!['assistant', 'tool'].includes(config.mode)) throw fail('POLYMAS_MODE_REQUIRED', '请选择 Polymas 智能助手或工具工作流 V2。', 409);
  if (!appCode) throw fail('POLYMAS_APP_CODE_REQUIRED', '请配置已发布智能体的 appCode（不是网关 appId）。', 409);
  let body, path;
  if (config.mode === 'assistant') {
    const question = history.length ? `以下 JSON 为本次会话已选定的历史消息，仅用于理解上下文：\n${JSON.stringify(history)}\n\n当前用户问题：\n${content}` : content;
    // Never reuse remote sessionNid/chatNid: local branches are authoritative.
    body = { question, appCode, userNid: upstreamUser, saveHistoryFlag: config.saveHistory !== false };
    path = '/bot/t/v1/completions/chat/stream';
  } else {
    if (!field(config.queryField) || !field(config.answerField)) throw fail('POLYMAS_MAPPING_REQUIRED', '工具工作流需要选择问题变量和主答案输出字段。', 409);
    if (config.historyField && (!field(config.historyField) || config.historyField === config.queryField)) throw fail('POLYMAS_HISTORY_INVALID', '历史变量须与问题变量不同。', 409);
    if (history.length && !config.historyField) throw fail('POLYMAS_HISTORY_REQUIRED', '此工具工作流没有配置历史变量，无法可靠追问；请先配置历史输入。', 409);
    const flowData = { ...(config.inputs || {}), [config.queryField]: content };
    if (config.historyField) flowData[config.historyField] = JSON.stringify(history);
    body = { appCode, userNid: upstreamUser, stream: config.responseMode !== 'blocking', flowData };
    path = '/bot/v2/tool';
  }
  if (config.path) {
    if (typeof config.path !== 'string' || !/^\/(?!\/)[^?#\s\\]+$/.test(config.path)) throw fail('POLYMAS_PATH_INVALID', '网关路由必须为以单个 / 开头的相对接口路径。', 409);
    path = config.path;
  }
  const encryption = config.encryption || (config.mode === 'assistant' ? 'aes-ecb-zero' : 'plain');
  if (!['plain', 'aes-ecb-zero'].includes(encryption)) throw fail('POLYMAS_ENCRYPTION_INVALID', '请选择接口实际配置的参数加密方式。', 409);
  if (encryption === 'aes-ecb-zero') body = encryptPolymasPayload(body, integration.secret?.paramKey, config.keyEncoding);
  return { path, body };
}

export function createPolymasAdapter(integration, fetcher = fetch) {
  const config = integration.config || {}, secret = integration.secret || {}, base = endpoint(integration);
  if (!secret.gatewayAppId || !secret.appKey) throw fail('POLYMAS_CREDENTIALS_REQUIRED', '请录入 Polymas 网关 appId 和 appKey；它们与智能体 appCode 分开配置。', 409);
  if (config.authHeader && !['raw', 'bearer'].includes(config.authHeader)) throw fail('POLYMAS_AUTH_INVALID', '请选择网关 Authorization 格式。', 409);
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  const cacheKey = createHash('sha256').update(JSON.stringify([base, secret.gatewayAppId, secret.appKey])).digest('hex');
  async function token() {
    const entry = cache.get(cacheKey);
    if (entry && (entry.pending || entry.expires > Date.now())) return entry.pending || entry.token;
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    const next = {};
    next.pending = (async () => {
      const timestamp = String(Date.now());
      const params = new URLSearchParams({ appId: secret.gatewayAppId, timestamp, sign: md5(secret.gatewayAppId + secret.appKey + timestamp) });
      // A shared token request has its own timeout. Aborting one chat must not abort others.
      const result = await json(await checked(await fetcher(`${base}/api/token?${params}`, { signal: AbortSignal.timeout(15000), redirect: 'error' })));
      const seconds = Number(result.data?.expires_in), accessToken = result.data?.access_token;
      if (typeof accessToken !== 'string' || !accessToken || /[\r\n]/.test(accessToken) || !Number.isFinite(seconds) || seconds <= 0) throw fail('POLYMAS_TOKEN_INVALID', 'Polymas 没有返回有效的访问令牌和有效期。');
      next.token = accessToken;
      next.expires = Date.now() + Math.max(0, seconds * 1000 - Math.min(60000, seconds * 100));
      delete next.pending;
      return accessToken;
    })().catch(error => { if (cache.get(cacheKey) === next) cache.delete(cacheKey); throw error; });
    cache.set(cacheKey, next);
    return next.pending;
  }
  return {
    async run({ content, history, upstreamUser, signal, onEvent }) {
      const request = buildPolymasRequest({ integration, content, history, upstreamUser });
      signal?.throwIfAborted();
      const accessToken = await token();
      signal?.throwIfAborted();
      onEvent({ type: 'dispatch', mode: 'upstream' });
      let answerDeltas = 0;
      const meta = {};
      const track = context => {
        if (context?.sessionNid) meta.conversationId = String(context.sessionNid);
        if (context?.chatNid) meta.messageId = String(context.chatNid);
        if (Object.keys(meta).length) onEvent({ type: 'meta', ...meta });
      };
      const finalAnswer = value => {
        if (typeof value !== 'string' || !value.trim()) throw fail('ANSWER_MAPPING', 'Polymas 已结束，但主答案没有返回非空文本；请核对答案字段映射。');
        onEvent({ type: answerDeltas ? 'replace' : 'delta', text: value, complete: true });
        return { status: 'completed', ...meta, answerDeltas, mode: answerDeltas ? 'incremental' : 'complete' };
      };
      const toolAnswer = value => {
        const result = outputAt(value, config.answerField);
        return finalAnswer(result);
      };
      try {
        const response = await checked(await fetcher(base + request.path, { method: 'POST', headers: { Authorization: config.authHeader === 'bearer' ? `Bearer ${accessToken}` : accessToken, 'Content-Type': 'application/json', Accept: config.mode === 'tool' && config.responseMode === 'blocking' ? 'application/json' : 'text/event-stream' }, body: JSON.stringify(request.body), signal, redirect: 'error' }));
        if (config.mode === 'tool' && config.responseMode === 'blocking') {
          const result = await json(response);
          return toolAnswer(result.data);
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          // Business errors can arrive as HTTP 200 JSON rather than SSE.
          await json(response);
          throw fail('UPSTREAM_CONTENT_TYPE', 'Polymas 未返回 SSE，请核对接口类型和响应方式。');
        }
        onEvent({ type: 'progress', message: 'Polymas 正在生成回答；以接口最终主答案为准。' });
        for await (const frame of readSSE(response.body)) {
          if (frame.data === '[DONE]') continue;
          let event;
          try { event = JSON.parse(frame.data); }
          catch { throw fail('UPSTREAM_INVALID_EVENT', 'Polymas 返回了无法解析的流事件。'); }
          checkEnvelope(event);
          if (['ERROR', 'error'].includes(frame.event) || event.messageType === 'ERROR' || event.error) throw fail('UPSTREAM_STREAM_ERROR', 'Polymas 执行失败，请联系管理员查看平台调用记录。');
          track(event.context);
          if (config.mode === 'assistant') {
            if (event.end === true) return finalAnswer(event.context?.answer);
            // Opt in only after verifying the published app's message semantics.
            if (event.messageType === 'TEXT' && typeof event.message === 'string' && event.message && ['delta', 'snapshot'].includes(config.textMode)) {
              answerDeltas++;
              onEvent({ type: config.textMode === 'snapshot' ? 'replace' : 'delta', text: event.message });
            }
          } else if (frame.event === 'OUT_COMPLETE') {
            let value = event.text;
            try { value = JSON.parse(value); }
            catch { throw fail('ANSWER_MAPPING', '工具工作流最终 text 不是约定的 JSON 输出，请核对发布版本。'); }
            return toolAnswer(value);
          }
          // ANSWER and node outputs may contain internal reasoning; never render them.
        }
        throw fail('UPSTREAM_INCOMPLETE', 'Polymas 连接已结束，但未收到正式完成事件；本次结果未确认。');
      } catch (error) {
        if (error.code === 'POLYMAS_40001' || error.code === 'UPSTREAM_HTTP_401') cache.delete(cacheKey);
        // Never retry a business POST: it may already have executed upstream.
        throw error;
      }
    },
    async stop() { return { state: 'local_only', message: '已停止本地接收；Polymas 正式文档未提供远程停止接口，上游可能继续执行。' }; },
  };
}
