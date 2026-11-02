// CrowdSense server: one engine, several input paths, one overlay.
//
//   npm run demo                 offline demo (simulated chat, no credentials)
//   npm start                    live chat from TWITCH_CHANNEL
//   npm run lab                  local test room: real people type in a browser
//   npm run replay -- file.jsonl replay a recorded (anonymized) chat log
//
// Pages:   /            demo / control view
//          /overlay     viewer overlay (browser source, transparent)
//          /panel       streamer panel
//          /lab         typing page for human stress tests (lab mode only)
//
// Security: binds to 127.0.0.1 by default; credentials are read from the
// environment and never sent to any page. If PANEL_TOKEN is set, the control
// API requires it.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, sep, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrowdSense } from './engine/engine.js';
import { buildDemo } from './sim/demo-script.js';
import { DemoRunner } from './sim/demo-runner.js';
import { TwitchChat } from './live/twitch.js';
import { ChatLogger, makeAnonymizer, readLog } from './live/privacy.js';
import { loadEnv } from './env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(join(root, '.env'));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : ['file', a];
}));
const MODE = args.mode || 'demo';
const PORT = Number(process.env.PORT || 7070);
const HOST = process.env.HOST || '127.0.0.1';
const PANEL_TOKEN = process.env.PANEL_TOKEN || '';
const TICK_MS = 250;

// ------------------------------------------------------------------ state
let engine = new CrowdSense();
let demo = null;
let demoStart = 0;
let replay = null;
let lastSnap = null;
let status = { mode: MODE, source: '', connected: false, simulated: MODE === 'demo' || MODE === 'replay' };
const clients = new Set();
const anonymize = makeAnonymizer();
const logger = process.env.RECORD_LOGS === '1'
  ? new ChatLogger(join(root, 'data/logs', `${MODE}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`), anonymize)
  : null;

function now() {
  if (MODE === 'demo' || MODE === 'replay') return Date.now() - demoStart;
  return Date.now();
}

function broadcast(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(line);
}

function ingest(m, { show = true } = {}) {
  engine.ingest(m);
  if (logger && MODE !== 'demo') logger.log(m);
  // Local control view shows live Twitch display names so judges can verify
  // separate real accounts. The overlay remains aggregate-only.
  if (show) broadcast('chat', { text: String(m.text).slice(0, 120), who: m.label || anonymize(m.userId).slice(2, 6), simulated: status.simulated, spam: /spam/.test(m.userId) });
}

// ------------------------------------------------------------------ modes
function startDemo() {
  const script = buildDemo(Number(process.env.DEMO_SEED || 7));
  demo = new DemoRunner(script);
  engine = demo.engine;
  demoStart = Date.now();
  status = { ...status, source: 'Simulated chat (offline demo)', connected: true, simulated: true, duration: script.duration };
  broadcast('reset', {});
}

function startReplay(file) {
  if (!file || !existsSync(file)) {
    console.error('Replay mode needs a log file: npm run replay -- data/logs/example.jsonl');
    process.exit(1);
  }
  replay = { rows: readLog(file), i: 0, speed: Number(args.speed || 1) };
  engine = new CrowdSense();
  demoStart = Date.now();
  status = { ...status, source: `Replay of ${file} (recorded chat)`, connected: true, simulated: false, replay: true };
}

function startLive() {
  const channel = process.env.TWITCH_CHANNEL;
  if (!channel) {
    console.error('Live mode needs TWITCH_CHANNEL in .env (see .env.example). For an offline demo run: npm run demo');
    process.exit(1);
  }
  const chat = new TwitchChat({ channel, username: process.env.TWITCH_USERNAME, token: process.env.TWITCH_OAUTH_TOKEN, url: process.env.TWITCH_IRC_URL /* tests only */ });
  chat.on('message', (m) => ingest({ userId: m.userId, text: m.text, ts: Date.now(), firstMsg: m.firstMsg, label: m.displayName }, { show: true }));
  chat.on('status', (s) => {
    if (s.connected !== undefined) status = { ...status, connected: s.connected, source: `Live chat: #${channel}` };
    console.log('[live]', JSON.stringify(s));
  });
  chat.connect();
  status = { ...status, source: `Live chat: #${channel}`, simulated: false };
}

