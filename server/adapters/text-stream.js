/** Forward the first real fragment immediately, then coalesce bursts into render-sized batches. */
export function createTextStream(onEvent, intervalMs = 40) {
  let pending = '', pendingType = 'delta', visible = '', timer, lastFlush = 0, emitted = 0, closed = false;
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (closed || !pending) return;
    const text = pending, type = pendingType;
    pending = '';
    visible = type === 'replace' ? text : visible + text;
    lastFlush = Date.now(); emitted++;
    onEvent({ type, text });
  }
  return {
    push(text, mode = 'delta') {
      if (closed || typeof text !== 'string' || !text) return;
      if (mode === 'snapshot') { pending = text; pendingType = 'replace'; }
      else { pending += text; pendingType = 'delta'; }
      if (!emitted || Date.now() - lastFlush >= intervalMs) flush();
      else if (!timer) { timer = setTimeout(flush, intervalMs - (Date.now() - lastFlush)); timer.unref?.(); }
    },
    flush,
    close() { flush(); closed = true; clearTimeout(timer); },
    get text() { return visible; },
    get count() { return emitted; },
  };
}
