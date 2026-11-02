// CrowdSense engine.
//
// CrowdSense estimates emerging collective signals from active chat participants.
// It measures people, not messages: every viewer holds at most one active
// stance per meaning group, and the newest thing they said is what counts.
//
// Pipeline (per tick):
//   messages -> normalize -> meaning group (decide / confused / request / hype)
//            -> stance toward options (support / oppose / question / meta)
//            -> one active stance per viewer, time-decayed
//            -> integrity weights (flooding, synchronized bursts)
//            -> adaptive thresholds (relative to room size)
//            -> persistence (must hold for stableMs)
//            -> state: NOISE | FORMING | VOICE | DIVIDED | PAUSED
//
// Time is always passed in (ts in ms), so the engine is fully deterministic
// and the same code runs live chat, replays, tests, evaluation and the demo.

import { normalize } from './normalize.js';
import { analyzeStance, extractCandidateEvidence, parseHint, DECISION_LEXICON } from './stance.js';
import { SemanticGrouper, GROUPS, topicWords } from './semantics.js';
import { dice } from './embed.js';
import { minVoices, minParticipation } from './thresholds.js';
import { detectFlooders, detectSyncBursts } from './integrity.js';
import { ResolutionTracker } from './resolution.js';

export const DEFAULT_CONFIG = Object.freeze({
  // component switches (used by ablations)
  semantic: true,
  stance: true,
  dedup: true,
  temporal: true,
  adaptive: true,
  integrity: true,

  windowMs: 90_000, // messages older than this are forgotten
  decideTauMs: 60_000, // decay time constant of a viewer's stance
  signalTauMs: 30_000, // decay for confused / request groups
  roomWindowMs: 60_000, // "active chatter" = spoke within this window
  stableMs: 4_000, // a condition must persist this long
  voiceShare: 0.6, // leader share for a Crowd Voice
  holdShare: 0.52, // hysteresis: keep a voice while above this
  dividedSecond: 0.3, // second option share for DIVIDED
  dividedTopTwo: 0.75,
  minParticipation: 0.06, // decision participants / active room
  fixedMinVoices: 10, // used when adaptive=false
  minFloor: 3,
  roomFrac: 0.35,
  sqrtK: 1.6,
  signalFactor: 0.6, // confused/request need signalFactor * minVoices viewers
  signalStableMs: 3_000,
  discoverFactor: 0.3,
  maxOptions: 4,
  mindChangeMs: 120_000,

  // integrity
  floodWindowMs: 15_000,
  floodMaxMsgs: 8,
  syncWindowMs: 1_500,
  syncMinAccounts: 8,
  syncLookbackMs: 30_000,
  syncRateFactor: 4,
  firstBurstMin: 8,
  firstBurstWindowMs: 10_000,
  firstBurstShare: 0.5,
  suspiciousWeight: 0.35,
  pauseShare: 0.4, // flagged share of the leading option's support
  pauseTotalShare: 0.25, // flagged share of all decision support (after down-weighting)

  // hype
  hypeWindowMs: 6_000,
  hypeMin: 4,
  hypeShare: 0.35,
  hypeCooldownMs: 15_000,

  // resolution
  resolution: { beforeMs: 20_000, graceMs: 3_000, minAfterMs: 20_000, resolveDrop: 0.6, timeoutMs: 45_000 },
});

const TRANSIENT_MS = { HEARD: 3_000, RESOLVED: 5_000, MIND_CHANGED: 4_000, HYPE: 3_000, NOT_RESOLVED: 3_000 };

