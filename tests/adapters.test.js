import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../server/adapters/sse.js';
import { buildDifyRequest, createDifyAdapter } from '../server/adapters/dify.js';
import { createAdapter } from '../server/adapters/index.js';

const integration = config => ({ platform: 'dify', base_url: 'http://dify.internal/v1', secret: { apiKey: 'test-secret-never-logged' }, config: { mode: 'chatflow', ...config } });
function stream(events, fragment = false) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) { if (fragment) for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); else controller.enqueue(bytes); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const input = (onEvent = () => {}) => ({ content: '电话是多少？', history: [], upstreamUser: 'stable-user-1', signal: new AbortController().signal, onEvent });

test('SSE handles every-byte UTF-8 fragmentation, CRLF, comments, multiple data lines and final incomplete line', async () => {
  const bytes = new TextEncoder().encode(': ping\r\nevent: answer\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: 尾部');
  async function* body() { for (const byte of bytes) yield new Uint8Array([byte]); }
  const actual = [];
  for await (const event of readSSE(body())) actual.push(event);
  assert.deepEqual(actual, [{ event: 'answer', data: '中文\n第二行' }, { event: '', data: '尾部' }]);
});

test('fresh Chatflow restores only supplied active history and never sends conversation_id', () => {
  const history = [{ role: 'user', content: '只保留分支 A' }, { role: 'assistant', content: '分支 A 回答' }];
  const request = buildDifyRequest({ ...input(), integration: integration(), history });
  assert.equal(request.path, '/chat-messages');
  assert.equal(request.body.user, 'stable-user-1');
  assert.equal('conversation_id' in request.body, false);
  assert.ok(request.body.query.includes(JSON.stringify(history)));
  assert.ok(request.body.query.endsWith('电话是多少？'));
});

test('Workflow maps question/history explicitly and rejects false multi-turn memory', () => {
  const history = [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }];
  const base = { ...input(), integration: integration({ mode: 'workflow', queryField: 'question', answerField: 'result' }), history };
  assert.throws(() => buildDifyRequest(base), { code: 'DIFY_HISTORY_REQUIRED' });
  const request = buildDifyRequest({ ...base, integration: integration({ mode: 'workflow', queryField: 'question', answerField: 'result', historyField: 'history' }) });
  assert.equal(request.path, '/workflows/run');
  assert.equal(request.body.inputs.question, '电话是多少？');
  assert.deepEqual(JSON.parse(request.body.inputs.history), history);
  assert.equal('query' in request.body, false);
});

test('dispatch is emitted only after request validation and immediately before an upstream HTTP attempt', async () => {
  const order = [];
  const adapter = createDifyAdapter(integration(), async () => { order.push('fetch'); return stream([{ event: 'message', answer: '答案' }, { event: 'message_end' }, { event: 'workflow_finished', data: { status: 'succeeded' } }]); });
  await adapter.run(input(event => { if (event.type === 'dispatch') order.push(event.mode); }));
  assert.deepEqual(order, ['upstream', 'fetch']);
  const rejectedEvents = [];
  const unconfigured = createDifyAdapter(integration({ mode: 'workflow' }), async () => { throw new Error('must never fetch'); });
  await assert.rejects(unconfigured.run(input(event => rejectedEvents.push(event))), { code: 'DIFY_MAPPING_REQUIRED' });
  assert.equal(rejectedEvents.some(event => event.type === 'dispatch'), false);
});

test('Chatflow separates progress, deltas, moderation replacement and terminal markers', async () => {
  const emitted = [];
  const adapter = createDifyAdapter(integration(), async () => stream([
    { event: 'workflow_started', task_id: 't', workflow_run_id: 'r', conversation_id: 'c' },
    { event: 'node_started', data: { title: 'private node: never surfaced' } },
    { event: 'message', answer: '中文一', task_id: 't' },
    { event: 'message', answer: '中文二' },
    { event: 'message_replace', answer: '审核后的答案' },
    { event: 'message_end', message_id: 'm' },
    { event: 'workflow_finished', data: { status: 'succeeded' } },
    { event: 'message', answer: '不得接受终态后的内容' }
  ], true));
  const result = await adapter.run(input(event => emitted.push(event)));
  assert.equal(result.status, 'completed');
  assert.equal(result.mode, 'incremental');
  assert.equal(result.taskId, 't');
  assert.equal(result.messageId, 'm');
  assert.deepEqual(emitted.filter(e => e.type === 'delta').map(e => e.text), ['中文一', '中文二']);
  assert.deepEqual(emitted.filter(e => e.type === 'replace').map(e => e.text), ['审核后的答案']);
  assert.ok(emitted.some(e => e.type === 'progress'));
  assert.ok(!JSON.stringify(emitted).includes('private node'));
});

test('truncated SSE and stream error cannot count as success', async () => {
  const incomplete = createDifyAdapter(integration(), async () => stream([{ event: 'message', answer: '部分答案' }]));
  await assert.rejects(incomplete.run(input()), { code: 'UPSTREAM_INCOMPLETE' });
  const failed = createDifyAdapter(integration(), async () => stream([{ event: 'error', message: 'secret should not escape' }]));
  await assert.rejects(failed.run(input()), error => error.code === 'UPSTREAM_STREAM_ERROR' && !error.message.includes('secret'));
});

