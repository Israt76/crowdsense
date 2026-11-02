// Seeded, reproducible chat scenarios with ground truth.
// Used by the evaluation, the tests and (scenario fragments) the offline demo.
//
// Every simulated viewer has an id starting with "sim_" — simulated users are
// never presented as real live viewers.

import * as P from './phrases.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  constructor(seed, name) {
    this.r = rng(seed);
    this.name = name;
    this.messages = [];
    this.nextId = 0;
    this.phases = [];
    this.actions = [];
    this.hint = null;
  }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  users(n, prefix = 'v') { return Array.from({ length: n }, () => `sim_${prefix}${this.nextId++}`); }
  say(userId, ts, text, firstMsg = null) { this.messages.push({ userId, ts: Math.round(ts), text, firstMsg }); }

  /** Background chatter: each user talks about unrelated things now and then. */
  chatter(users, from, to, everyMs = 20_000) {
    for (const u of users) {
      let t = from + this.r() * everyMs;
      while (t < to) {
        this.say(u, t, this.pick(P.CHATTER));
        t += everyMs * (0.5 + this.r());
      }
    }
  }

  /** A wave: each user speaks once in [from, from+spread], may repeat a couple of times. */
  wave(users, from, spread, phraseFn, { repeat = 0.35, until = null, firstMsg = null } = {}) {
    for (const u of users) {
      let t = from + this.r() * spread;
      this.say(u, t, phraseFn(), firstMsg);
      const end = until ?? from + spread + 25_000;
      while (this.r() < repeat && t < end) {
        t += 4_000 + this.r() * 12_000;
        if (t < end) this.say(u, t, phraseFn(), firstMsg);
      }
    }
  }

  flood(users, from, to, text, perUser) {
    for (const u of users) {
      for (let k = 0; k < perUser; k++) this.say(u, from + this.r() * (to - from), text);
    }
  }

  done(extra = {}) {
    this.messages.sort((a, b) => a.ts - b.ts);
    const duration = extra.duration ?? (this.messages.at(-1)?.ts ?? 0) + 5_000;
    return { name: this.name, hint: this.hint, messages: this.messages, phases: this.phases, actions: this.actions, duration, ...extra };
  }
}

const leftPhrase = (b, oppShare = 0.3) => () => (b.r() < oppShare ? b.pick(P.OPPOSE_RIGHT) : b.pick(P.SUPPORT_LEFT));
const rightPhrase = (b, oppShare = 0.3) => () => (b.r() < oppShare ? b.pick(P.OPPOSE_LEFT) : b.pick(P.SUPPORT_RIGHT));

