// Live chat check: connect to a real channel, confirm messages reach the
// CrowdSense engine, then exit with PASS or FAIL.
//
//   npm run live:check -- <channel> [--seconds=60]
//   (or set TWITCH_CHANNEL in .env and run: npm run live:check)
//
// Read-only. Uses TWITCH_USERNAME / TWITCH_OAUTH_TOKEN from .env if present,
// otherwise an anonymous login. Viewer ids are printed only as anonymous hashes.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TwitchChat } from '../src/live/twitch.js';
import { CrowdSense } from '../src/engine/engine.js';
import { makeAnonymizer } from '../src/live/privacy.js';
import { loadEnv } from '../src/env.js';

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));
const args = process.argv.slice(2);
const channel = (args.find((a) => !a.startsWith('--')) || process.env.TWITCH_CHANNEL || '').replace(/^#/, '');
const seconds = Number((args.find((a) => a.startsWith('--seconds=')) || '--seconds=60').split('=')[1]);
if (!channel) {
  console.error('Usage: npm run live:check -- <channel>   (pick a channel that is live with an active chat)');
  process.exit(1);
}

const anon = makeAnonymizer();
const engine = new CrowdSense();
const chat = new TwitchChat({ channel, username: process.env.TWITCH_USERNAME, token: process.env.TWITCH_OAUTH_TOKEN, url: process.env.TWITCH_IRC_URL /* tests only */ });
const users = new Set();
let received = 0;
let firstField = { yes: 0, no: 0, unknown: 0 };
let connected = false;
let joined = false;
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s`;

console.log(`Connecting to #${channel} (${process.env.TWITCH_OAUTH_TOKEN ? 'as ' + process.env.TWITCH_USERNAME : 'anonymous, read-only'}) for ${seconds}s…`);
chat.on('status', (s) => {
  if (s.connected === true && !connected) { connected = true; console.log(`${elapsed()} connected to chat server`); }
  if (s.joined && !joined) { joined = true; console.log(`${elapsed()} joined #${channel} — waiting for messages`); }
  if (s.notice) console.log(`${elapsed()} server notice: ${s.notice}`);
  if (s.error) console.log(`${elapsed()} connection error: ${s.error}`);
  if (s.connected === false && connected) console.log(`${elapsed()} disconnected, retrying…`);
});
chat.on('message', (m) => {
  received++;
  users.add(m.userId);
  firstField[m.firstMsg === true ? 'yes' : m.firstMsg === false ? 'no' : 'unknown']++;
  engine.ingest({ userId: m.userId, text: m.text, ts: Date.now(), firstMsg: m.firstMsg });
  if (received <= 8) console.log(`${elapsed()} [${anon(m.userId)}] ${m.text.slice(0, 80)}`);
  if (received === 8) console.log('      … (further messages counted, not printed)');
});
chat.connect();

let last = null;
const ticker = setInterval(() => { last = engine.tick(Date.now()); }, 250); // same cadence as the server
const report = setInterval(() => {
  const s = last || engine.tick(Date.now());
  console.log(`${elapsed()} messages ${received} · unique chatters ${users.size} · engine room ${s.room} · decision ${s.decide.state}${s.decide.label ? ' ' + s.decide.label : ''}${s.overlay ? ' · overlay ' + s.overlay.kind : ''}`);
}, 10_000);

setTimeout(() => {
  clearInterval(report);
  clearInterval(ticker);
  chat.close();
  const s = engine.tick(Date.now());
  console.log('\n--- live check result ---');
  console.log(`connected: ${connected ? 'yes' : 'no'} · joined: ${joined ? 'yes' : 'no'}`);
  console.log(`messages received: ${received} from ${users.size} chatters (${(received / seconds).toFixed(2)}/s)`);
  console.log(`engine active room: ${s.room} · first-msg flag present on ${firstField.yes + firstField.no}/${received} messages`);
  const pass = connected && received > 0 && s.room > 0;
  if (pass) {
    console.log('PASS — live messages reached the CrowdSense engine.');
  } else if (!connected) {
    console.log('FAIL — could not connect. Check your internet connection / firewall (port 443 to irc-ws.chat.twitch.tv).');
  } else if (!received) {
    console.log('FAIL — connected but no messages arrived. Is the channel live with active chat? Try a busier channel or a longer --seconds.');
  } else {
    console.log('FAIL — messages arrived but did not reach the engine (please report this).');
  }
  process.exit(pass ? 0 : 1);
}, seconds * 1000);
