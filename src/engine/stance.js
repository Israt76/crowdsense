// Decision understanding: which option a message supports or opposes.
import { normalize, STOPWORDS, isEmote } from './normalize.js';
import { dice } from './embed.js';

const NEGATORS = new Set(['dont', 'not', 'never', 'no', 'avoid', 'skip', 'stop', 'nobody', 'cant', 'wont', 'shouldnt', 'nope', 'without', 'except']);
const NEG_PREDICATES = new Set([
  'trap', 'bad', 'dangerous', 'sucks', 'death', 'dead', 'wrong', 'cursed', 'scary', 'sus', 'worse', 'worst',
  'risky', 'terrible', 'trash', 'kills', 'die', 'fake', 'bait', 'troll', 'doomed', 'deadly', 'evil', 'suicide',
  'horrible', 'awful', 'nightmare', 'unsafe', 'blocked', 'locked', 'ambush', 'mistake', 'garbage', 'loses', 'lose',
]);
const POS_PREDICATES = new Set([
  'safe', 'safer', 'safest', 'better', 'best', 'good', 'correct', 'free', 'clear', 'open', 'obviously', 'easier',
  'easy', 'faster', 'shorter', 'wins', 'win', 'smarter', 'fine', 'great', 'goated', 'right',
]);
const PRED_NEGATORS = new Set(['isnt', 'not', 'never', 'aint', 'no']);
const META_VERBS = new Set(['saying', 'says', 'said', 'spamming', 'typing', 'typed', 'voting', 'picking']);
const CLAUSE_BREAKS = new Set([',', '.', ';', '?', 'but']);
const QUESTION_START = new Set(['why', 'what', 'which', 'how', 'whats', 'is', 'are', 'does', 'should', 'can', 'could', 'would', 'was', 'were', 'do', 'did', 'who']);
const DECISION_VERBS = new Set(['go', 'take', 'pick', 'choose', 'vote', 'try', 'hit', 'use', 'open', 'enter', 'head', 'turn', 'follow']);
const DETERMINERS = new Set(['the', 'a', 'an', 'that', 'this', 'to', 'for', 'with', 'into', 'through', 'thru', 'down', 'up']);
const FILLER = new Set([
  'go', 'take', 'pick', 'choose', 'the', 'a', 'pls', 'plz', 'please', 'chat', 'just', 'do', 'it', 'guys', 'now',
  'lets', 'i', 'say', 'vote', 'route', 'path', 'way', 'door', 'side', 'one', 'option', 'obviously', 'definitely',
  'actually', 'nah', 'ok', 'okay', 'yes', 'yeah', 'bro', 'man', 'dude', 'go', 'team', 'gotta', 'is', 'it', 'its',
  'clearly', 'surely', 'easy', 'trust', 'me', 'nvm', 'wait', 'hmm', 'ofc', 'always', 'same', 'agree', 'yep',
]);
const NOT_OPTIONS = new Set([
  'again', 'rematch', 'insane', 'clip', 'pog', 'lol', 'lmao', 'gg', 'w', 'l', 'what', 'huh', 'wait', 'here', 'there',
  'back', 'home', 'omg', 'wow', 'nice', 'hype', 'yes', 'no', 'yo', 'hi', 'hey', 'hello', 'bye', 'brb', 'true', 'facts',
  'crazy', 'more', 'confused', 'lost', 'rules', 'way', 'more', 'win', 'ez', 'clutch', 'lets', 'good', 'bad', 'it',
  'them', 'him', 'her', 'thanks', 'ty', 'same', 'agreed', 'real', 'fr', 'based', 'sheesh', 'holy', 'huge', 'massive',
  'trap', 'safe', 'safer', 'better', 'best', 'worse', 'wrong', 'dead', 'death', 'giveaway', 'stream', 'game', 'play',
  'haha', 'hahaha', 'classic', 'hydrate', 'ok', 'cool', 'love', 'thanks', 'welcome', 'gn', 'gm', 'o7', 'yup', 'sure',
  'link', 'code', 'enter', 'join', 'one', 'first', 'second', 'last', 'other', 'redo', 'replay', 'encore', 'unreal',
  'anything', 'everything', 'nothing', 'isnt', 'aint', 'say', 'saying', 'says', 'said', 'spamming', 'typing', 'looks',
  'seems', 'feels', 'think', 'thinks', 'going', 'gonna', 'want', 'need', 'everyone', 'someone', 'nobody', 'people',
  'option', 'route', 'path', 'door', 'side', 'wins', 'loses', 'skip', 'avoid', 'stop', 'never', 'dont', 'cant', 'wont',
]);

const ORDINALS = [
  ['first', '1st', 'one', '1'],
  ['second', '2nd', 'two', '2'],
  ['third', '3rd', 'three', '3'],
  ['fourth', '4th', 'four', '4'],
];

