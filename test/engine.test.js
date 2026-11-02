import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrowdSense } from '../src/engine/engine.js';
import { minVoices } from '../src/engine/thresholds.js';
import { DEFAULT_CONFIG } from '../src/engine/engine.js';
import { WindowBaseline, EngineSystem } from '../src/engine/baselines.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { runScenario, scoreDecision } from '../src/sim/harness.js';

/** Feed messages and tick every 250 ms until `until`. Returns the last snapshot. */
function play(cs, msgs, until, { onTick } = {}) {
  const sorted = [...msgs].sort((a, b) => a.ts - b.ts);
  let i = 0;
  let snap;
  for (let t = 0; t <= until; t += 250) {
    while (i < sorted.length && sorted[i].ts <= t) cs.ingest(sorted[i++]);
    snap = cs.tick(t);
    onTick?.(t, snap);
  }
  return snap;
}
const chatter = (n, from, to, prefix = 'bg') => Array.from({ length: n }, (_, k) => ({ userId: `${prefix}${k}`, text: 'hi chat', ts: from + ((k * 997) % (to - from)) }));
const say = (ids, text, from, step = 300) => ids.map((u, k) => ({ userId: u, text: typeof text === 'function' ? text(k) : text, ts: from + k * step }));
const ids = (n, p) => Array.from({ length: n }, (_, k) => `${p}${k}`);

test('a crowd voice forms from varied wording', () => {
  const cs = new CrowdSense();
  const variants = ['left', 'go left', 'LEFT!!', 'take the left route', 'left looks safer', "don't go right", 'right is a trap'];
  const snap = play(cs, [...chatter(10, 0, 5000), ...say(ids(25, 'L'), (k) => variants[k % variants.length], 1000)], 20_000);
  assert.equal(snap.decide.state, 'VOICE');
  assert.equal(snap.decide.option, 'left');
  assert.equal(snap.overlay.kind, 'VOICE');
  assert.equal(snap.overlay.label, 'GO LEFT');
  assert.equal(snap.overlay.viewers, 25);
});

test('one viewer, one voice: 50 messages from one account count once', () => {
  const cs = new CrowdSense();
  const msgs = [...say(['spammer'], 'RIGHT', 0).flatMap((m) => Array.from({ length: 50 }, (_, k) => ({ ...m, ts: 500 + k * 100 }))),
    ...say(['r1', 'r2'], 'go right', 1200), ...say(ids(10, 'L'), (k) => ['left', 'go left', 'left is safer'][k % 3], 1000)];
  play(cs, msgs, 8000);
  const ex = cs.explain();
  const right = ex.decide.opposing.find((o) => o.option === 'RIGHT') || { viewers: ex.decide.option === 'RIGHT' ? ex.decide.uniqueViewers : 0 };
  assert.equal(ex.decide.option, 'LEFT');
  assert.equal(ex.decide.uniqueViewers, 10);
  assert.equal(right.viewers, 3, 'spammer + 2 viewers = 3 voices, not 52');
  assert.ok(ex.decide.reasons.some((r) => /flooding/.test(r)), 'flooding is explained');
});

test('a viewer who changes their mind moves to the new side', () => {
  const cs = new CrowdSense();
  play(cs, [{ userId: 'a', text: 'left', ts: 0 }, { userId: 'b', text: 'right', ts: 0 }, { userId: 'c', text: 'right', ts: 0 }, { userId: 'a', text: 'actually RIGHT', ts: 2000 }], 3000);
  const ex = cs.explain();
  assert.equal(ex.decide.option, 'RIGHT');
  assert.equal(ex.decide.uniqueViewers, 3);
  assert.equal(ex.decide.share, 1);
});

test('temporal stability: a voice is not announced before it persists', () => {
  const cs = new CrowdSense();
  const states = [];
  const v = ['left', 'go left', 'LEFT!!', 'left looks safer', 'take the left route'];
  play(cs, [...chatter(8, 0, 3000), ...say(ids(20, 'L'), (k) => v[k % v.length], 3000, 150)], 15_000, { onTick: (t, s) => states.push([t, s.decide.state]) });
  const firstVoice = states.find(([, s]) => s === 'VOICE')[0];
  const conditionMet = 3000 + 9 * 150; // enough viewers (need = 9) have spoken
  assert.ok(firstVoice >= conditionMet + DEFAULT_CONFIG.stableMs - 1500, `voice at ${firstVoice}`);
  assert.ok(states.some(([, s]) => s === 'FORMING'), 'goes through FORMING');
});

