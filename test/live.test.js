// End-to-end tests of the live chat path against a local fake chat server.
// Everything is real (WebSocket client, IRC handshake, PING/PONG, parsing,
// reconnect, server live mode, engine) except the remote host itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { TwitchChat } from '../src/live/twitch.js';
import { CrowdSense } from '../src/engine/engine.js';
import { startFakeIrc, privmsg } from './fake-irc-server.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LEFT = ['left', 'go left', 'left looks safer', "don't go right", 'take the left route', 'right is a trap'];

test('live client: closing during reconnect backoff cancels the retry', async () => {
  class Socket extends EventTarget {
    static instances = [];
    constructor() { super(); Socket.instances.push(this); }
    close() { this.dispatchEvent(new Event('close')); }
  }
  const chat = new TwitchChat({ channel: 'testchan', WebSocketImpl: Socket });
  chat.backoff = 10;
  chat.connect();
  Socket.instances[0].close();
  chat.close();
  await wait(30);
  assert.equal(Socket.instances.length, 1, 'no socket is created after shutdown');
});

test('live client: handshake, PING/PONG, tags, engine, reconnect', async () => {
  const fake = await startFakeIrc((conn, ch) => {
    conn.send('PING :tmi.twitch.tv');
    const base = 1_700_000_000_000 + conn.index * 60_000;
    for (let k = 0; k < 20; k++) conn.send(privmsg(ch, 100 + k + conn.index * 1000, LEFT[k % LEFT.length], base + k * 400, k % 5 === 0));
    if (conn.index === 0) setTimeout(() => conn.close(), 150); // server drops us once
  });
  const chat = new TwitchChat({ channel: 'TestChan', url: fake.url });
  const msgs = [];
  chat.on('message', (m) => msgs.push(m));
  chat.connect();
  for (let i = 0; i < 60 && msgs.length < 40; i++) await wait(100);
  chat.close();
  fake.close();

  const capabilities = fake.received.find((l) => l.startsWith('CAP REQ :'))?.slice(9).split(' ') || [];
  for (const capability of ['twitch.tv/tags', 'twitch.tv/commands', 'twitch.tv/membership']) {
    assert.ok(capabilities.includes(capability), `requests ${capability}`);
  }
  assert.ok(fake.received.some((l) => /^NICK justinfan\d+$/.test(l)), 'anonymous login');
  assert.ok(fake.received.includes('JOIN #testchan'), 'joins lower-cased channel');
  assert.ok(fake.received.includes('PONG :tmi.twitch.tv'), 'answers PING');
  assert.ok(fake.connections() >= 2, 'reconnects after the server drops the connection');
  assert.equal(msgs.length, 40);
  assert.equal(msgs[0].userId, '100');
  assert.equal(msgs[0].firstMsg, true);
  assert.equal(msgs[1].firstMsg, false);

  const cs = new CrowdSense();
  const t0 = msgs[0].ts;
  for (const m of msgs.slice(0, 20)) cs.ingest({ userId: m.userId, text: m.text, ts: m.ts - t0, firstMsg: m.firstMsg });
  let snap;
  for (let t = 0; t <= 20_000; t += 250) snap = cs.tick(t);
  assert.equal(snap.room, 20);
  assert.equal(snap.decide.state, 'VOICE');
  assert.equal(snap.decide.option, 'left');
});

test('npm start path: server in live mode feeds live chat into the overlay state', async () => {
  const fake = await startFakeIrc((conn, ch) => {
    let k = 0;
    const iv = setInterval(() => {
      if (k >= 24) return clearInterval(iv);
      conn.send(privmsg(ch, 500 + k, LEFT[k % LEFT.length], Date.now()));
      k++;
    }, 60);
  });
  const port = 19000 + Math.floor(Math.random() * 900);
  const proc = spawn(process.execPath, ['src/server.js', '--mode=live'], {
    env: { ...process.env, PORT: String(port), TWITCH_CHANNEL: 'testchan', TWITCH_IRC_URL: fake.url, TWITCH_OAUTH_TOKEN: '', TWITCH_USERNAME: '' },
    stdio: 'ignore',
  });
  try {
    let state = null;
    for (let i = 0; i < 100; i++) {
      await wait(150);
      try { state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); } catch { continue; }
      if (state.decide.state === 'VOICE') break;
    }
    assert.equal(state.status.mode, 'live');
    assert.equal(state.status.simulated, false, 'live viewers are never labelled simulated');
    assert.equal(state.status.connected, true);
    assert.equal(state.room, 24);
    assert.equal(state.decide.state, 'VOICE');
    assert.equal(state.overlay.label, 'GO LEFT');
    assert.ok(!JSON.stringify(state).includes('"500"'), 'no user ids in the public state');
  } finally {
    proc.kill();
    fake.close();
  }
});