function tick() {
  const t = now();
  let counter = null;
  if (demo) {
    const r = demo.advance(t, {
      onMessage: (m) => broadcast('chat', { text: m.text, who: m.userId.replace('sim_', ''), simulated: true, spam: m.userId.includes('spam') }),
      onAction: (a) => broadcast('action', a),
      onCaption: (c) => broadcast('caption', c),
    });
    lastSnap = r.snap;
    counter = r.counterView;
    if (demo.ended && t > demo.script.duration + 20_000) startDemo(); // loop
  } else {
    if (replay) {
      const target = t * replay.speed;
      while (replay.i < replay.rows.length && replay.rows[replay.i].ts <= target) {
        const row = replay.rows[replay.i++];
        ingest({ ...row, ts: t });
      }
    }
    lastSnap = engine.tick(t);
  }
  broadcast('state', { ...publicSnap(lastSnap), counter, status, demoT: demo ? t : null });
}

function publicSnap(s) {
  // Aggregates only — no user ids leave the engine.
  return { ts: s.ts, room: s.room, minVoices: s.minVoices, decide: s.decide, signals: s.signals, overlay: s.overlay, events: s.events, moments: s.moments, context: s.context };
}

// ------------------------------------------------------------------- http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = { '/': 'index.html', '/overlay': 'overlay.html', '/panel': 'panel.html', '/lab': 'lab.html' };

function authorized(req, url) {
  if (!PANEL_TOKEN) return true;
  return req.headers['x-panel-token'] === PANEL_TOKEN || url.searchParams.get('token') === PANEL_TOKEN;
}

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url.startsWith('/') ? 'http://x' + req.url : req.url);
  } catch {
    return json(res, 400, { error: 'invalid request URL' });
  }
  const p = url.pathname;

  if (p === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ mode: MODE, status })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/state') return json(res, 200, { ...publicSnap(lastSnap || engine.tick(now())), status });
  if (p === '/api/explain') return json(res, 200, engine.explain());
  if (p === '/api/results') {
    const out = {};
    for (const f of ['eval-results.json', 'test-summary.json']) {
      const fp = join(root, 'results', f);
      if (existsSync(fp)) out[f.replace('.json', '')] = JSON.parse(readFileSync(fp, 'utf8'));
    }
    return json(res, 200, out);
  }
  if (req.method === 'POST' && p.startsWith('/api/')) {
    if (!authorized(req, url)) return json(res, 401, { error: 'panel token required' });
    const b = await body(req);
    const t = now();
    if (p === '/api/heard') return json(res, 200, { ok: !!engine.markHeard(b.key || undefined, t) });
    if (p === '/api/dismiss') return json(res, 200, { ok: !!engine.dismiss(b.key || undefined, t) });
    if (p === '/api/context') { engine.setContext(String(b.hint || '').slice(0, 120), t); return json(res, 200, { ok: true }); }
    if (p === '/api/demo/restart' && MODE === 'demo') { startDemo(); return json(res, 200, { ok: true }); }
    if (p === '/api/message' && MODE === 'lab') {
      const name = String(b.name || '').trim().slice(0, 32);
      const text = String(b.text || '').trim().slice(0, 300);
      if (!name || !text) return json(res, 400, { error: 'name and text required' });
      ingest({ userId: 'lab:' + name.toLowerCase(), text, ts: t, label: anonymize('lab:' + name.toLowerCase()).slice(2, 6) });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'unknown endpoint' });
  }

  const file = PAGES[p] || p.slice(1);
  const fp = normPath(join(root, 'public', file));
  if (!fp.startsWith(join(root, 'public') + sep) || !existsSync(fp) || !statSync(fp).isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  if (p === '/lab' && MODE !== 'lab') {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('The typing lab is only available in lab mode: npm run lab');
  }
  res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(fp));
});

if (MODE === 'demo') startDemo();
else if (MODE === 'replay') startReplay(args.file);
else if (MODE === 'live') startLive();
else if (MODE === 'lab') status = { ...status, source: 'Local test room (people typing in /lab)', connected: true, simulated: false };
else { console.error(`Unknown mode: ${MODE}`); process.exit(1); }

setInterval(tick, TICK_MS);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15_000);
server.listen(PORT, HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\nCrowdSense — ${status.source || MODE}`);
  console.log(`  Demo / control view : ${base}/`);
  console.log(`  Viewer overlay      : ${base}/overlay   (add as a browser source, 1920×1080)`);
  console.log(`  Streamer panel      : ${base}/panel`);
  if (MODE === 'lab') console.log(`  Typing lab          : ${base}/lab`);
  if (logger) console.log(`  Recording anonymized log to ${logger.file}`);
  console.log('');
});