test('temporal decay: an old decision fades out of the overlay', () => {
  const r = runScenario(new EngineSystem(), SCENARIOS.stale_signal(1));
  assert.equal(r.find((x) => x.t === 30_000).kind, 'VOICE');
  assert.equal(r.find((x) => x.t === 165_000).kind, 'NONE');
});

test('adaptive thresholds: a crowd is relative to the room', () => {
  const cfg = DEFAULT_CONFIG;
  assert.equal(minVoices(8, cfg), 3);
  assert.ok(minVoices(100, cfg) > minVoices(20, cfg));
  assert.ok(minVoices(400, cfg) < 0.1 * 400, 'sub-linear');
  assert.equal(minVoices(400, { ...cfg, adaptive: false }), cfg.fixedMinVoices);
  for (const seed of [1, 2, 3]) {
    const small = SCENARIOS.small_room(seed);
    const big = SCENARIOS.big_room_minority(seed);
    assert.equal(scoreDecision(small, runScenario(new EngineSystem(), small)).correct, 1, 'small room speaks');
    assert.equal(scoreDecision(big, runScenario(new EngineSystem(), big)).falseVoices, 0, 'big-room minority is not a crowd');
    const fixedBig = scoreDecision(big, runScenario(new EngineSystem({ adaptive: false }), big));
    assert.ok(fixedBig.falseVoices >= 1, 'a fixed threshold calls a minority a crowd');
  }
});

test('divided chat is shown as divided, never as a winner', () => {
  const cs = new CrowdSense();
  const lv = ['left', 'go left', 'left is safer', 'right is a trap'];
  const rv = ['right', 'go right', 'right!!', 'left is a trap'];
  const snap = play(cs, [...chatter(10, 0, 4000), ...say(ids(20, 'L'), (k) => lv[k % 4], 1000, 400), ...say(ids(19, 'R'), (k) => rv[k % 4], 1100, 400)], 18_000);
  assert.equal(snap.decide.state, 'DIVIDED');
  assert.equal(snap.overlay.kind, 'DIVIDED');
  assert.equal(snap.overlay.options.length, 2);
});

test('PROOF: varied LEFT majority beats a RIGHT flood; message counters do not', () => {
  for (const seed of [11, 12, 13, 14]) {
    const sc = SCENARIOS.flood_attack(seed);
    const cs = scoreDecision(sc, runScenario(new EngineSystem({}, sc.hint), sc));
    assert.equal(cs.correct, 1, `CrowdSense seed ${seed}`);
    assert.equal(cs.falseVoices, 0);
    for (const mode of ['raw', 'keyword']) {
      const b = scoreDecision(sc, runScenario(new WindowBaseline(mode, { hint: sc.hint }), sc));
      assert.equal(b.correct, 0, `${mode} baseline should be hijacked (seed ${seed})`);
    }
  }
});

test('suspicious synchronized burst pauses the voice instead of announcing it', () => {
  const sc = SCENARIOS.bot_swarm(3);
  const tl = runScenario(new EngineSystem(), sc);
  assert.ok(!tl.some((r) => r.kind === 'VOICE' && r.option === 'right'), 'never announces the swarm');
  assert.ok(tl.some((r) => r.state === 'PAUSED'), 'shows paused state');
  const noIntegrity = runScenario(new EngineSystem({ integrity: false }), sc);
  assert.ok(noIntegrity.some((r) => r.kind === 'VOICE' && r.option === 'right'), 'without integrity the swarm wins');
});

test('suspicious viewers are down-weighted, not removed', () => {
  const cs = new CrowdSense();
  const bots = ids(30, 'new').map((u, k) => ({ userId: u, text: 'RIGHT', ts: 10_000 + k * 30, firstMsg: true }));
  play(cs, [...chatter(10, 0, 5000), ...say(ids(12, 'L'), (k) => ['left', 'go left', 'left looks safer'][k % 3], 1000, 400), ...bots], 14_000);
  const ex = cs.explain();
  const right = [ex.decide, ...ex.decide.opposing].find((o) => (o.option || '') === 'RIGHT');
  assert.equal(right.viewers ?? right.uniqueViewers, 30, 'all 30 still counted as people');
  assert.ok(ex.decide.confidenceReduced);
});

