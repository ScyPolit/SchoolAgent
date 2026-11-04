export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SchoolAgent', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function arrayOf(value) {
  if (Array.isArray(value)) return value;
  return value?.items || value?.rows || value?.data || [];
}

export function date(value, full = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', full ? {} : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function pretty(value) { return typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2); }

export async function stream(path, body, onEvent, signal) {
  const response = await fetch(`/api${path}`, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SchoolAgent', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error('当前浏览器无法接收流式响应，请升级浏览器后重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (block) => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { throw new Error('收到格式异常的响应，请稍后重试。'); }
    onEvent(parsed);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
    let split;
    while ((split = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, split)); buffer = buffer.slice(split + 2); }
    if (done) { if (buffer.trim()) consume(buffer); break; }
  }
}

export async function download(path) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '导出失败'); }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)/i);
  let filename = match ? decodeURIComponent(match[1]) : `校园对话.${path.includes('format=pdf') ? 'pdf' : path.includes('format=png') ? 'png' : 'md'}`;
  if (blob.type.includes('zip')) filename = filename.replace(/\.[^.]+$/, '.zip');
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
