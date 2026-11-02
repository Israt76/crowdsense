import { normalize } from './normalize.js';
import { analyzeStance, parseHint } from './stance.js';
import { CrowdSense } from './engine.js';

const WINDOW = 60_000;
const MIN_VOTES = 10;

export class WindowBaseline {
  constructor(mode, { options = ['left', 'right'], hint = null } = {}) {
    this.mode = mode;
    this.options = options;
    this.hint = parseHint(hint);
    this.votes = [];
  }
  setContext(hint) { this.hint = parseHint(hint); }
  ingest({ userId, text, ts }) {
    const n = normalize(text);
    let option = null;
    if (this.mode === 'raw') {
      const t = n.words.join(' ');
      option = this.options.find((o) => t === o) || null;
      if (option) this.votes.push({ t: ts, userId, option });
      return;
    }
    if (this.mode === 'keyword') {
      for (const o of this.options) if (n.words.includes(o)) this.votes.push({ t: ts, userId, option: o });
      return;
    }
    const r = analyzeStance(n, { options: this.options, hint: this.hint, fuzzy: true, stance: true });
    option = r.preference;
    if (!option && r.opposed.length === 1 && this.options.length === 2) option = this.options.find((o) => o !== r.opposed[0]);
    if (option) this.votes.push({ t: ts, userId, option });
  }
  tick(ts) {
    this.votes = this.votes.filter((v) => ts - v.t <= WINDOW);
    const counts = new Map(this.options.map((o) => [o, 0]));
    if (this.mode === 'semantic-viewers') {
      const latest = new Map();
      for (const v of this.votes) latest.set(v.userId, v.option);
      for (const o of latest.values()) counts.set(o, counts.get(o) + 1);
    } else {
      for (const v of this.votes) counts.set(v.option, counts.get(v.option) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((a, [, c]) => a + c, 0);
    const [lo, lc] = ranked[0];
    const sc = ranked[1]?.[1] ?? 0;
    if (lc >= MIN_VOTES && lc / total >= 0.6) return { kind: 'VOICE', option: lo };
    if (total >= MIN_VOTES * 1.2 && sc / total >= 0.3 && (lc + sc) / total >= 0.75) return { kind: 'DIVIDED', option: null };
    return { kind: 'NONE', option: null };
  }
}

export class EngineSystem {
  constructor(config = {}, hint = null) {
    this.engine = new CrowdSense(config);
    if (hint) this.engine.setContext(hint, 0);
  }
  setContext(hint, ts) { this.engine.setContext(hint, ts); }
  ingest(m) { this.engine.ingest(m); }
  tick(ts) {
    const s = this.engine.tick(ts);
    this.last = s;
    if (s.decide.state === 'VOICE') return { kind: 'VOICE', option: s.decide.option, state: s.decide.state };
    if (s.decide.state === 'DIVIDED') return { kind: 'DIVIDED', option: null, state: s.decide.state };
    return { kind: 'NONE', option: null, state: s.decide.state };
  }
}

export const BASELINES = [
  { id: 'raw-count', name: '1. Raw message count', make: (hint) => new WindowBaseline('raw', { hint }) },
  { id: 'keyword', name: '2. Keyword matching', make: (hint) => new WindowBaseline('keyword', { hint }) },
  { id: 'semantic', name: '3. Semantic meaning (+stance), per message', make: (hint) => new WindowBaseline('semantic', { hint }) },
  { id: 'semantic-viewers', name: '4. Semantic + one viewer, one voice', make: (hint) => new WindowBaseline('semantic-viewers', { hint }) },
  { id: 'crowdsense', name: '5. Full CrowdSense', make: (hint) => new EngineSystem({}, hint) },
];

export const ABLATIONS = [
  { id: 'full', name: 'Full CrowdSense', config: {} },
  { id: 'no-semantic', name: '− semantic grouping', config: { semantic: false } },
  { id: 'no-stance', name: '− stance / negation', config: { stance: false } },
  { id: 'no-dedup', name: '− one viewer, one voice', config: { dedup: false } },
  { id: 'no-temporal', name: '− temporal stability', config: { temporal: false } },
  { id: 'no-adaptive', name: '− adaptive thresholds', config: { adaptive: false } },
  { id: 'no-integrity', name: '− integrity weighting', config: { integrity: false } },
];
