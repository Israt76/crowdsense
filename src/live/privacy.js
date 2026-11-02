import { createHmac, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeAnonymizer(salt = process.env.LOG_SALT) {
  const key = salt && salt.length >= 8 ? salt : randomBytes(16).toString('hex');
  return (userId) => 'v_' + createHmac('sha256', key).update(String(userId)).digest('hex').slice(0, 12);
}

export function scrubText(text) {
  return String(text).replace(/@\w+/g, '@user').slice(0, 300);
}

export class ChatLogger {
  constructor(file, anonymize = makeAnonymizer()) {
    this.file = file;
    this.anonymize = anonymize;
    this.t0 = null;
    mkdirSync(dirname(file), { recursive: true });
  }
  log({ userId, text, ts, firstMsg = null }) {
    if (this.t0 == null) this.t0 = ts;
    const row = { ts: ts - this.t0, user: this.anonymize(userId), text: scrubText(text), firstMsg };
    appendFileSync(this.file, JSON.stringify(row) + '\n');
  }
}

export function readLog(file) {
  const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const t0 = rows.length ? rows[0].ts : 0;
  return rows
    .map((r) => ({ userId: String(r.userId ?? r.user), text: String(r.text), ts: r.ts - t0, firstMsg: r.firstMsg ?? null }))
    .sort((a, b) => a.ts - b.ts);
}