test('mind change: LEFT then RIGHT produces CHAT CHANGED ITS MIND', () => {
  const sc = SCENARIOS.mind_change(2);
  const sys = new EngineSystem();
  let changed = null;
  runScenario(sys, sc, { onTick: (_t, _o, s) => { for (const e of s.last.events) if (e.type === 'TRANSIENT' && e.kind === 'MIND_CHANGED') changed = e; } });
  assert.ok(changed);
  assert.equal(changed.from, 'LEFT');
  assert.equal(changed.to, 'RIGHT');
});

test('resolution: measured drop, transparent arithmetic', () => {
  const cs = new CrowdSense();
  const conf = ids(24, 'C').map((u, k) => ({ userId: u, text: 'how do i enter the giveaway?', ts: 1000 + k * 600 }));
  const after = ids(3, 'C').map((u, k) => ({ userId: u, text: 'wait how do i enter the giveaway', ts: 20_000 + k * 4000 }));
  let resolved = null;
  play(cs, [...chatter(15, 0, 10_000), ...conf], 16_000);
  assert.equal(cs.tick(16_000).overlay.kind, 'CONFUSED');
  cs.markHeard('confused', 16_000);
  play2(cs, after, 16_000, 50_000, (e) => { if (e.type === 'RESOLVED') resolved = e; });
  assert.ok(resolved, 'resolved');
  // before: unique confused viewers in [-4s, 16s] / 20 s; after: unique since 19 s / elapsed
  const before = resolved.beforeViewers / 20;
  const afterRate = resolved.afterViewers / (resolved.observedMs / 1000);
  assert.equal(resolved.dropPct, Math.round((1 - afterRate / before) * 100));
  assert.ok(resolved.dropPct >= 60);
});

function play2(cs, msgs, from, until, onEvent) {
  let i = 0;
  for (let t = from; t <= until; t += 250) {
    while (i < msgs.length && msgs[i].ts <= t) cs.ingest(msgs[i++]);
    for (const e of cs.tick(t).events) onEvent(e);
  }
}

test('resolution: continuing confusion is NOT reported as resolved', () => {
  for (const seed of [1, 3, 4]) {
    const sc = SCENARIOS.confusion_persists(seed);
    let resolved = false;
    runScenario(new EngineSystem(), sc, { onTick: (_t, _o, s) => { for (const e of s.last.events) if (e.type === 'RESOLVED') resolved = true; } });
    assert.equal(resolved, false, `seed ${seed}`);
  }
});

test('request and hype moments', () => {
  const cs = new CrowdSense();
  const words = ['rematch', 'run it back', 'one more', 'again', 'run that back', 'go again pls'];
  const snap = play(cs, [...chatter(10, 0, 4000), ...say(ids(12, 'Q'), (k) => words[k % words.length], 1000, 300)], 12_000);
  assert.equal(snap.overlay.kind, 'REQUEST');
  assert.equal(snap.overlay.label, 'REMATCH');
  const cs2 = new CrowdSense();
  let hype = false;
  play(cs2, [...chatter(10, 0, 4000), ...say(ids(15, 'H'), (k) => ['NO WAY', 'W', 'INSANE', 'CLIP IT', '🔥🔥🔥'][k % 5], 6000, 100)], 9000,
    { onTick: (_t, s) => { if (s.overlay?.kind === 'HYPE') hype = true; } });
  assert.ok(hype);
});

test('noise stays noise: random chatter never produces an overlay', () => {
  const cs = new CrowdSense();
  let shown = false;
  const lines = ['hi chat', 'lol', 'love the stream', 'gg', 'classic', 'hydrate', 'nice', 'o7'];
  const msgs = Array.from({ length: 300 }, (_, k) => ({ userId: `u${k % 60}`, text: lines[k % lines.length], ts: k * 150 }));
  play(cs, msgs, 46_000, { onTick: (_t, s) => { if (s.overlay && s.overlay.kind !== 'FORMING') shown = true; } });
  assert.equal(shown, false);
});

test('explanations are aggregate only (no user ids)', () => {
  const cs = new CrowdSense();
  play(cs, say(ids(10, 'secretuser'), (k) => ['left', 'go left'][k % 2], 0, 400), 9000);
  const json = JSON.stringify(cs.explain());
  assert.ok(!json.includes('secretuser'));
});
