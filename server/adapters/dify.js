import { readSSE } from './sse.js';

export class AdapterError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
export const valueAt = (object, path) => String(path || '').split('.').filter(Boolean).reduce((v, key) => v?.[key], object);
const mappedAnswer = (data, config) => {
  const value = valueAt(data?.outputs, config.answerField || 'answer');
  if (typeof value !== 'string') throw new AdapterError('ANSWER_MAPPING', '上游已结束，但主答案字段映射没有返回文本；请管理员核对输出映射。');
  return value;
};

export function buildDifyRequest({ integration, content, history, upstreamUser }) {
  const config = integration.config || {};
  const mode = config.mode;
  if (!['workflow', 'chatflow'].includes(mode)) throw new AdapterError('DIFY_MODE_REQUIRED', '请配置并核实 Dify 应用模式（Workflow 或 Chatflow）。', 409);
  const inputs = { ...(config.inputs || {}) };
  if (mode === 'workflow') {
    if (!config.queryField || !config.answerField) throw new AdapterError('DIFY_MAPPING_REQUIRED', 'Workflow 需要配置问题变量和主答案输出字段。', 409);
    if (history.length && !config.historyField) throw new AdapterError('DIFY_HISTORY_REQUIRED', '此 Workflow 尚未配置历史输入字段，无法可靠追问；请维护者配置历史变量或改用 Chatflow。', 409);
    inputs[config.queryField] = content;
    if (config.historyField) inputs[config.historyField] = JSON.stringify(history);
    return { path: '/workflows/run', body: { inputs, user: upstreamUser, response_mode: config.responseMode === 'blocking' ? 'blocking' : 'streaming' } };
  }
  // Never reuse an upstream conversation after a local branch/version change.
  // A fresh chat receives exactly the locally active prefix as an explicit transcript.
  let query = content;
  if (config.historyField) inputs[config.historyField] = JSON.stringify(history);
  else if (history.length) query = `以下 JSON 为本次会话已选定的历史消息，仅用于理解上下文：\n${JSON.stringify(history)}\n\n当前用户问题：\n${content}`;
  return { path: '/chat-messages', body: { inputs, query, user: upstreamUser, response_mode: config.responseMode === 'blocking' ? 'blocking' : 'streaming', auto_generate_name: false, ...(config.workflowId ? { workflow_id: config.workflowId } : {}) } };
}

