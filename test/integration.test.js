import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrowdSense } from '../src/engine/engine.js';
import { buildDemo } from '../src/sim/demo-script.js';
import { runDemoHeadless } from '../src/sim/demo-runner.js';
import { readLog, makeAnonymizer, scrubText, ChatLogger } from '../src/live/privacy.js';
import { parseIrcLine } from '../src/live/twitch.js';
import { cardHTML } from '../public/overlay.js';

test('demo uses the real engine and hits every required moment in order', () => {
  const seq = runDemoHeadless(buildDemo()).map((r) => r.kind);
  const want = ['FORMING', 'VOICE', 'HEARD', 'VOICE', 'DIVIDED', 'CONFUSED', 'HEARD', 'VOICE', 'MIND_CHANGED', 'RESOLVED', 'REQUEST', 'HYPE'];
  let i = 0;
  for (const k of seq) if (k === want[i]) i++;
  assert.equal(i, want.length, `demo sequence was: ${seq.join(' > ')}`);
  assert.equal(seq[0], 'EMPTY', 'overlay starts empty');
  assert.equal(seq.at(-1), 'EMPTY', 'overlay ends empty');
});

test('demo spam scene: counter says RIGHT, CrowdSense says LEFT', () => {
  const tl = runDemoHeadless(buildDemo());
  const spamVoice = tl.find((r) => r.kind === 'VOICE' && r.t > 22_000 && r.t < 40_000);
  assert.equal(spamVoice.overlay.label, 'GO LEFT');
  assert.ok(spamVoice.counter.right > spamVoice.counter.left * 2, JSON.stringify(spamVoice.counter));
});

test('demo RESOLVED percentage is measured, not hard-coded', () => {
  const r = runDemoHeadless(buildDemo()).find((x) => x.kind === 'RESOLVED');
  const o = r.overlay;
  assert.ok(o.before > 0 && o.after >= 0);
  assert.ok(o.dropPct > 0 && o.dropPct <= 100);
  // a different seed gives different chat and (generally) a different measured value
  const r2 = runDemoHeadless(buildDemo(99)).find((x) => x.kind === 'RESOLVED');
  assert.ok(r2, 'resolution also detected with another seed');
});

test('simulator replay: an anonymized JSONL log runs through the same engine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-'));
  const file = join(dir, 'log.jsonl');
  const logger = new ChatLogger(file, makeAnonymizer('test-salt-123'));
  const words = ['left', 'go left', 'left looks safer', "don't go right", 'take the left route'];
  for (let k = 0; k < 20; k++) logger.log({ userId: `realuser${k}`, text: `@someone ${words[k % 5]}`, ts: 1_000_000 + k * 400 });
  for (let k = 0; k < 8; k++) logger.log({ userId: `other${k}`, text: 'hi chat', ts: 1_000_000 + k * 900 });
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('realuser'), 'user ids are hashed');
  assert.ok(!raw.includes('@someone'), 'mentions are scrubbed');
  const rows = readLog(file);
  assert.equal(rows[0].ts, 0);
  const cs = new CrowdSense();
  let i = 0;
  let snap;
  for (let t = 0; t <= 20_000; t += 250) {
    while (i < rows.length && rows[i].ts <= t) cs.ingest(rows[i++]);
    snap = cs.tick(t);
  }
  assert.equal(snap.decide.state, 'VOICE');
  assert.equal(snap.decide.option, 'left');
});

test('anonymizer is stable with a salt and unlinkable without it', () => {
  const a = makeAnonymizer('salt-aaaaaaaa');
  assert.equal(a('123'), a('123'));
  assert.notEqual(a('123'), makeAnonymizer('salt-bbbbbbbb')('123'));
  assert.match(a('123'), /^v_[0-9a-f]{12}$/);
  assert.equal(scrubText('hey @bob go left'), 'hey @user go left');
});

test('live chat parser reads stable ids and only real fields', () => {
  const line = '@badge-info=;badges=;color=#FF0000;display-name=Some_User;emotes=;first-msg=1;id=abc;mod=0;returning-chatter=0;room-id=1;subscriber=0;tmi-sent-ts=1700000000000;turbo=0;user-id=424242;user-type= :some_user!some_user@some_user.tmi.twitch.tv PRIVMSG #chan :left is safer';
  const m = parseIrcLine(line);
  assert.equal(m.type, 'privmsg');
  assert.equal(m.userId, '424242');
  assert.equal(m.text, 'left is safer');
  assert.equal(m.firstMsg, true);
  assert.equal(m.ts, 1700000000000);
  assert.equal(m.channel, 'chan');
  assert.deepEqual(parseIrcLine('PING :tmi.twitch.tv'), { type: 'ping', payload: ':tmi.twitch.tv' });
  const noFirst = parseIrcLine(':u!u@u.tmi.twitch.tv PRIVMSG #chan :hi');
  assert.equal(noFirst.firstMsg, null, 'missing field stays unknown, never guessed');
});

