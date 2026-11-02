import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/engine/normalize.js';
import { SemanticGrouper, GROUPS, topicWords } from '../src/engine/semantics.js';
import { HashedNgramEmbedder, cosine } from '../src/engine/embed.js';

const g = new SemanticGrouper();
const cls = (t) => g.classify(normalize(t)).key;

test('different wordings of the same request form one group', () => {
  for (const t of ['run it back', 'again', 'one more', 'rematch', 'run that back', 'rematchhhh', 'go again pls', 'one more game', 'do it again!!']) {
    assert.equal(cls(t), 'request:rematch', t);
  }
});

test('confusion is recognised without exact keywords', () => {
  for (const t of ['wait what', 'how do i enter?', 'where do we join?', 'what are the rules?', "I'm lost", 'how does the giveaway work']) {
    assert.equal(cls(t), 'confused', t);
  }
});

test('hype, including emote and emoji bursts', () => {
  for (const t of ['NO WAY', 'W', 'INSANE', 'CLIP IT', '🔥🔥🔥', 'KEKW KEKW', 'POGGERS']) assert.equal(cls(t), 'hype', t);
});

test('ordinary chatter and decisions are not grouped as requests/confusion/hype', () => {
  for (const t of ['hi chat', 'love the stream', 'my dog says hi', 'go left']) assert.equal(cls(t), null, t);
});

test('embedding is deterministic and tolerant of elongation/typos', () => {
  const e1 = new HashedNgramEmbedder();
  const e2 = new HashedNgramEmbedder();
  const a = e1.embed(normalize('rematchhhh').words);
  const b = e2.embed(normalize('rematchhhh').words);
  assert.deepEqual([...a], [...b]);
  const r = e1.embed(['rematch']);
  assert.ok(cosine(r, e1.embed(normalize('rematchhh').words)) > 0.99);
  assert.ok(cosine(r, e1.embed(['rematc'])) > cosine(r, e1.embed(['banana'])));
});

test('evaluation set does not overlap the prototype library', () => {
  const data = JSON.parse(readFileSync(new URL('../eval/data/intents.json', import.meta.url)));
  const protos = new Set(Object.values(GROUPS).flatMap((x) => x.prototypes));
  for (const [text] of data.items) assert.ok(!protos.has(normalize(text).text), `"${text}" is a prototype`);
});

test('topic of a confusion cluster comes from what people ask about', () => {
  const norms = ['how do i enter the giveaway?', 'giveaway rules?', 'wait what giveaway', 'whats the song'].map(normalize);
  assert.deepEqual(topicWords(norms, 2, 0.3), ['giveaway']);
});

test('keyword mode (ablation) misses paraphrases that semantic mode catches', () => {
  const kw = new SemanticGrouper({ enabled: false });
  assert.equal(kw.classify(normalize('run it back')).key, null);
  assert.equal(cls('run it back'), 'request:rematch');
});