function headers(integration) {
  const key = integration.secret?.apiKey || integration.secret?.key || (typeof integration.secret === 'string' ? integration.secret : '');
  if (!key) throw new AdapterError('CREDENTIALS_REQUIRED', '尚未配置服务端 Dify API 密钥。', 409);
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function base(integration) {
  let url;
  try { url = new URL(integration.base_url || integration.baseUrl); } catch { throw new AdapterError('API_URL_REQUIRED', '请配置 Dify API 基础地址（包含 /v1）。', 409); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AdapterError('API_URL_INVALID', 'Dify API 地址格式无效。', 409);
  return url.toString().replace(/\/$/, '');
}
async function checked(response) {
  if (response.ok) return response;
  // Never expose arbitrary upstream bodies (which can contain credentials or prompts).
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  throw new AdapterError(`UPSTREAM_HTTP_${status}`, status === 429 ? '上游请求资源受限，请稍后手动重试。' : status === 401 || status === 403 ? '上游鉴权失败，请联系管理员核对服务端凭据。' : `上游返回 HTTP ${status}，请联系管理员核对接口。`);
}

export function createDifyAdapter(integration, fetcher = fetch) {
  const endpoint = base(integration), auth = headers(integration), config = integration.config || {};
  return {
    async run({ content, history, upstreamUser, signal, onEvent }) {
      const request = buildDifyRequest({ integration, content, history, upstreamUser });
      signal?.throwIfAborted();
      onEvent({ type: 'dispatch', mode: 'upstream' });
      const response = await checked(await fetcher(endpoint + request.path, { method: 'POST', headers: auth, body: JSON.stringify(request.body), signal }));
      let answer = '', terminal = null, meta = {}, answerDeltas = 0, messageEnded = false, workflowFinished = false;
      const emit = event => onEvent(event);
      const track = event => {
        meta = { ...meta, ...(event.task_id && { taskId: event.task_id }), ...(event.conversation_id && { conversationId: event.conversation_id }), ...(event.message_id && { messageId: event.message_id }), ...(event.workflow_run_id && { runId: event.workflow_run_id }) };
        emit({ type: 'meta', ...meta });
      };
      if (request.body.response_mode === 'blocking') {
        const event = await response.json(); track(event);
        const data = event.data || event;
        if (data.status && !['succeeded', 'completed'].includes(data.status)) throw new AdapterError('UPSTREAM_FAILED', '上游工作流未成功完成。');
        answer = config.mode === 'workflow' ? mappedAnswer(data, config) : event.answer;
        if (typeof answer !== 'string') throw new AdapterError('ANSWER_MAPPING', '上游没有返回配置的主答案文本。');
        emit({ type: 'delta', text: answer, complete: true });
        return { status: 'completed', ...meta, answerDeltas: 0, mode: 'complete' };
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new AdapterError('UPSTREAM_CONTENT_TYPE', '上游未返回 SSE；请核对应用模式和接口地址。');
      for await (const frame of readSSE(response.body)) {
        if (frame.data === '[DONE]') continue; // Dify semantic terminal is required.
        let event;
        try { event = JSON.parse(frame.data); } catch { throw new AdapterError('UPSTREAM_INVALID_EVENT', '上游返回了无法解析的流事件。'); }
        track(event);
        if (event.event === 'error') throw new AdapterError('UPSTREAM_STREAM_ERROR', '上游执行失败，请联系管理员核查任务记录。');
        if (['message', 'agent_message'].includes(event.event) && config.mode === 'chatflow' && typeof event.answer === 'string') {
          answer += event.answer; answerDeltas++; emit({ type: 'delta', text: event.answer });
        } else if (event.event === 'message_replace' && config.mode === 'chatflow' && typeof event.answer === 'string') {
          answer = event.answer; emit({ type: 'replace', text: answer });
        } else if (event.event === 'text_chunk' && config.mode === 'workflow') {
          const selector = event.data?.from_variable_selector;
          // A text chunk may be internal node output. Only the explicitly mapped answer node is safe.
          if (config.streamAnswerSelector && JSON.stringify(selector) === JSON.stringify(config.streamAnswerSelector) && typeof event.data?.text === 'string') {
            answer += event.data.text; answerDeltas++; emit({ type: 'delta', text: event.data.text });
          }
        } else if (event.event === 'workflow_finished') {
          const data = event.data || {};
          if (data.id) { meta.runId = data.id; emit({ type: 'meta', ...meta }); }
          if (data.status === 'stopped') { terminal = 'stopped'; break; }
          if (!['succeeded', 'completed'].includes(data.status)) throw new AdapterError('UPSTREAM_WORKFLOW_FAILED', '上游工作流执行失败。');
          if (config.mode === 'workflow') {
            const final = mappedAnswer(data, config);
            if (final !== answer) { emit({ type: answer ? 'replace' : 'delta', text: final, complete: true }); answer = final; }
            terminal = 'completed'; break;
          }
          workflowFinished = true;
          if (messageEnded) { terminal = 'completed'; break; }
          emit({ type: 'progress', message: '工作流已完成，等待答案结束事件。' });
        } else if (event.event === 'message_end' && config.mode === 'chatflow') {
          messageEnded = true;
          if (workflowFinished || config.chatflowTerminalMode === 'message_end') { terminal = 'completed'; break; }
          emit({ type: 'progress', message: '答案已返回，正在等待工作流终态。' });
        } else if (['workflow_started', 'node_started', 'node_finished', 'iteration_started', 'iteration_completed', 'ping'].includes(event.event)) {
          emit({ type: 'progress', message: event.event === 'ping' ? '上游仍在处理。' : '上游正在执行工作流。' });
        }
      }
      if (!terminal) throw new AdapterError('UPSTREAM_INCOMPLETE', '上游连接在结束事件前断开；已保留部分回答，请手动重试。');
      if (terminal === 'completed' && !answer) throw new AdapterError('UPSTREAM_EMPTY_ANSWER', '上游已结束，但没有返回可显示的答案。');
      return { status: terminal, ...meta, answerDeltas, mode: answerDeltas > 1 ? 'incremental' : 'complete' };
    },
    async stop({ taskId, runId, upstreamUser }) {
      if (!taskId) return { state: 'unknown', message: '已在本地停止显示；未取得上游任务标识，上游可能仍在执行。' };
      const suffix = config.mode === 'workflow' ? `/workflows/tasks/${encodeURIComponent(taskId)}/stop` : `/chat-messages/${encodeURIComponent(taskId)}/stop`;
      try {
        await checked(await fetcher(endpoint + suffix, { method: 'POST', headers: auth, body: JSON.stringify({ user: upstreamUser }), signal: AbortSignal.timeout(5000) }));
        if (runId) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const response = await fetcher(`${endpoint}/workflows/run/${encodeURIComponent(runId)}`, { headers: auth, signal: AbortSignal.timeout(3000) });
            if (response.ok) {
              const data = await response.json();
              if (data.status === 'stopped') return { state: 'confirmed', message: '已核验上游任务停止。' };
              if (['succeeded', 'failed'].includes(data.status)) return { state: 'completed_before_confirmation', message: '本地已停止显示；核验时上游已经结束。' };
            } else await response.body?.cancel().catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        return { state: 'unknown', message: '已请求上游取消并在本地停止显示；尚未核验上游终态，上游可能仍在执行。' };
      } catch { return { state: 'failed', message: '已在本地停止显示；上游取消请求失败，上游可能仍在执行。' }; }
    }
  };
}
