// Live chat input: Twitch chat over the IRC WebSocket interface.
import { EventEmitter } from 'node:events';

const URL = 'wss://irc-ws.chat.twitch.tv:443';

export function parseTags(raw) {
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    out[k] = v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
  }
  return out;
}

export function parseIrcLine(line) {
  if (!line) return null;
  let rest = line;
  let tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  if (rest.startsWith('PING')) return { type: 'ping', payload: rest.slice(5) };
  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const trail = rest.indexOf(' :');
  const params = (trail >= 0 ? rest.slice(0, trail) : rest).split(' ');
  const trailing = trail >= 0 ? rest.slice(trail + 2) : '';
  const command = params[0];
  if (command !== 'PRIVMSG') return { type: 'other', command, params, trailing };
  const login = prefix.split('!')[0];
  let text = trailing;
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1];
  return {
    type: 'privmsg',
    channel: (params[1] || '').replace(/^#/, ''),
    userId: tags['user-id'] || `login:${login}`,
    displayName: tags['display-name'] || login,
    text,
    ts: Number(tags['tmi-sent-ts']) || Date.now(),
    firstMsg: tags['first-msg'] === undefined ? null : tags['first-msg'] === '1',
  };
}

export class TwitchChat extends EventEmitter {
  constructor(opts) {
    super();
    if (!opts.channel) throw new Error('TWITCH_CHANNEL is required for live mode');
    this.channel = opts.channel.toLowerCase().replace(/^#/, '');
    this.username = opts.username;
    this.token = opts.token;
    this.WS = opts.WebSocketImpl || globalThis.WebSocket;
    this.url = opts.url || URL;
    this.backoff = 1000;
    this.closed = false;
  }

  connect() {
    if (!this.WS) throw new Error('No WebSocket implementation available (Node >= 22 required)');
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (this.username && this.token) {
        const tok = this.token.startsWith('oauth:') ? this.token : `oauth:${this.token}`;
        ws.send(`PASS ${tok}`);
        ws.send(`NICK ${this.username.toLowerCase()}`);
      } else {
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      }
      ws.send(`JOIN #${this.channel}`);
      this.backoff = 1000;
      this.emit('status', { connected: true, channel: this.channel, anonymous: !(this.username && this.token) });
    });
    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      for (const line of data.split('\r\n')) {
        const m = parseIrcLine(line);
        if (!m) continue;
        if (m.type === 'ping') ws.send(`PONG ${m.payload}`);
        else if (m.type === 'privmsg') this.emit('message', m);
        else if (m.type === 'other' && m.command === 'NOTICE') this.emit('status', { notice: m.trailing });
        else if (m.type === 'other' && m.command === 'RECONNECT') ws.close();
        else if (m.type === 'other' && m.command === 'JOIN') this.emit('status', { joined: true, channel: this.channel });
      }
    });
    ws.addEventListener('close', () => {
      this.emit('status', { connected: false });
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
    ws.addEventListener('error', (e) => this.emit('status', { error: String(e?.message || 'websocket error') }));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
