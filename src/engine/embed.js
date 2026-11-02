// Local, deterministic sentence embedding.
import { stem } from './normalize.js';

export const DIM = 512;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function add(vec, feature, weight) {
  const h = fnv1a(feature);
  const idx = h % DIM;
  const sign = (h >>> 16) & 1 ? 1 : -1;
  vec[idx] += sign * weight;
}

export class HashedNgramEmbedder {
  constructor() {
    this.name = 'hashed-ngram-v1';
    this.cache = new Map();
  }
  embed(words) {
    const key = words.join(' ');
    const hit = this.cache.get(key);
    if (hit) return hit;
    const vec = new Float64Array(DIM);
    const stems = words.map(stem);
    for (let i = 0; i < stems.length; i++) {
      const w = stems[i];
      add(vec, 'w:' + w, 1.0);
      if (i + 1 < stems.length) add(vec, 'b:' + w + '_' + stems[i + 1], 0.8);
      const padded = '<' + w + '>';
      const grams = Math.max(1, padded.length - 2);
      for (let j = 0; j + 3 <= padded.length; j++) add(vec, 'c:' + padded.slice(j, j + 3), 0.9 / Math.sqrt(grams));
    }
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(key, vec);
    return vec;
  }
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
