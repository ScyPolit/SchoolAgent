import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { createPolymasAdapter, buildPolymasRequest, encryptPolymasPayload } from '../server/adapters/polymas.js';

const integration = config => ({ platform: 'polymas', base_url: 'https://polymas.example.test', app_id: 'published-bot', secret: { gatewayAppId: 'gateway-id', appKey: 'test-only-app-key', paramKey: 'test-only-param-key' }, config: { mode: 'tool', queryField: 'query', answerField: 'answer', ...config } });
const input = onEvent => ({ content: '当前问题', history: [], upstreamUser: 'opaque-conversation-identity', signal: new AbortController().signal, onEvent: onEvent || (() => {}) });
function stream(frames, fragment = false) {
  const bytes = new TextEncoder().encode(frames.map(([event, data]) => `${event ? `event:${event}\r\n` : ''}data:${JSON.stringify(data)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) { if (fragment) for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); else controller.enqueue(bytes); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const token = (value = 'test-only-token', expires = 7200) => Response.json({ code: 200, data: { access_token: value, expires_in: expires } });
const complete = () => stream([['OUT_COMPLETE', { text: JSON.stringify({ answer: '正式主答案' }), context: { sessionNid: 'remote-session', chatNid: 'remote-chat' } }]]);

test('Polymas gateway signs with timestamp, single-flights/cache tokens and never confuses appId with appCode', async () => {
  const calls = [], events = [];
  let expectedKey = 'test-only-app-key';
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/token?')) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('appId'), 'gateway-id');
      assert.match(params.get('timestamp'), /^\d{13}$/);
      assert.equal(params.get('sign'), createHash('md5').update('gateway-id' + expectedKey + params.get('timestamp')).digest('hex'));
      await new Promise(resolve => setTimeout(resolve, 5));
      return token();
    }
    assert.equal(options.headers.Authorization, 'test-only-token');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).appCode, 'published-bot');
    return complete();
  };
  await Promise.all([createPolymasAdapter(integration(), fetcher).run(input(e => events.push(e))), createPolymasAdapter(integration(), fetcher).run(input())]);
  await createPolymasAdapter(integration(), fetcher).run(input());
  assert.equal(calls.filter(c => c.url.includes('/api/token?')).length, 1);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 3);
  assert.equal(events.filter(e => e.type === 'dispatch').length, 1);
  const changed = integration(); changed.secret.appKey = 'rotated-key';
  expectedKey = 'rotated-key';
  await createPolymasAdapter(changed, fetcher).run(input());
  assert.equal(calls.filter(c => c.url.includes('/api/token?')).length, 2);
});

test('Polymas AES ECB ZeroPadding uses lowercase MD5 text and supports explicitly selected digest-byte compatibility', () => {
  for (const encoding of ['md5-hex', 'md5-bytes']) {
    const body = { question: '中文问题', appCode: 'published-bot' };
    const digest = createHash('md5').update('test-only-param-key').digest('hex');
    const key = Buffer.from(digest, encoding === 'md5-bytes' ? 'hex' : 'utf8');
    const cipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null); cipher.setAutoPadding(false);
    const actual = encryptPolymasPayload(body, 'test-only-param-key', encoding);
    const plain = Buffer.concat([cipher.update(Buffer.from(actual.secretParam, 'base64')), cipher.final()]).toString('utf8').replace(/\0+$/, '');
    assert.deepEqual(JSON.parse(plain), body);
    assert.deepEqual(Object.keys(actual), ['secretParam']);
  }
  assert.throws(() => encryptPolymasPayload({}, ''), { code: 'POLYMAS_PARAM_KEY_REQUIRED' });
});

test('assistant starts a fresh remote session with only selected local history; tool requires explicit history input', () => {
  const history = [{ role: 'user', content: '分支A' }, { role: 'assistant', content: '答案A' }];
  const request = buildPolymasRequest({ ...input(), history, integration: integration({ mode: 'assistant', encryption: 'plain' }) });
  assert.equal(request.path, '/bot/t/v1/completions/chat/stream');
  assert.ok(request.body.question.includes(JSON.stringify(history)));
  assert.ok(request.body.question.endsWith('当前问题'));
  assert.equal('sessionNid' in request.body, false); assert.equal('chatNid' in request.body, false);
  assert.throws(() => buildPolymasRequest({ ...input(), history, integration: integration() }), { code: 'POLYMAS_HISTORY_REQUIRED' });
  const mapped = buildPolymasRequest({ ...input(), history, integration: integration({ historyField: 'history', responseMode: 'blocking', inputs: { static: '保留' } }) });
  assert.deepEqual(mapped.body.flowData, { static: '保留', query: '当前问题', history: JSON.stringify(history) });
  assert.equal(mapped.body.stream, false);
  assert.throws(() => buildPolymasRequest({ ...input(), integration: integration({ historyField: 'query' }) }), { code: 'POLYMAS_HISTORY_INVALID' });
  assert.throws(() => buildPolymasRequest({ ...input(), integration: integration({ path: '//other.example.test' }) }), { code: 'POLYMAS_PATH_INVALID' });
});

test('assistant handles UTF-8 fragmented SSE, final authority, semantic terminal, and optional verified text modes', async () => {
  for (const textMode of ['final', 'delta', 'snapshot']) {
    const events = [];
    const fetcher = async url => url.includes('/api/token?') ? token() : stream([
      ['', { messageType: 'TEXT', message: '草稿中文', end: false }],
      ['', { messageType: 'TEXT', end: true, context: { answer: '最终答案', chatNid: 'chat', sessionNid: 'session' } }],
      ['', { messageType: 'TEXT', message: '终态后不能再写入' }],
    ], true);
    const result = await createPolymasAdapter(integration({ mode: 'assistant', textMode }), fetcher).run(input(e => events.push(e)));
    assert.equal(result.status, 'completed'); assert.equal(result.messageId, 'chat'); assert.equal(result.conversationId, 'session');
    const output = events.filter(e => ['delta', 'replace'].includes(e.type));
    assert.equal(output.at(-1).text, '最终答案');
    assert.equal(output.length, textMode === 'final' ? 1 : 2);
    assert.equal(result.mode, textMode === 'final' ? 'complete' : 'incremental');
  }
});

test('tool emits only the configured OUT_COMPLETE answer and never leaks ANSWER/node output', async () => {
  const events = [];
  const fetcher = async url => url.includes('/api/token?') ? token() : stream([
    ['ANSWER', { text: 'private reasoning', event: { eventType: 'LLM' } }],
    ['OUT_COMPLETE', { text: JSON.stringify({ main: { text: '最终公开答案' }, private: 'private output' }), context: { sessionNid: 's' } }],
  ]);
  const result = await createPolymasAdapter(integration({ answerField: 'main.text' }), fetcher).run(input(e => events.push(e)));
  assert.equal(result.mode, 'complete');
  assert.deepEqual(events.filter(e => e.type === 'delta'), [{ type: 'delta', text: '最终公开答案', complete: true }]);
  assert.ok(!JSON.stringify(events).includes('private'));
  const blocking = async url => url.includes('/api/token?') ? token() : Response.json({ code: 200, data: { answer: '阻塞答案' } });
  assert.equal((await createPolymasAdapter(integration({ responseMode: 'blocking' }), blocking).run(input())).status, 'completed');
});

test('Polymas rejects missing completion, malformed final mapping, empty answer, HTTP and business failures with sanitized errors', async () => {
  const cases = [
    [() => stream([['ANSWER', { text: 'unfinished' }]]), 'UPSTREAM_INCOMPLETE'],
    [() => stream([['OUT_COMPLETE', { text: 'not-json' }]]), 'ANSWER_MAPPING'],
    [() => stream([['OUT_COMPLETE', { text: '{"answer":""}' }]]), 'ANSWER_MAPPING'],
    [() => Response.json({ code: 40000, message: 'secret never expose' }), 'POLYMAS_40000'],
    [() => new Response('secret never expose', { status: 403 }), 'UPSTREAM_HTTP_403'],
    [() => stream([['ERROR', { message: 'secret never expose' }]]), 'UPSTREAM_STREAM_ERROR'],
  ];
  for (const [response, code] of cases) {
    const fetcher = async url => url.includes('/api/token?') ? token() : response();
    await assert.rejects(createPolymasAdapter(integration(), fetcher).run(input()), e => e.code === code && !e.message.includes('secret'));
  }
});

test('invalid credentials and mapping fail before business dispatch; invalid tokens refresh and failed POST is never retried', async () => {
  let authCalls = 0, posts = 0;
  const fetcher = async url => {
    if (url.includes('/api/token?')) { authCalls++; return token('test-only-token', 0.001); }
    posts++; return Response.json({ code: 40001, message: 'expired' });
  };
  const adapter = createPolymasAdapter(integration(), fetcher);
  await assert.rejects(adapter.run(input()), { code: 'POLYMAS_40001' });
  assert.equal(posts, 1);
  await assert.rejects(adapter.run(input()), { code: 'POLYMAS_40001' });
  assert.equal(authCalls, 2); assert.equal(posts, 2);
  const rejected = [];
  await assert.rejects(createPolymasAdapter(integration({ queryField: '' }), fetcher).run(input(e => rejected.push(e))), { code: 'POLYMAS_MAPPING_REQUIRED' });
  assert.equal(rejected.length, 0); assert.equal(posts, 2);
  const tokenFailure = async () => Response.json({ code: 40005, message: 'sensitive details' });
  await assert.rejects(createPolymasAdapter(integration(), tokenFailure).run(input(e => rejected.push(e))), { code: 'POLYMAS_40005' });
  assert.equal(rejected.length, 0);
});

test('aborting during token acquisition prevents business dispatch without poisoning other callers; remote stop is local-only', async () => {
  let posts = 0;
  const controller = new AbortController();
  const fetcher = async url => {
    if (url.includes('/api/token?')) { controller.abort(); return token(); }
    posts++; return complete();
  };
  const adapter = createPolymasAdapter(integration(), fetcher);
  await assert.rejects(adapter.run({ ...input(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(posts, 0);
  assert.equal((await adapter.run(input())).status, 'completed'); assert.equal(posts, 1);
  const before = posts;
  assert.equal((await adapter.stop()).state, 'local_only'); assert.equal(posts, before);
});