test('current Chatflow waits for workflow terminal after message_end and rejects a late workflow failure', async () => {
  const failed = createDifyAdapter(integration(), async () => stream([
    { event: 'message', answer: '尚未确认成功的答案' },
    { event: 'message_end' },
    { event: 'workflow_finished', data: { status: 'failed' } }
  ]));
  await assert.rejects(failed.run(input()), { code: 'UPSTREAM_WORKFLOW_FAILED' });
  const truncated = createDifyAdapter(integration(), async () => stream([{ event: 'message', answer: '答案' }, { event: 'message_end' }]));
  await assert.rejects(truncated.run(input()), { code: 'UPSTREAM_INCOMPLETE' });
});

test('Chatflow accepts both semantic terminals in either order and explicit legacy mode only', async () => {
  const reversed = createDifyAdapter(integration(), async () => stream([
    { event: 'message', answer: '答案' },
    { event: 'workflow_finished', data: { status: 'succeeded' } },
    { event: 'message_end' }
  ]));
  assert.equal((await reversed.run(input())).status, 'completed');
  const legacy = createDifyAdapter(integration({ chatflowTerminalMode: 'message_end' }), async () => stream([{ event: 'message', answer: '已核实旧版本协议' }, { event: 'message_end' }]));
  assert.equal((await legacy.run(input())).status, 'completed');
});

test('bare SSE ping is skipped and cannot count as an answer or terminal', async () => {
  const emitted = [];
  const adapter = createDifyAdapter(integration(), async () => new Response('event: ping\n\ndata: {"event":"message","answer":"中文"}\n\nevent: ping\n\ndata: {"event":"message_end"}\n\ndata: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  const result = await adapter.run(input(event => emitted.push(event)));
  assert.equal(result.status, 'completed');
  assert.deepEqual(emitted.filter(event => event.type === 'delta').map(event => event.text), ['中文']);
});

test('Workflow ignores unmapped internal chunks and emits final mapped answer once', async () => {
  const emitted = [];
  const adapter = createDifyAdapter(integration({ mode: 'workflow', queryField: 'question', answerField: 'main.text' }), async () => stream([
    { event: 'text_chunk', data: { text: 'internal secret', from_variable_selector: ['internal', 'text'] } },
    { event: 'node_finished', data: { outputs: { text: 'do not expose' } } },
    { event: 'workflow_finished', workflow_run_id: 'r', data: { status: 'succeeded', outputs: { main: { text: '正式答案' } } } }
  ]));
  const result = await adapter.run(input(event => emitted.push(event)));
  assert.equal(result.mode, 'complete');
  assert.deepEqual(emitted.filter(e => ['delta', 'replace'].includes(e.type)), [{ type: 'delta', text: '正式答案', complete: true }]);
});

test('configured Workflow answer selector permits actual answer deltas', async () => {
  const emitted = [];
  const adapter = createDifyAdapter(integration({ mode: 'workflow', queryField: 'q', answerField: 'answer', streamAnswerSelector: ['answer-node', 'text'] }), async () => stream([
    { event: 'text_chunk', data: { text: '一', from_variable_selector: ['answer-node', 'text'] } },
    { event: 'text_chunk', data: { text: '二', from_variable_selector: ['answer-node', 'text'] } },
    { event: 'workflow_finished', data: { status: 'succeeded', outputs: { answer: '一二' } } }
  ]));
  const result = await adapter.run(input(event => emitted.push(event)));
  assert.equal(result.mode, 'incremental');
  assert.equal(emitted.filter(e => e.type === 'delta').length, 2);
});

test('stop uses correct endpoint and stable identity, accepted command remains unverified', async () => {
  const requests = [];
  const adapter = createDifyAdapter(integration(), async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return Response.json({ result: 'success' }); });
  const outcome = await adapter.stop({ taskId: 'task/1', upstreamUser: 'stable-user-1' });
  assert.equal(requests[0].url, 'http://dify.internal/v1/chat-messages/task%2F1/stop');
  assert.equal(requests[0].body.user, 'stable-user-1');
  assert.equal(outcome.state, 'unknown');
  assert.ok(outcome.message.includes('尚未核验'));
});

test('Workflow stop confirms remote status through independent run read', async () => {
  const requests = [];
  const adapter = createDifyAdapter(integration({ mode: 'workflow' }), async (url, options) => { requests.push({ url, options }); return Response.json(options.method === 'POST' ? { result: 'success' } : { status: 'stopped' }); });
  const outcome = await adapter.stop({ taskId: 't', runId: 'r', upstreamUser: 'stable-user-1' });
  assert.equal(outcome.state, 'confirmed');
  assert.ok(requests[0].url.endsWith('/workflows/tasks/t/stop'));
  assert.ok(requests[1].url.endsWith('/workflows/run/r'));
});

test('upstream HTTP errors never expose credential-bearing bodies', async () => {
  const adapter = createDifyAdapter(integration(), async () => new Response('Authorization: secret-sensitive-key', { status: 401 }));
  await assert.rejects(adapter.run(input()), error => error.code === 'UPSTREAM_HTTP_401' && !error.message.includes('secret-sensitive'));
});

test('Polymas requires gateway credentials and demo is forbidden in production', () => {
  assert.throws(() => createAdapter({ platform: 'polymas' }), { code: 'POLYMAS_CREDENTIALS_REQUIRED' });
  const original = { node: process.env.NODE_ENV, demo: process.env.ENABLE_DEMO_ADAPTER };
  try {
    process.env.NODE_ENV = 'production'; process.env.ENABLE_DEMO_ADAPTER = 'true';
    assert.throws(() => createAdapter({ platform: 'demo' }), { code: 'DEMO_DISABLED' });
  } finally {
    if (original.node == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.demo == null) delete process.env.ENABLE_DEMO_ADAPTER; else process.env.ENABLE_DEMO_ADAPTER = original.demo;
  }
});
