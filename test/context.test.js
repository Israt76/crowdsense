import test from 'node:test';
import assert from 'node:assert/strict';
import { CrowdSense } from '../src/engine/engine.js';

const make = () => new CrowdSense({ stableMs: 0 });

test('same hint retains a stance after unrelated chatter scrolls it out of recent messages', () => {
  const c = make();
  c.setContext('fork: left / right', 0);
  c.ingest({ userId: 'a', text: 'go left', ts: 1 });
  c.tick(2);
  for (let i = 3; i < 9; i++) c.ingest({ userId: 'a', text: 'hi chat', ts: i });
  c.setContext('fork: left door / right door', 10);
  const s = c.tick(11);
  assert.equal(s.decide.participants, 1);
  assert.equal(s.decide.options.find(o => o.name === 'left').viewers, 1);
});

test('initial matching hint preserves support and opposition but excludes unrelated choices', () => {
  const c = make();
  for (const [userId, text] of [['a', 'left'], ['b', 'right is a trap'], ['c', 'go cave']])
    c.ingest({ userId, text, ts: 1 });
  c.setContext('fork: left door / right door', 2);
  assert.equal(c.tick(3).decide.participants, 2);
  assert.equal(c.voters.get('c').recent.length, 0);
});

test('different choices sharing generic door and ordinal words clear prior stances', () => {
  const c = make();
  c.setContext('fork: left door / right door', 0);
  c.ingest({ userId: 'a', text: 'first door', ts: 1 });
  c.tick(2);
  c.setContext('fork: red door / blue door', 3);
  assert.equal(c.tick(4).decide.participants, 0);
});

test('a genuinely different topic resets even when the direction names are reused', () => {
  const c = make();
  c.setContext('fork: left / right', 0);
  c.ingest({ userId: 'a', text: 'left', ts: 1 });
  c.setContext('boss: left / right', 2);
  assert.equal(c.tick(3).decide.participants, 0);
});

test('reordering matching options preserves explicit stances without remapping old ordinals', () => {
  const c = make();
  c.setContext('fork: left door / right door', 0);
  c.ingest({ userId: 'a', text: 'first door', ts: 1 });
  c.ingest({ userId: 'b', text: 'left', ts: 1 });
  c.setContext('fork: right door / left door', 2);
  const s = c.tick(3);
  assert.equal(s.decide.participants, 1);
  assert.equal(s.decide.options.find(o => o.name === 'left').viewers, 1);
});

test('matching hints do not revive expired stances', () => {
  const c = make();
  c.setContext('fork: left / right', 0);
  c.ingest({ userId: 'a', text: 'left', ts: 1 });
  c.tick(2);
  c.setContext('fork: left / right', 100000);
  assert.equal(c.tick(100001).decide.participants, 0);
});