export const SCENARIOS = {
  /** Organic majority for LEFT with naturally varied wording. */
  organic_majority(seed) {
    const b = new Builder(seed, 'organic_majority');
    const room = b.int(40, 90);
    const bg = b.users(Math.round(room * 0.4), 'bg');
    const L = b.users(Math.round(room * 0.45), 'L');
    const R = b.users(Math.max(2, Math.round(room * 0.15)), 'R');
    b.chatter([...bg, ...L, ...R], 0, 60_000);
    b.wave(L, 8_000, 20_000, leftPhrase(b));
    b.wave(R, 8_000, 20_000, rightPhrase(b));
    b.phases.push({ from: 0, to: 60_000, truthAt: 20_000, checkAt: 45_000, expect: { kind: 'VOICE', option: 'left' } });
    return b.done({ duration: 60_000, family: 'decision' });
  },

  /** THE proof scene: varied independent LEFT majority vs a few accounts flooding RIGHT. */
  flood_attack(seed) {
    const b = new Builder(seed, 'flood_attack');
    b.hint = seed % 2 === 0 ? 'fork: left door / right door' : null;
    const bg = b.users(b.int(10, 25), 'bg');
    const L = b.users(b.int(30, 50), 'L');
    const R = b.users(b.int(3, 6), 'R');
    const spam = b.users(b.int(2, 4), 'spam');
    b.chatter([...bg, ...L], 0, 60_000);
    const lp = () => {
      const x = b.r();
      if (b.hint && x < 0.15) return b.pick(P.HINT_LEFT);
      return x < 0.45 ? b.pick(P.OPPOSE_RIGHT) : b.pick(P.SUPPORT_LEFT);
    };
    b.wave(L, 5_000, 20_000, lp);
    b.wave(R, 5_000, 20_000, () => b.pick(P.SUPPORT_RIGHT));
    b.flood(spam, 8_000, 55_000, 'RIGHT', b.int(40, 70));
    b.phases.push({ from: 0, to: 60_000, truthAt: 15_000, checkAt: 45_000, expect: { kind: 'VOICE', option: 'left' } });
    return b.done({ duration: 60_000, family: 'spam' });
  },

  /** Majority expressed mostly by rejecting the other option. */
  negation_heavy(seed) {
    const b = new Builder(seed, 'negation_heavy');
    const bg = b.users(b.int(10, 25), 'bg');
    const L = b.users(b.int(25, 45), 'L');
    const R = b.users(b.int(5, 9), 'R');
    b.chatter([...bg, ...L, ...R], 0, 60_000);
    b.wave(L, 5_000, 20_000, leftPhrase(b, 0.8));
    b.wave(R, 5_000, 20_000, rightPhrase(b, 0.1));
    b.phases.push({ from: 0, to: 60_000, truthAt: 15_000, checkAt: 45_000, expect: { kind: 'VOICE', option: 'left' } });
    return b.done({ duration: 60_000, family: 'decision' });
  },

  /** Genuinely split chat. Must NOT manufacture consensus. */
  divided(seed) {
    const b = new Builder(seed, 'divided');
    const n = b.int(20, 40);
    const bg = b.users(b.int(10, 20), 'bg');
    const L = b.users(n, 'L');
    const R = b.users(n + b.int(-3, 3), 'R');
    b.chatter([...bg, ...L, ...R], 0, 60_000);
    b.wave(L, 5_000, 20_000, leftPhrase(b));
    b.wave(R, 5_000, 20_000, rightPhrase(b));
    b.phases.push({ from: 0, to: 60_000, truthAt: 15_000, checkAt: 45_000, expect: { kind: 'DIVIDED' } });
    return b.done({ duration: 60_000, family: 'decision' });
  },

  /** A few viewers burst for 4 seconds in a busy room, then stop. Not a crowd. */
  transient_burst(seed) {
    const b = new Builder(seed, 'transient_burst');
    const bg = b.users(b.int(100, 160), 'bg');
    const burst = b.users(b.int(10, 14), 'B');
    b.chatter(bg, 0, 60_000, 15_000);
    b.wave(burst, 20_000, 4_000, () => b.pick(P.SUPPORT_RIGHT), { repeat: 0.5, until: 24_000 });
    b.phases.push({ from: 0, to: 60_000, checkAt: 50_000, expect: { kind: 'NONE' } });
    return b.done({ duration: 60_000, family: 'stability' });
  },

  /** Tiny room: 5-6 of 8-9 chatters agree. A crowd is relative to the room. */
  small_room(seed) {
    const b = new Builder(seed, 'small_room');
    const L = b.users(b.int(5, 6), 'L');
    const other = b.users(b.int(2, 3), 'bg');
    b.chatter([...L, ...other], 0, 60_000, 25_000);
    b.wave(L, 5_000, 15_000, leftPhrase(b), { repeat: 0.6 });
    b.phases.push({ from: 0, to: 60_000, truthAt: 12_000, checkAt: 40_000, expect: { kind: 'VOICE', option: 'left' } });
    return b.done({ duration: 60_000, family: 'room-size' });
  },

  /** Huge room: a small cluster agrees while the room talks about other things. Not a crowd. */
  big_room_minority(seed) {
    const b = new Builder(seed, 'big_room_minority');
    const bg = b.users(b.int(300, 400), 'bg');
    const L = b.users(b.int(12, 18), 'L');
    b.chatter(bg, 0, 60_000, 25_000);
    b.wave(L, 5_000, 20_000, leftPhrase(b), { repeat: 0.5 });
    b.phases.push({ from: 0, to: 60_000, checkAt: 45_000, expect: { kind: 'NONE' } });
    return b.done({ duration: 60_000, family: 'room-size' });
  },

  /** Chat says LEFT, then genuinely changes its mind to RIGHT. */
  mind_change(seed) {
    const b = new Builder(seed, 'mind_change');
    const bg = b.users(b.int(10, 20), 'bg');
    const A = b.users(b.int(30, 40), 'A');
    b.chatter([...bg, ...A], 0, 100_000);
    b.wave(A, 3_000, 15_000, leftPhrase(b), { until: 40_000 });
    const switchers = A.filter(() => b.r() < 0.8);
    b.wave(switchers, 50_000, 15_000, () => (b.r() < 0.4 ? 'actually ' : '') + b.pick(P.SUPPORT_RIGHT), { repeat: 0.5, until: 95_000 });
    b.phases.push({ from: 0, to: 48_000, truthAt: 12_000, checkAt: 40_000, expect: { kind: 'VOICE', option: 'left' } });
    b.phases.push({ from: 48_000, to: 100_000, truthAt: 62_000, checkAt: 90_000, expect: { kind: 'VOICE', option: 'right' } });
    return b.done({ duration: 100_000, family: 'decision', mindChange: true });
  },

  /** Lots of people TALK about left (questions, meta) while real supporters say RIGHT. */
  meta_questions(seed) {
    const b = new Builder(seed, 'meta_questions');
    const bg = b.users(b.int(8, 15), 'bg');
    const Q = b.users(b.int(25, 35), 'Q');
    const R = b.users(b.int(20, 28), 'R');
    b.chatter([...bg, ...Q, ...R], 0, 60_000);
    b.wave(Q, 5_000, 20_000, () => b.pick(P.QUESTIONS_LEFT), { repeat: 0.6 });
    b.wave(R, 5_000, 20_000, rightPhrase(b, 0.2));
    b.phases.push({ from: 0, to: 60_000, truthAt: 15_000, checkAt: 45_000, expect: { kind: 'VOICE', option: 'right' } });
    return b.done({ duration: 60_000, family: 'decision' });
  },

  /** Coordinated burst: many brand-new accounts post identical "RIGHT" within ~1 second. */
  bot_swarm(seed) {
    const b = new Builder(seed, 'bot_swarm');
    const bg = b.users(b.int(10, 15), 'bg');
    const L = b.users(b.int(18, 24), 'L');
    const bots = b.users(b.int(26, 34), 'new');
    b.chatter([...bg, ...L], 0, 60_000);
    b.wave(L, 3_000, 25_000, leftPhrase(b));
    for (const u of bots) b.say(u, 30_000 + b.r() * 1_200, 'RIGHT', true);
    b.phases.push({ from: 0, to: 60_000, checkAt: 40_000, expect: { kind: 'NOT', option: 'right' } });
    return b.done({ duration: 60_000, family: 'spam' });
  },

  /** Chat decided LEFT, then moved on. An old decision must not stay on screen forever. */
  stale_signal(seed) {
    const b = new Builder(seed, 'stale_signal');
    const bg = b.users(b.int(10, 20), 'bg');
    const L = b.users(b.int(25, 35), 'L');
    b.chatter([...bg, ...L], 0, 170_000, 25_000);
    b.wave(L, 3_000, 15_000, leftPhrase(b), { until: 30_000 });
    b.phases.push({ from: 0, to: 60_000, truthAt: 10_000, checkAt: 30_000, expect: { kind: 'VOICE', option: 'left' } });
    b.phases.push({ from: 140_000, to: 175_000, checkAt: 165_000, expect: { kind: 'NONE' } });
    return b.done({ duration: 170_000, family: 'stability' });
  },

  /** Confusion spreads, streamer answers (HEARD), confusion really drops. */
  confusion_resolved(seed) {
    const b = new Builder(seed, 'confusion_resolved');
    const bg = b.users(b.int(15, 30), 'bg');
    const C = b.users(b.int(20, 35), 'C');
    b.chatter([...bg, ...C], 0, 80_000);
    b.wave(C, 5_000, 18_000, () => b.pick(P.CONFUSED_GIVEAWAY), { repeat: 0.5, until: 30_000 });
    const stillLost = C.filter(() => b.r() < 0.1);
    b.wave(stillLost, 36_000, 30_000, () => b.pick(P.CONFUSED_GIVEAWAY), { repeat: 0 });
    b.wave(C.filter(() => b.r() < 0.4), 34_000, 10_000, () => b.pick(P.THANKS_AFTER), { repeat: 0 });
    b.actions.push({ ts: 30_000, type: 'heard', key: 'confused' });
    return b.done({ duration: 80_000, family: 'resolution', expectSignal: 'confused', expectResolved: true });
  },

  /** Streamer answers, but confusion continues. Must NOT claim resolution. */
  confusion_persists(seed) {
    const b = new Builder(seed, 'confusion_persists');
    const bg = b.users(b.int(15, 30), 'bg');
    const C = b.users(b.int(20, 35), 'C');
    const C2 = b.users(b.int(10, 20), 'C');
    b.chatter([...bg, ...C, ...C2], 0, 80_000);
    b.wave(C, 5_000, 18_000, () => b.pick(P.CONFUSED_GIVEAWAY), { repeat: 0.5, until: 30_000 });
    b.wave([...C.filter(() => b.r() < 0.6), ...C2], 33_000, 35_000, () => b.pick(P.CONFUSED_GIVEAWAY), { repeat: 0.3, until: 75_000 });
    b.actions.push({ ts: 30_000, type: 'heard', key: 'confused' });
    return b.done({ duration: 80_000, family: 'resolution', expectSignal: 'confused', expectResolved: false });
  },

  /** Request in many wordings. */
  rematch_request(seed) {
    const b = new Builder(seed, 'rematch_request');
    const bg = b.users(b.int(15, 30), 'bg');
    const Q = b.users(b.int(18, 30), 'Q');
    b.chatter([...bg, ...Q], 0, 45_000);
    b.wave(Q, 5_000, 15_000, () => b.pick(P.REMATCH));
    return b.done({ duration: 45_000, family: 'request', expectSignal: 'request:rematch' });
  },
};

export const DECISION_SCENARIOS = [
  'organic_majority', 'flood_attack', 'negation_heavy', 'divided', 'transient_burst', 'small_room',
  'big_room_minority', 'mind_change', 'meta_questions', 'bot_swarm', 'stale_signal',
];
export const SIGNAL_SCENARIOS = ['confusion_resolved', 'confusion_persists', 'rematch_request'];