test('UI: every overlay state renders the required words', () => {
  const cases = [
    [{ kind: 'FORMING', option: 'LEFT' }, 'CROWD VOICE FORMING'],
    [{ kind: 'VOICE', label: 'GO LEFT', share: 0.71, viewers: 63 }, 'THE CROWD'],
    [{ kind: 'VOICE', label: 'GO LEFT', share: 0.71, viewers: 63 }, '71%'],
    [{ kind: 'DIVIDED', options: [{ label: 'LEFT', share: 0.51 }, { label: 'RIGHT', share: 0.49 }] }, 'CHAT IS DIVIDED'],
    [{ kind: 'CONFUSED', label: 'Giveaway', viewers: 41 }, 'CHAT NEEDS HELP'],
    [{ kind: 'HEARD', label: 'Giveaway' }, '✓ YOU WERE HEARD'],
    [{ kind: 'RESOLVED', label: 'Giveaway', dropPct: 64, signalKind: 'CONFUSED' }, '↓ 64%'],
    [{ kind: 'REQUEST', label: 'REMATCH', viewers: 20 }, 'CHAT WANTS'],
    [{ kind: 'HYPE' }, 'CHAT JUST EXPLODED'],
    [{ kind: 'MIND_CHANGED', from: 'LEFT', to: 'RIGHT', fromShare: 0.7, toShare: 0.68 }, 'CHAT CHANGED ITS MIND'],
    [{ kind: 'PAUSED', option: 'RIGHT' }, 'Unusual activity detected'],
  ];
  for (const [o, text] of cases) assert.ok(cardHTML(o).includes(text), `${o.kind} -> ${text}`);
  assert.equal(cardHTML(null), '', 'empty overlay when nothing meaningful happens');
  assert.ok(!cardHTML({ kind: 'CONFUSED', label: '<img src=x>', viewers: 3 }).includes('<img'), 'escapes chat-derived text');
});

test('UI state transitions: HEARD hides the acknowledged voice until chat changes', () => {
  const cs = new CrowdSense();
  const v = ['left', 'go left', 'left is safer', 'take the left route'];
  let t = 0;
  for (let k = 0; k < 20; k++) cs.ingest({ userId: `L${k}`, text: v[k % 4], ts: 300 * k });
  for (; t <= 14_000; t += 250) cs.tick(t);
  assert.equal(cs.tick(t).overlay.kind, 'VOICE');
  cs.markHeard('decide', t);
  assert.equal(cs.tick(t + 250).overlay.kind, 'HEARD');
  assert.equal(cs.tick(t + 4000).overlay, null, 'after the HEARD flash the overlay is empty again');
  cs.dismiss('decide', t + 4000);
  assert.equal(cs.tick(t + 4500).overlay, null);
});

test('no secrets or credential names in browser code', () => {
  for (const f of readdirSync(new URL('../public/', import.meta.url))) {
    const s = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(!/OAUTH|TWITCH_|PANEL_TOKEN|LOG_SALT/.test(s), f);
  }
});

test('server: lab mode accepts typed messages; control API honours PANEL_TOKEN', async () => {
  const port = 17000 + Math.floor(Math.random() * 2000);
  const proc = spawn(process.execPath, ['src/server.js', '--mode=lab'], { env: { ...process.env, PORT: String(port), PANEL_TOKEN: 'tok123', RECORD_LOGS: '0' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 40; i++) {
      try { await fetch(base + '/api/state'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/api/message', { name: 'ana', text: 'go left' })).status, 401);
    const ok = await post('/api/message', { name: 'ana', text: 'go left' }, { 'x-panel-token': 'tok123' });
    assert.equal(ok.status, 200);
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.status.mode, 'lab');
    assert.equal(state.status.simulated, false);
    assert.equal((await fetch(base + '/overlay')).status, 200);
    for (const path of ['//', '/.env', '/.env.example', '/src/server.js']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/api/state')).status, 200, 'invalid static requests do not crash the server');
  } finally {
    proc.kill();
  }
});