export class CrowdSense {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config, resolution: { ...DEFAULT_CONFIG.resolution, ...(config.resolution || {}) } };
    if (!this.cfg.temporal) {
      this.cfg.stableMs = 0;
      this.cfg.signalStableMs = 0;
    }
    this.grouper = new SemanticGrouper({ enabled: this.cfg.semantic, embedder: config.embedder });
    this.voters = new Map();
    this.seq = 0;
    this.hint = null;
    this.hintText = '';
    this.optionMemory = new Map(); // option -> lastSeen
    this.optionsKey = '';
    this.cond = new Map(); // condition key -> since
    this.decide = { state: 'NOISE', option: null, since: 0, acknowledged: null };
    this.lastVoice = null; // {option, share, at}
    this.signals = new Map(); // key -> {state, since, acknowledged, ...}
    this.groupEvents = new Map(); // group key -> [{voterId, t}]
    this.resolver = new ResolutionTracker(this.cfg.resolution);
    this.transients = []; // {type, at, until, data}
    this.moments = []; // recent crowd moments for the streamer panel
    this.pendingEvents = [];
    this.lastHypeAt = -Infinity;
    this.now = 0;
    this.stats = { messages: 0 };
  }

  // ---------------------------------------------------------------- input

  setContext(hint, ts = this.now) {
    const nextText = hint || '';
    const nextHint = parseHint(hint);

    // Retain only stances compatible with the same choice. Shared words such
    // as "door" or "first" alone must not carry votes into a different choice.
    const options = nextHint?.options.map((o) => o.name) || [];
    const previousOptions = this.hint?.options.map((o) => o.name) || [];
    const sameOptions = options.length === previousOptions.length &&
      options.every((o) => previousOptions.includes(o));
    const sameTopic = !this.hint?.topic || !nextHint?.topic ||
      normalize(this.hint.topic).text === normalize(nextHint.topic).text;
    const compatible = !!nextHint && (!this.hint || (sameOptions && sameTopic));
    const ctx = { options, hint: nextHint, fuzzy: this.cfg.semantic, stance: this.cfg.stance };
    for (const v of this.voters.values()) {
      const pool = v.sticky && !v.recent.includes(v.sticky) ? [v.sticky, ...v.recent] : v.recent;
      v.recent = compatible ? pool.filter((r) => {
        if (this.cfg.temporal && ts - r.t > this.cfg.windowMs) return false;
        const next = analyzeStance(r.norm, ctx);
        if (!next.counted) return false;
        if (this.hint) {
          const previous = analyzeStance(r.norm, { ...ctx, options: previousOptions, hint: this.hint });
          // Reordered ordinal aliases must not silently move a viewer's vote.
          if (previous.preference !== next.preference ||
              [...previous.opposed].sort().join('|') !== [...next.opposed].sort().join('|')) return false;
        }
        r.parsed = null;
        r.parsedKey = null;
        return true;
      }) : [];
      v.sticky = null;
    }
    this.hintText = nextText;
    this.hint = nextHint;
    this.optionMemory.clear();
    for (const k of [...this.cond.keys()]) if (!k.startsWith('sig:')) this.cond.delete(k);
    this.decide = { state: 'NOISE', option: null, since: ts, acknowledged: null };
    this.lastVoice = null;
    this._event({ type: 'CONTEXT', at: ts, hint: this.hintText, options: this.hint?.options.map((o) => o.name) || [] });
  }

  /**
   * @param {{userId:string, text:string, ts:number, firstMsg?:boolean|null}} msg
   */
  ingest(msg) {
    const ts = msg.ts;
    this.now = Math.max(this.now, ts);
    this.stats.messages++;
    const seq = this.seq++;
    const voterId = this.cfg.dedup ? String(msg.userId) : `${msg.userId}#${seq}`;
    let v = this.voters.get(voterId);
    if (!v) {
      v = { id: voterId, firstSeen: ts, lastSeen: ts, firstMsg: msg.firstMsg ?? null, msgTimes: [], recent: [], intents: new Map() };
      this.voters.set(voterId, v);
    }
    v.lastSeen = ts;
    // flood statistics are per real account, even when dedup is ablated
    const acct = this.cfg.dedup ? v : this._account(msg.userId);
    acct.msgTimes.push(ts);
    if (acct.msgTimes.length > 64) acct.msgTimes.shift();
    if (msg.firstMsg != null && v.firstMsg == null) v.firstMsg = msg.firstMsg;

    const norm = normalize(msg.text);
    const item = { t: ts, norm, text: norm.text, raw: String(msg.text).slice(0, 80), parsed: null, parsedKey: null };
    v.recent.push(item);
    if (v.recent.length > 4) v.recent.shift();
    item.candidates = extractCandidateEvidence(norm);

    const g = this.grouper.classify(norm);
    item.group = g.key;
    if (g.key && g.key !== 'chatter') {
      v.intents.set(g.key, { t: ts, norm });
      if (!this.groupEvents.has(g.key)) this.groupEvents.set(g.key, []);
      this.groupEvents.get(g.key).push({ voterId: v.id, t: ts });
    }
    return item;
  }

  _account(userId) {
    if (!this._accounts) this._accounts = new Map();
    let a = this._accounts.get(userId);
    if (!a) {
      a = { id: String(userId), msgTimes: [] };
      this._accounts.set(userId, a);
    }
    return a;
  }

  // ---------------------------------------------------------- streamer actions

  markHeard(key = this.currentFocus(), ts = this.now) {
    if (!key) return null;
    if (key === 'decide') {
      if (this.decide.state !== 'VOICE') return null;
      this.decide.acknowledged = this.decide.option;
      this._transient('HEARD', ts, { signal: 'decide', label: `GO ${this._label(this.decide.option)}` });
      this._moment(ts, 'HEARD', `Followed the crowd: GO ${this._label(this.decide.option)}`);
      return { key };
    }
    const s = this.signals.get(key);
    if (!s || s.state !== 'ACTIVE') return null;
    s.acknowledged = true;
    s.heardAt = ts;
    s.countFrom = ts + this.cfg.resolution.graceMs;
    const rec = this.resolver.start(key, s.label, this.groupEvents.get(key) || [], ts);
    this._transient('HEARD', ts, { signal: key, label: s.label });
    this._moment(ts, 'HEARD', `Answered: ${s.label}`);
    return { key, before: rec.beforeViewers };
  }

  dismiss(key = this.currentFocus(), ts = this.now) {
    if (!key) return null;
    if (key === 'decide') {
      this.decide.acknowledged = this.decide.option || 'divided';
    } else {
      const s = this.signals.get(key);
      if (s) s.acknowledged = true;
    }
    this._moment(ts, 'DISMISSED', key);
    return { key };
  }

  /** The signal the streamer panel's buttons act on. */
  currentFocus() {
    const o = this._overlayCard(this.now, true);
    return o?.signal || null;
  }

  // ---------------------------------------------------------------- tick

  tick(ts) {
    this.now = Math.max(this.now, ts);
    const now = this.now;
    this._gc(now);

    const room = this._room(now);
    const need = minVoices(room, this.cfg);
    const decision = this._decision(now, room, need);
    this._updateDecideState(now, decision, need);
    const signals = this._updateSignals(now, need);
    this._updateHype(now);
    this.transients = this.transients.filter((t) => t.until > now);

    const overlay = this._overlayCard(now, false);
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return {
      ts: now,
      room,
      minVoices: need,
      decide: { state: this.decide.state, option: this.decide.option, label: this.decide.option ? this._label(this.decide.option) : null, acknowledged: this.decide.acknowledged, ...decision.public },
      signals,
      overlay,
      events,
      moments: this.moments.slice(-8).reverse(),
      context: this.hintText,
    };
  }

  // ------------------------------------------------------------- internals

  _gc(now) {
    const W = this.cfg.temporal ? this.cfg.windowMs : Infinity;
    for (const [id, v] of this.voters) {
      v.recent = v.recent.filter((r) => now - r.t <= W);
      for (const [k, it] of v.intents) if (now - it.t > W) v.intents.delete(k);
      if (v.sticky && now - v.sticky.t > W) v.sticky = null;
      if (now - v.lastSeen > Math.max(W, this.cfg.roomWindowMs) && !v.recent.length && !v.sticky) this.voters.delete(id);
    }
    for (const [k, list] of this.groupEvents) {
      const keep = list.filter((e) => now - e.t <= 120_000);
      this.groupEvents.set(k, keep);
    }
  }

  _room(now) {
    let n = 0;
    const W = this.cfg.temporal ? this.cfg.roomWindowMs : Infinity;
    for (const v of this.voters.values()) if (now - v.lastSeen <= W) n++;
    return n;
  }

  _weight(age, tau) {
    return this.cfg.temporal ? Math.exp(-age / tau) : 1;
  }

  _options(now, need) {
    if (this.hint) return this.hint.options.map((o) => o.name);
    // Option discovery: candidate words used in decision patterns by enough
    // unique viewers. Typo variants merge into the most popular spelling.
    const counts = new Map();
    const patternCounts = new Map();
    for (const v of this.voters.values()) {
      const seen = new Set();
      const seenP = new Set();
      for (const r of v.recent) for (const c of r.candidates) {
        seen.add(c.word);
        if (c.pattern) seenP.add(c.word);
      }
      for (const c of seen) counts.set(c, (counts.get(c) || 0) + 1);
      for (const c of seenP) patternCounts.set(c, (patternCounts.get(c) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const merged = [];
    for (const [w, c] of sorted) {
      const host = this.cfg.semantic ? merged.find((m) => w.length >= 4 && m.w.length >= 4 && dice(w, m.w) >= 0.8) : null;
      if (host) { host.c += c; host.p += patternCounts.get(w) || 0; }
      else merged.push({ w, c, p: patternCounts.get(w) || 0 });
    }
    const minC = Math.max(2, Math.ceil(this.cfg.discoverFactor * need));
    for (const m of merged) {
      const decisionLike = DECISION_LEXICON.has(m.w) || m.p >= 2;
      if (m.c >= minC && decisionLike) this.optionMemory.set(m.w, now);
    }
    for (const [w, at] of this.optionMemory) if (now - at > 120_000) this.optionMemory.delete(w);
    return [...this.optionMemory.keys()]
      .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b))
      .slice(0, this.cfg.maxOptions)
      .sort();
  }

  _decision(now, room, need) {
    const cfg = this.cfg;
    const options = this._options(now, need);
    const key = options.join('|') + '#' + this.hintText;
    const ctx = { options, hint: this.hint, fuzzy: cfg.semantic, stance: cfg.stance };

    const counted = []; // one entry per voter with an active stance
    const opposeCount = new Map();
    const W = cfg.temporal ? cfg.windowMs : Infinity;
    for (const v of this.voters.values()) {
      // The viewer's newest counted stance may have scrolled out of their short
      // message buffer (they kept chatting about other things); it still counts
      // until it ages out of the time window.
      const pool = v.sticky && !v.recent.includes(v.sticky) && now - v.sticky.t <= W ? [v.sticky, ...v.recent] : v.recent;
      for (let i = pool.length - 1; i >= 0; i--) {
        const r = pool[i];
        if (r.parsedKey !== key) {
          r.parsed = options.length ? analyzeStance(r.norm, ctx) : { counted: false, preference: null, opposed: [] };
          r.parsedKey = key;
        }
        if (!r.parsed.counted) continue;
        let option = r.parsed.preference;
        let inferred = false;
        if (!option && r.parsed.opposed.length === 1 && options.length === 2) {
          option = options.find((o) => o !== r.parsed.opposed[0]);
          inferred = true;
        }
        v.sticky = r;
        for (const o of r.parsed.opposed) opposeCount.set(o, (opposeCount.get(o) || 0) + 1);
        if (option) counted.push({ voterId: v.id, option, inferred, text: r.text, raw: r.raw, t: r.t, firstMsg: v.firstMsg });
        break; // newest counted message wins: one viewer, one voice
      }
    }

    // integrity
    const flooders = cfg.integrity ? detectFlooders(cfg.dedup ? this.voters : (this._accounts || new Map()), now, cfg) : new Set();
    const flagged = cfg.integrity ? detectSyncBursts(counted, now, cfg) : new Map();
    const suspicious = new Set();
    for (const f of flagged.values()) for (const id of f.voters) suspicious.add(id);

    const support = new Map(options.map((o) => [o, 0]));
    const supportN = new Map(options.map((o) => [o, 0]));
    const suspW = new Map(options.map((o) => [o, 0]));
    const phrases = new Map(options.map((o) => [o, new Map()]));
    const newest = new Map(options.map((o) => [o, []]));
    for (const c of counted) {
      let w = this._weight(now - c.t, cfg.decideTauMs);
      if (suspicious.has(c.voterId)) {
        w *= cfg.suspiciousWeight;
        suspW.set(c.option, suspW.get(c.option) + w);
      }
      support.set(c.option, (support.get(c.option) || 0) + w);
      supportN.set(c.option, (supportN.get(c.option) || 0) + 1);
      const p = phrases.get(c.option);
      if (p) p.set(c.text, (p.get(c.text) || 0) + 1);
      newest.get(c.option)?.push(c);
    }
    const total = [...support.values()].reduce((a, b) => a + b, 0);
    const ranked = options.map((o) => ({ option: o, weight: support.get(o), viewers: supportN.get(o), share: total ? support.get(o) / total : 0 }))
      .sort((a, b) => b.weight - a.weight);
    const leader = ranked[0] || null;
    const second = ranked[1] || null;
    const participation = room ? counted.length / room : 0;
    const accountsFlooding = cfg.dedup ? flooders.size : flooders.size;

    let floodMsgs = 0;
    for (const id of flooders) {
      const acct = cfg.dedup ? this.voters.get(id) : this._accounts?.get(id);
      if (acct) floodMsgs += acct.msgTimes.filter((t) => now - t <= cfg.floodWindowMs).length;
    }

    const reasons = [];
    if (accountsFlooding) reasons.push(`${accountsFlooding} account${accountsFlooding > 1 ? 's' : ''} flooding (${floodMsgs} messages) — each counted once`);
    for (const [o, f] of flagged) reasons.push(`${f.voters.size} ${this._label(o)} voices from ${f.reason} — weight reduced`);

    const suspShare = leader && leader.weight > 0 ? suspW.get(leader.option) / leader.weight : 0;
    const suspTotal = total ? [...suspW.values()].reduce((a, b) => a + b, 0) / total : 0;

    return {
      options, ranked, leader, second, total, participation, suspShare, suspTotal, reasons,
      phrases, newest, opposeCount, need, room, countedViewers: counted.length,
      public: {
        options: ranked.map((r) => ({ name: r.option, label: this._label(r.option), share: round(r.share), viewers: r.viewers })),
        participants: counted.length,
        confidenceReduced: reasons.length > 0,
        reasons,
      },
    };
  }

  _label(option) {
    if (!option) return '';
    const h = this.hint?.options.find((o) => o.name === option);
    return (h?.label || option).toUpperCase();
  }

  _since(key, holds, now) {
    if (!holds) {
      this.cond.delete(key);
      return -1;
    }
    if (!this.cond.has(key)) this.cond.set(key, now);
    return now - this.cond.get(key);
  }

  _updateDecideState(now, d, need) {
    const cfg = this.cfg;
    const L = d.leader;
    const S = d.second;
    const minPart = minParticipation(cfg);
    const enoughRoom = d.participation >= minPart;
    const voiceCond = !!L && L.weight >= need && L.share >= cfg.voiceShare && enoughRoom;
    const dividedCond = !!L && !!S && d.total >= need * 1.2 && L.share < cfg.voiceShare &&
      S.share >= cfg.dividedSecond && L.share + S.share >= cfg.dividedTopTwo && enoughRoom;
    const formingCond = !!L && L.weight >= need * 0.5 && L.share >= 0.5;

    const voiceFor = this._since('voice:' + (L?.option || ''), voiceCond, now);
    const divFor = this._since('divided', dividedCond, now);
    for (const k of [...this.cond.keys()]) if (k.startsWith('voice:') && k !== 'voice:' + (L?.option || '')) this.cond.delete(k);

    const prev = this.decide.state;
    const prevOption = this.decide.option;
    let state = 'NOISE';
    let option = null;

    // hysteresis: an existing voice survives small dips
    const holdVoice = prev === 'VOICE' && L && L.option === prevOption && L.share >= cfg.holdShare && L.weight >= need * 0.7 && cfg.temporal;
    if ((voiceCond && voiceFor >= cfg.stableMs) || holdVoice) {
      state = 'VOICE';
      option = L.option;
    } else if (dividedCond && divFor >= cfg.stableMs) {
      state = 'DIVIDED';
    } else if (prev === 'DIVIDED' && cfg.temporal && L && S && L.share < cfg.voiceShare + 0.03 && S.share >= cfg.dividedSecond - 0.05) {
      state = 'DIVIDED';
    } else if (voiceCond || dividedCond || formingCond) {
      state = 'FORMING';
      option = L?.option || null;
    }

    // integrity: a voice dominated by suspicious activity is paused, not announced
    if (cfg.integrity && (state === 'VOICE' || state === 'FORMING' || state === 'DIVIDED') && L && (d.suspShare >= cfg.pauseShare || d.suspTotal >= cfg.pauseTotalShare)) {
      state = 'PAUSED';
      option = L.option;
    }

    const stableSince = state === prev && option === prevOption ? this.decide.since : now;
    this.decide = { ...this.decide, state, option, since: stableSince, detail: d };

    if (state !== prev || option !== prevOption) {
      if (state === 'VOICE') {
        if (this.lastVoice && this.lastVoice.option !== option && now - this.lastVoice.at <= cfg.mindChangeMs) {
          const ev = { from: this._label(this.lastVoice.option), to: this._label(option), fromShare: this.lastVoice.share, toShare: round(L.share) };
          this._transient('MIND_CHANGED', now, ev);
          this._moment(now, 'MIND_CHANGED', `${ev.from} → ${ev.to}`);
        }
        if (this.decide.acknowledged && this.decide.acknowledged !== option) this.decide.acknowledged = null;
        const sample = d.newest.get(option).slice().sort((a, b) => b.t - a.t).slice(0, 14).map((c) => c.raw);
        const noise = [];
        for (const v of this.voters.values()) {
          const r = v.recent[v.recent.length - 1];
          if (r && !r.parsed?.counted && noise.length < 4 && now - r.t < 20_000) noise.push(r.raw);
        }
        this._event({ type: 'VOICE_BORN', at: now, option, label: this._label(option), share: round(L.share), viewers: L.viewers, sample, noise });
        this._moment(now, 'VOICE', `THE CROWD: GO ${this._label(option)} (${Math.round(L.share * 100)}% · ${L.viewers})`);
      } else if (state === 'DIVIDED') {
        if (this.decide.acknowledged === 'divided') this.decide.acknowledged = null;
        this._moment(now, 'DIVIDED', d.ranked.slice(0, 2).map((r) => `${this._label(r.option)} ${Math.round(r.share * 100)}%`).join(' / '));
      } else if (state === 'PAUSED') {
        this._moment(now, 'PAUSED', 'Crowd Voice paused — unusual activity detected');
      }
      this._event({ type: 'DECIDE_STATE', at: now, state, option, label: option ? this._label(option) : null });
    }
    if (state === 'VOICE') {
      const peak = this.lastVoice?.option === option ? Math.max(this.lastVoice.share, round(L.share)) : round(L.share);
      this.lastVoice = { option, share: peak, at: now };
    }
  }

  _updateSignals(now, need) {
    const cfg = this.cfg;
    const out = [];
    for (const key of Object.keys(GROUPS)) {
      if (key === 'chatter' || key === 'hype') continue;
      const kind = GROUPS[key].kind;
      let w = 0;
      let n = 0;
      const norms = [];
      const prevSig = this.signals.get(key);
      const countFrom = prevSig?.countFrom ?? -Infinity;
      for (const v of this.voters.values()) {
        const it = v.intents.get(key);
        if (!it || it.t < countFrom) continue; // after HEARD, only new messages can re-raise the signal
        const wt = this._weight(now - it.t, cfg.signalTauMs);
        if (wt < 0.05) continue;
        w += wt;
        n++;
        norms.push(it.norm);
      }
      const threshold = Math.max(cfg.minFloor, Math.ceil(need * cfg.signalFactor));
      const active = this._since('sig:' + key, w >= threshold, now) >= cfg.signalStableMs;
      let s = this.signals.get(key);
      if (!s) {
        s = { key, kind, state: 'IDLE', since: now, acknowledged: false, label: GROUPS[key].label };
        this.signals.set(key, s);
      }
      if (kind === 'CONFUSED') {
        const topics = topicWords(norms, 2, 0.3);
        s.topics = topics;
        if (!s.acknowledged || s.state !== 'ACTIVE') s.label = topics.length ? cap(topics.join(' · ')) : 'General confusion';
      }
      const was = s.state;
      if (active && s.state !== 'ACTIVE' && !this._watching(key)) {
        s.state = 'ACTIVE';
        s.since = now;
        s.acknowledged = false;
        this._moment(now, kind, kind === 'CONFUSED' ? `CHAT NEEDS HELP: ${s.label} (${n})` : `CHAT WANTS: ${s.label} (${n})`);
        this._event({ type: 'SIGNAL', at: now, key, kind, label: s.label, viewers: n });
      } else if (!active && s.state === 'ACTIVE' && !s.acknowledged && w < threshold * 0.5) {
        s.state = 'IDLE';
      }
      s.viewers = n;
      s.weight = round(w);
      s.threshold = threshold;

      // resolution tracking after HEARD
      for (const rec of this.resolver.update(key, this.groupEvents.get(key) || [], now)) {
        if (rec.status === 'resolved') {
          this._transient('RESOLVED', now, { signal: key, label: rec.label, dropPct: rec.dropPct, before: rec.beforeViewers, after: rec.afterViewers, signalKind: kind });
          this._moment(now, 'RESOLVED', `${rec.label}: ${kind === 'CONFUSED' ? 'confusion' : 'requests'} ↓ ${rec.dropPct}%`);
        } else {
          this._transient('NOT_RESOLVED', now, { signal: key, label: rec.label, dropPct: rec.dropPct, signalKind: kind });
          this._moment(now, 'NOT_RESOLVED', `${rec.label}: still active (↓ ${rec.dropPct}%)`);
        }
        this._event({ type: rec.status === 'resolved' ? 'RESOLVED' : 'NOT_RESOLVED', at: now, key, ...pick(rec) });
        s.state = 'IDLE';
        s.acknowledged = false;
        this.cond.delete('sig:' + key);
      }
      if (was !== s.state && s.state === 'IDLE' && was === 'ACTIVE') this._event({ type: 'SIGNAL_END', at: now, key });
      const rec = this.resolver.get(key);
      out.push({ key, kind, state: s.state, label: s.label, viewers: n, acknowledged: s.acknowledged, threshold, resolution: rec ? pick(rec) : null });
    }
    return out;
  }

  _watching(key) {
    return this.resolver.get(key)?.status === 'watching';
  }

  _updateHype(now) {
    const cfg = this.cfg;
    const W = cfg.hypeWindowMs;
    const hypeNow = new Set();
    const chatNow = new Set();
    const prior = new Set();
    for (const e of this.groupEvents.get('hype') || []) {
      if (now - e.t <= W) hypeNow.add(e.voterId);
      else if (now - e.t <= W * 5) prior.add(e.voterId);
    }
    for (const v of this.voters.values()) if (now - v.lastSeen <= W) chatNow.add(v.id);
    const priorRate = prior.size / 4; // per hype-window
    if (now - this.lastHypeAt >= cfg.hypeCooldownMs && hypeNow.size >= cfg.hypeMin &&
      hypeNow.size >= cfg.hypeShare * chatNow.size && hypeNow.size >= 2 * priorRate + 1) {
      this.lastHypeAt = now;
      this._transient('HYPE', now, { viewers: hypeNow.size });
      this._moment(now, 'HYPE', `CHAT JUST EXPLODED (${hypeNow.size} viewers)`);
      this._event({ type: 'HYPE', at: now, viewers: hypeNow.size });
    }
  }

  _transient(type, at, data) {
    this.transients = this.transients.filter((t) => t.type !== type);
    this.transients.push({ type, at, until: at + TRANSIENT_MS[type], data });
    this._event({ ...data, type: 'TRANSIENT', kind: type, at });
  }

  _moment(at, type, text) {
    this.moments.push({ at, type, text });
    if (this.moments.length > 50) this.moments.shift();
  }

  _event(e) {
    this.pendingEvents.push(e);
  }

  /** Explainability: aggregate reasons only, never individual profiles. */
  explain() {
    const d = this.decide.detail;
    const now = this.now;
    const out = { room: this._room(now), minVoices: minVoices(this._room(now), this.cfg), decide: null, signals: [] };
    if (d && d.leader) {
      const L = d.leader;
      const meanings = [...(d.phrases.get(L.option) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([text, count]) => ({ text, count }));
      out.decide = {
        state: this.decide.state,
        option: this._label(L.option),
        uniqueViewers: L.viewers,
        share: round(L.share),
        participants: d.countedViewers,
        meanings,
        opposing: d.ranked.slice(1).map((r) => ({ option: this._label(r.option), viewers: r.viewers, share: round(r.share) })),
        explicitOpposition: [...d.opposeCount.entries()].map(([o, c]) => ({ option: this._label(o), viewers: c })),
        stableForMs: this.decide.state === 'VOICE' || this.decide.state === 'DIVIDED' ? now - this.decide.since : 0,
        confidenceReduced: d.reasons.length > 0,
        reasons: d.reasons,
        rule: `Needs ≥ ${d.need} agreeing viewers (room of ${d.room}), ≥ ${Math.round(this.cfg.voiceShare * 100)}% agreement, held for ${this.cfg.stableMs / 1000}s`,
      };
    }
    for (const s of this.signals.values()) {
      if (s.state !== 'ACTIVE' && !this._watching(s.key)) continue;
      out.signals.push({ key: s.key, kind: s.kind, label: s.label, uniqueViewers: s.viewers, threshold: s.threshold, topics: s.topics || [], resolution: this.resolver.get(s.key) ? pick(this.resolver.get(s.key)) : null });
    }
    return out;
  }

  /** The single card the viewer overlay shows (or null = overlay empty). */
  _overlayCard(now, forFocus) {
    const order = ['RESOLVED', 'HEARD', 'MIND_CHANGED', 'NOT_RESOLVED', 'HYPE'];
    if (!forFocus) {
      for (const type of order) {
        const t = this.transients.find((x) => x.type === type && x.until > now);
        if (t) return { ...t.data, kind: type, signal: t.data.signal || null };
      }
    }
    const d = this.decide;
    const det = d.detail;
    if (d.state === 'VOICE' && d.acknowledged !== d.option) {
      return { kind: 'VOICE', signal: 'decide', label: `GO ${this._label(d.option)}`, option: this._label(d.option), share: round(det.leader.share), viewers: det.leader.viewers };
    }
    if (d.state === 'DIVIDED' && d.acknowledged !== 'divided') {
      return { kind: 'DIVIDED', signal: 'decide', options: det.ranked.slice(0, 3).map((r) => ({ label: this._label(r.option), share: round(r.share) })) };
    }
    for (const kind of ['CONFUSED', 'REQUEST']) {
      for (const s of this.signals.values()) {
        if (s.kind === kind && s.state === 'ACTIVE' && !s.acknowledged) {
          return { kind, signal: s.key, label: s.label, viewers: s.viewers };
        }
      }
    }
    if (d.state === 'PAUSED') return { kind: 'PAUSED', signal: 'decide', option: this._label(d.option) };
    if (d.state === 'FORMING' && det?.leader && !forFocus) {
      return { kind: 'FORMING', signal: null, option: this._label(det.leader.option), share: round(det.leader.share) };
    }
    return null;
  }
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function pick(rec) {
  const { heardAt, beforeViewers, afterViewers, beforeRate, afterRate, drop, dropPct, status, observedMs } = rec;
  return { heardAt, beforeViewers, afterViewers, beforeRate: round(beforeRate ?? 0), afterRate: round(afterRate ?? 0), drop: drop != null ? round(drop) : null, dropPct, status, observedMs };
}
