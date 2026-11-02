// Minimal WebSocket + IRC server that behaves like the live chat endpoint,
// so the real client, server and engine can be tested end-to-end offline.
import http from 'node:http';
import { createHash } from 'node:crypto';

function frame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, len >> 8, len & 255]);
  return Buffer.concat([head, payload]);
}

function* readFrames(buf) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const opcode = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) { len = buf.readUInt16BE(p); p += 2; }
    const mask = buf.subarray(p, p + 4);
    p += 4;
    if (p + len > buf.length) return;
    const data = Buffer.from(buf.subarray(p, p + len)).map((b, i) => b ^ mask[i % 4]);
    off = p + len;
    yield { opcode, text: data.toString() };
  }
}

/**
 * @param {(conn:{send:(line:string)=>void, close:()=>void, received:string[], index:number})=>void} onJoin
 */
export function startFakeIrc(onJoin) {
  const received = [];
  let connections = 0;
  const sockets = new Set();
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    const index = connections++;
    const conn = {
      index,
      received,
      send: (line) => socket.writable && socket.write(frame(line + '\r\n')),
      close: () => socket.end(Buffer.from([0x88, 0])),
    };
    socket.on('data', (buf) => {
      for (const f of readFrames(buf)) {
        if (f.opcode === 8) { socket.end(); return; }
        for (const line of f.text.split('\r\n').filter(Boolean)) {
          received.push(line);
          const j = /^JOIN #(\w+)/.exec(line);
          if (j) {
            conn.send(`:justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #${j[1]}`);
            onJoin(conn, j[1]);
          }
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `ws://127.0.0.1:${server.address().port}`,
    received,
    connections: () => connections,
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  })));
}

/** A chat line in the exact live format, with real tag fields. */
export function privmsg(channel, userId, text, ts, firstMsg = false) {
  return `@badge-info=;badges=;color=;display-name=User${userId};emotes=;first-msg=${firstMsg ? 1 : 0};flags=;id=x${userId}${ts};mod=0;returning-chatter=0;room-id=1;subscriber=0;tmi-sent-ts=${ts};turbo=0;user-id=${userId};user-type= :user${userId}!user${userId}@user${userId}.tmi.twitch.tv PRIVMSG #${channel} :${text}`;
}
