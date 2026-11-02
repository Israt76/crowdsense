import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/engine/normalize.js';
import { analyzeStance, parseHint, extractCandidateEvidence } from '../src/engine/stance.js';

const opts = ['left', 'right'];
const st = (text, hint = null) => analyzeStance(normalize(text), { options: opts, hint: hint ? parseHint(hint) : null });

test('support: plain and messy forms', () => {
  for (const t of ['go left', 'left', 'LEFT!!', 'take the left route', 'leeeeft', 'left looks safer', 'def left', 'lefft']) {
    const r = st(t);
    assert.equal(r.preference, 'left', t);
    assert.deepEqual(r.opposed, [], t);
  }
});

test('negation: "dont go left" opposes LEFT', () => {
  const r = st('dont go left');
  assert.equal(r.preference, null);
  assert.deepEqual(r.opposed, ['left']);
  assert.deepEqual(st("don't go right").opposed, ['right']);
  assert.deepEqual(st('i will not go to the left').opposed, ['left']);
});

test('verdicts: "right is a trap" opposes RIGHT', () => {
  assert.deepEqual(st('right is a trap').opposed, ['right']);
  assert.deepEqual(st('right looks dangerous').opposed, ['right']);
  assert.deepEqual(st('left is not safe').opposed, ['left']);
  assert.equal(st('right isnt a trap').preference, 'right');
});

test('"anything but right" opposes RIGHT; "nothing but left" supports LEFT', () => {
  assert.deepEqual(st('anything but right').opposed, ['right']);
  assert.equal(st('nothing but left').preference, 'left');
});

test('questions and reported speech never count as support', () => {
  for (const t of ['why is everyone saying left?', 'left or right?', 'is left better?', 'should we go left', 'everyone is spamming left lol']) {
    const r = st(t);
    assert.equal(r.preference, null, t);
    assert.equal(r.counted, false, t);
  }
});

test('"should go left" (a suggestion) still counts', () => {
  assert.equal(st('should go left').preference, 'left');
});

test('comparatives: support one side, oppose the other', () => {
  for (const t of ['left not right', 'left > right', 'left is better than right', 'not right, left', 'right is a trap, go left']) {
    const r = st(t);
    assert.equal(r.preference, 'left', t);
    assert.deepEqual(r.opposed, ['right'], t);
  }
});

test('"no" only negates when directly attached', () => {
  assert.equal(st('no im going left').preference, 'left');
  assert.deepEqual(st('no left').opposed, ['left']);
});

test('context hint maps ordinals only when given', () => {
  const hint = 'fork: left door / right door';
  assert.equal(st('take the first door', hint).preference, 'left');
  assert.equal(st('second door', hint).preference, 'right');
  assert.deepEqual(st('not the first door', hint).opposed, ['left']);
  // without a hint "first door" cannot be mapped and is not counted
  assert.equal(st('take the first door').counted, false);
  const h = parseHint(hint);
  assert.deepEqual(h.options.map((o) => o.name), ['left', 'right']);
});

test('option evidence: decision patterns vs bare words', () => {
  const ev = (t) => extractCandidateEvidence(normalize(t));
  assert.deepEqual(ev('go bridge'), [{ word: 'bridge', pattern: true }]);
  assert.deepEqual(ev('cave is a trap'), [{ word: 'cave', pattern: true }]);
  assert.deepEqual(ev('left'), [{ word: 'left', pattern: false }]);
  assert.deepEqual(ev('lol'), []);
  assert.deepEqual(ev('go again'), []);
  assert.deepEqual(ev('cozy stream'), []);
  assert.deepEqual(ev('why left?'), []);
});
