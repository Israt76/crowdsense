export function uniqueInWindow(events, from, to) {
  const s = new Set();
  for (const e of events) if (e.t >= from && e.t <= to) s.add(e.voterId);
  return s.size;
}

export class ResolutionTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.active = new Map();
  }
  start(signalKey, label, events, now) {
    const { beforeMs } = this.cfg;
    const beforeViewers = uniqueInWindow(events, now - beforeMs, now);
    const rec = { signalKey, label, heardAt: now, beforeViewers, beforeRate: beforeViewers / (beforeMs / 1000), status: 'watching' };
    this.active.set(signalKey, rec);
    return rec;
  }
  update(signalKey, events, now) {
    const rec = this.active.get(signalKey);
    if (!rec || rec.status !== 'watching') return [];
    const { graceMs, minAfterMs, resolveDrop, timeoutMs } = this.cfg;
    const afterStart = rec.heardAt + graceMs;
    const span = now - afterStart;
    if (span < minAfterMs) return [];
    const afterViewers = uniqueInWindow(events, afterStart, now);
    const afterRate = afterViewers / (span / 1000);
    const drop = rec.beforeRate > 0 ? Math.max(0, 1 - afterRate / rec.beforeRate) : 0;
    rec.afterViewers = afterViewers;
    rec.afterRate = afterRate;
    rec.drop = drop;
    rec.observedMs = span;
    if (drop >= resolveDrop) {
      rec.status = 'resolved';
      rec.dropPct = Math.round(drop * 100);
      return [rec];
    }
    if (now - rec.heardAt >= timeoutMs) {
      rec.status = 'not-resolved';
      rec.dropPct = Math.round(drop * 100);
      return [rec];
    }
    return [];
  }
  get(signalKey) { return this.active.get(signalKey); }
}
