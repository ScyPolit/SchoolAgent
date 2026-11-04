/** Streaming SSE decoder. It handles UTF-8 and event boundaries independently. */
export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '', data = [], eventName = '';
  function consume(line) {
    if (line === '') {
      const event = data.length ? { event: eventName, data: data.join('\n') } : null;
      data = []; eventName = ''; return event;
    }
    if (line[0] === ':') return null;
    const split = line.indexOf(':');
    const field = split < 0 ? line : line.slice(0, split);
    let value = split < 0 ? '' : line.slice(split + 1);
    if (value[0] === ' ') value = value.slice(1);
    if (field === 'data') data.push(value);
    if (field === 'event') eventName = value;
    return null;
  }
  for await (const bytes of body) {
    buffer += typeof bytes === 'string' ? bytes : decoder.decode(bytes, { stream: true });
    let offset;
    while ((offset = buffer.indexOf('\n')) >= 0) {
      const event = consume(buffer.slice(0, offset).replace(/\r$/, ''));
      buffer = buffer.slice(offset + 1);
      if (event) yield event;
    }
    if (buffer.length > 2_000_000 || data.join('').length > 2_000_000) throw new Error('UPSTREAM_EVENT_TOO_LARGE');
  }
  buffer += decoder.decode();
  if (buffer) { const event = consume(buffer.replace(/\r$/, '')); if (event) yield event; }
  const event = consume('');
  if (event) yield event;
}