export function parseHint(hint) {
  if (!hint || !String(hint).trim()) return null;
  let body = String(hint).trim();
  let topic = '';
  const colon = body.indexOf(':');
  if (colon >= 0) {
    topic = body.slice(0, colon).trim();
    body = body.slice(colon + 1);
  }
  const segs = body.split(/s*(?:/|||vs.?|or)s*/i).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const segWords = segs.map((s) => normalize(s).words);
  const counts = new Map();
  for (const ws of segWords) for (const w of new Set(ws)) counts.set(w, (counts.get(w) || 0) + 1);
  const options = segWords.map((ws, i) => {
    const distinctive = ws.filter((w) => counts.get(w) === 1 && !STOPWORDS.has(w));
    const nameWords = distinctive.length ? distinctive : ws;
    const name = nameWords.join(' ');
    const shared = ws.filter((w) => counts.get(w) > 1);
    const aliases = new Set([ws.join(' '), name]);
    const ord = ORDINALS[i] || [];
    const nouns = [...shared, 'one', 'option'];
    for (const o of ord) {
      for (const n of nouns) {
        aliases.add(`${o} ${n}`);
        aliases.add(`${n} ${o}`);
      }
    }
    if (i === segWords.length - 1 && segWords.length >= 2) for (const n of nouns) aliases.add(`last ${n}`);
    return { name, label: name.toUpperCase(), aliases: [...aliases].filter(Boolean) };
  });
  return { topic, options };
}

