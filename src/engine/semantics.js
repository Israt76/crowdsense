// Meaning-based grouping of non-decision chat (REQUEST, CONFUSED, HYPE).
import { HashedNgramEmbedder, cosine } from './embed.js';
import { STOPWORDS, isEmote } from './normalize.js';

export const GROUPS = {
  'request:rematch': {
    kind: 'REQUEST', label: 'REMATCH',
    prototypes: [
      'rematch', 'run it back', 'again', 'one more', 'go again', 'one more time', 'another one',
      'play again', 'do it again', 'once more', 'one more round', 'replay', 'rerun', 'try again',
      'lets go again', 'new game', 'another game', 'run back', 'redo', 'encore',
    ],
  },
  confused: {
    kind: 'CONFUSED', label: 'CONFUSED',
    prototypes: [
      'wait what', 'im confused', 'im lost', 'how do i enter', 'where do we join', 'what are the rules',
      'how does this work', 'what is happening', 'what did i miss', 'huh', 'i dont get it',
      'how do i join', 'what do we do', 'how do you enter', 'where is the link', 'what is going on',
      'can someone explain', 'how to enter', 'what are we doing', 'so confused', 'explain pls',
      'where do i sign up', 'how do i participate', 'whats the code', 'i dont understand',
    ],
  },
  hype: {
    kind: 'HYPE', label: 'HYPE',
    prototypes: [
      'no way', 'w', 'insane', 'clip it', 'lets go', 'pog', 'omg', 'holy', 'massive w', 'clip that',
      'thats crazy', 'unreal', 'goated', 'huge', 'what a play', 'sheesh', 'cracked', 'kekw',
      'pogchamp', 'so clean', 'absolutely insane', 'big w', 'clutch', 'monster',
    ],
  },
  chatter: {
    kind: 'CHATTER', label: 'CHATTER',
    prototypes: [
      'hi chat', 'hello', 'good morning', 'whats up', 'first time here', 'love the stream',
      'nice overlay', 'what game is this', 'how long have you been streaming', 'i had pizza',
      'my cat is here', 'brb', 'gn chat', 'back', 'cool music', 'what song is this',
      'hey everyone', 'just got here', 'love this', 'thanks for the stream', 'how are you',
    ],
  },
};

export const KEYWORDS = {
  'request:rematch': ['rematch', 'again'],
  confused: ['confused', 'lost', 'rules', 'enter', 'join'],
  hype: ['w', 'pog', 'insane', 'clip', 'omg'],
};

const QUESTION_WORDS = new Set(['how', 'where', 'what', 'whats', 'wheres', 'hows', 'huh', 'confused', 'lost', 'explain']);
const CONFUSION_LEXICON = new Set([
  'wait', 'what', 'whats', 'how', 'where', 'huh', 'confused', 'lost', 'rules', 'explain', 'enter', 'join',
  'understand', 'get', 'it', 'do', 'i', 'we', 'you', 'is', 'are', 'the', 'this', 'to', 'work', 'happening',
  'going', 'on', 'miss', 'did', 'link', 'code', 'sign', 'up', 'participate', 'can', 'someone', 'so', 'pls',
  'im', 'dont', 'a', 'in', 'for', 'of', 'does', 'mean', 'means', 'meaning', 'anyone', 'know', 'please',
  'wheres', 'even', 'entered', 'need', 'type', 'still', 'open', 'get', 'whats', 'hows', 'supposed', 'again',
]);

const DEFAULT_EMBEDDER = new HashedNgramEmbedder();
const SHARED = new WeakMap();

export class SemanticGrouper {
  constructor(opts = {}) {
    this.embedder = opts.embedder || DEFAULT_EMBEDDER;
    this.threshold = opts.threshold ?? 0.5;
    this.margin = opts.margin ?? 0.03;
    this.enabled = opts.enabled ?? true;
    let shared = SHARED.get(this.embedder);
    if (!shared) {
      const protos = [];
      for (const [key, g] of Object.entries(GROUPS)) {
        for (const p of g.prototypes) protos.push({ key, vec: this.embedder.embed(p.split(' ')) });
      }
      shared = { protos, results: new Map() };
      SHARED.set(this.embedder, shared);
    }
    this.protos = shared.protos;
    this.results = shared.results;
    this.settingsKey = `${this.threshold}|${this.margin}|`;
  }

  classify(norm) {
    if (!norm.words.length) {
      if (norm.emojiCount >= 2) return { key: 'hype', score: 1 };
      return { key: null, score: 0 };
    }
    if (!this.enabled) return this.keywordClassify(norm);
    if (norm.emoteCount >= 1 && norm.emoteCount >= norm.words.length / 2) return { key: 'hype', score: 1 };
    if (norm.emojiCount >= 3 && norm.words.length <= 2) return { key: 'hype', score: 1 };
    const cacheKey = this.settingsKey + (norm.isQuestion ? '?' : '') + norm.text;
    const hit = this.results.get(cacheKey);
    if (hit) return hit;
    const result = this._nearest(norm);
    if (this.results.size > 100_000) this.results.clear();
    this.results.set(cacheKey, result);
    return result;
  }

  _nearest(norm) {
    const v = this.embedder.embed(norm.words);
    const best = new Map();
    for (const p of this.protos) {
      const s = cosine(v, p.vec);
      if (s > (best.get(p.key) ?? -1)) best.set(p.key, s);
    }
    if (norm.isQuestion && norm.words.some((w) => QUESTION_WORDS.has(w))) {
      best.set('confused', (best.get('confused') ?? 0) + 0.08);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topScore] = ranked[0];
    const second = ranked[1]?.[1] ?? 0;
    if (topScore < this.threshold || topScore - second < this.margin || topKey === 'chatter') {
      return { key: null, score: topScore };
    }
    return { key: topKey, score: topScore };
  }

  keywordClassify(norm) {
    for (const [key, kws] of Object.entries(KEYWORDS)) {
      if (norm.words.some((w) => kws.includes(w))) return { key, score: 1 };
    }
    if (norm.emoteCount >= 1) return { key: 'hype', score: 1 };
    return { key: null, score: 0 };
  }
}

export function topicWords(normList, k = 2, minShare = 0) {
  const counts = new Map();
  for (const n of normList) {
    const seen = new Set();
    for (const w of n.words) {
      if (w.length < 3 || STOPWORDS.has(w) || CONFUSION_LEXICON.has(w) || isEmote(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2 && c >= minShare * normList.length)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([w]) => w);
}