function applyHint(tokens, hint) {
  if (!hint) return tokens;
  const aliasList = [];
  for (const o of hint.options) {
    for (const a of o.aliases) aliasList.push({ seq: a.split(' '), name: o.name });
  }
  aliasList.sort((a, b) => b.seq.length - a.seq.length);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = null;
    for (const a of aliasList) {
      if (a.seq.length < 1) continue;
      let ok = true;
      for (let k = 0; k < a.seq.length; k++) if (tokens[i + k] !== a.seq[k]) { ok = false; break; }
      if (ok) { matched = a; break; }
    }
    if (matched) {
      out.push(`__opt:${matched.name}`);
      i += matched.seq.length;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out;
}

function mapToken(tok, options, fuzzy) {
  if (tok.startsWith('__opt:')) return tok.slice(6);
  if (options.includes(tok)) return tok;
  if (fuzzy && tok.length >= 4 && /^[a-z]+$/.test(tok)) {
    let best = null;
    let bestS = 0;
    for (const o of options) {
      if (o.includes(' ')) continue;
      const s = dice(tok, o);
      if (s > bestS) { bestS = s; best = o; }
    }
    if (bestS >= 0.8) return best;
  }
  return null;
}

export function analyzeStance(norm, ctx) {
  const options = ctx.options || [];
  const fuzzy = ctx.fuzzy ?? true;
  const stanceOn = ctx.stance ?? true;
  const tokens = applyHint(norm.tokens, ctx.hint);
  const mentionIdx = [];
  for (let i = 0; i < tokens.length; i++) {
    const opt = mapToken(tokens[i], options, fuzzy);
    if (opt) mentionIdx.push({ i, option: opt });
  }
  if (!mentionIdx.length) return { mentions: [], preference: null, opposed: [], counted: false };

  if (!stanceOn) {
    const option = mentionIdx[0].option;
    return {
      mentions: mentionIdx.map((m) => ({ option: m.option, stance: 'support', rule: 'mention' })),
      preference: option, opposed: [], counted: true,
    };
  }

  const clauseId = new Array(tokens.length).fill(0);
  const clauseIsQuestion = [];
  const clauseStart = [0];
  let c = 0;
  for (let i = 0; i < tokens.length; i++) {
    clauseId[i] = c;
    const t = tokens[i];
    const isAnythingBut = t === 'but' && ['anything', 'everything', 'all', 'nothing'].includes(tokens[i - 1]);
    if (CLAUSE_BREAKS.has(t) && !isAnythingBut) {
      clauseIsQuestion[c] = t === '?';
      c++;
      clauseStart[c] = i + 1;
    }
  }
  const lastClause = c;
  if (clauseIsQuestion[lastClause] === undefined) clauseIsQuestion[lastClause] = false;
  for (let k = 0; k <= lastClause; k++) {
    const first = tokens[clauseStart[k]];
    if (first && QUESTION_START.has(first)) {
      const second = tokens[clauseStart[k] + 1];
      if (first === 'should' && !['we', 'i', 'he', 'she', 'they', 'you'].includes(second)) continue;
      clauseIsQuestion[k] = true;
    }
  }

  const mentions = [];
  for (let m = 0; m < mentionIdx.length; m++) {
    const { i, option } = mentionIdx[m];
    const cl = clauseId[i];
    const prevMention = m > 0 && clauseId[mentionIdx[m - 1].i] === cl ? mentionIdx[m - 1].i : clauseStart[cl] - 1;
    const nextMention = m + 1 < mentionIdx.length && clauseId[mentionIdx[m + 1].i] === cl ? mentionIdx[m + 1].i : Infinity;
    let stance = 'support';
    let rule = 'default-support';

    if (clauseIsQuestion[cl]) { stance = 'question'; rule = 'question'; }

    if (stance === 'support') {
      for (let j = Math.max(prevMention + 1, i - 3); j < i; j++) {
        if (META_VERBS.has(tokens[j]) && !['i', 'im'].includes(tokens[j - 1])) { stance = 'meta'; rule = 'reported-speech'; }
      }
    }

    if (stance === 'support') {
      for (let j = Math.max(prevMention + 1, clauseStart[cl]); j < i; j++) {
        const t = tokens[j];
        if (t === 'but' && ['anything', 'everything', 'all', 'nothing'].includes(tokens[j - 1])) {
          stance = tokens[j - 1] === 'nothing' ? 'support' : 'oppose';
          rule = tokens[j - 1] === 'nothing' ? 'nothing-but' : 'anything-but';
        } else if (NEGATORS.has(t) && (i - j <= ((t === 'no' || t === 'stop') ? 1 : 4))) {
          stance = 'oppose'; rule = `negator:${t}`;
        } else if (t === 'than' || t === 'instead' || t === 'over' || t === '>') {
          if (prevMention >= clauseStart[cl] || t === 'than' || t === 'instead') { stance = 'oppose'; rule = `comparative:${t}`; }
        } else if (t === 'rather' && tokens[j + 1] === 'than') {
          stance = 'oppose'; rule = 'rather-than';
        }
      }
    }

    if (stance === 'support' || stance === 'oppose') {
      let predNeg = false;
      for (let j = i + 1; j < Math.min(nextMention, tokens.length, i + 6); j++) {
        const t = tokens[j];
        if (CLAUSE_BREAKS.has(t) && t !== 'but') break;
        if (t === 'but' || t === 'than') break;
        if (PRED_NEGATORS.has(t)) { predNeg = true; continue; }
        if (NEG_PREDICATES.has(t)) {
          stance = predNeg ? 'support' : 'oppose';
          rule = predNeg ? 'neg-pred-negated' : `neg-pred:${t}`;
          break;
        }
        if (POS_PREDICATES.has(t)) {
          if (t === 'right' && options.includes('right')) continue;
          if (predNeg) { stance = 'oppose'; rule = `pos-pred-negated:${t}`; }
          else if (stance === 'support') { rule = `pos-pred:${t}`; }
          break;
        }
      }
    }
    mentions.push({ option, stance, rule, i });
  }

  for (let m = 0; m + 1 < mentions.length; m++) {
    const a = mentions[m];
    const b = mentions[m + 1];
    if (clauseId[a.i] === clauseId[b.i] && tokens.slice(a.i + 1, b.i).includes('or') &&
      a.rule === 'default-support' && b.rule === 'default-support') {
      a.stance = 'neutral'; a.rule = 'disjunction';
      b.stance = 'neutral'; b.rule = 'disjunction';
    }
  }

  const supports = [...new Set(mentions.filter((x) => x.stance === 'support').map((x) => x.option))];
  const opposed = [...new Set(mentions.filter((x) => x.stance === 'oppose').map((x) => x.option))].filter((o) => !supports.includes(o));
  const preference = supports.length === 1 ? supports[0] : null;
  return {
    mentions: mentions.map(({ option, stance, rule }) => ({ option, stance, rule })),
    preference,
    opposed,
    counted: preference !== null || opposed.length > 0,
  };
}

export function extractCandidates(norm) {
  return extractCandidateEvidence(norm).map((x) => x.word);
}

export function extractCandidateEvidence(norm) {
  const w = norm.words;
  if (!w.length || norm.isQuestion) return [];
  const isCand = (x) => x && x.length >= 2 && /^[a-z]+$/.test(x) && !STOPWORDS.has(x) && !NOT_OPTIONS.has(x) && !isEmote(x);
  const pattern = new Set();
  for (let i = 0; i < w.length; i++) {
    if (DECISION_VERBS.has(w[i]) || NEGATORS.has(w[i]) || (w[i] === 'but' && w[i - 1] === 'anything')) {
      let j = i + 1;
      while (j < w.length && (DETERMINERS.has(w[j]) || DECISION_VERBS.has(w[j]))) j++;
      if (isCand(w[j])) pattern.add(w[j]);
    }
    if (i > 0 && (NEG_PREDICATES.has(w[i]) || POS_PREDICATES.has(w[i]) || w[i] === '>')) {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (isCand(w[j]) && !['looks', 'seems', 'feels'].includes(w[j])) { pattern.add(w[j]); break; }
      }
    }
  }
  const out = [...pattern].map((word) => ({ word, pattern: true }));
  const content = [...new Set(w.filter((x) => !FILLER.has(x) && !/^[0-9]+$/.test(x)))];
  if (content.length === 1 && isCand(content[0]) && !pattern.has(content[0])) out.push({ word: content[0], pattern: false });
  return out;
}

export const DECISION_LEXICON = new Set([
  'left', 'right', 'up', 'down', 'north', 'south', 'east', 'west', 'forward', 'backward', 'top', 'bottom', 'middle',
  'center', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'black', 'white', 'stairs', 'ladder', 'bridge',
  'cave', 'boat', 'sword', 'shield', 'bow', 'fight', 'run', 'flee', 'hide', 'attack', 'defend', 'heal', 'stay',
  'leave', 'inside', 'outside', 'upstairs', 'downstairs', 'jump', 'wait', 'push', 'pull',
]);
