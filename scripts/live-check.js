import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import { TwitchChat } from '../src/live/twitch.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
loadEnv(join(root,'.env'));
const channel=(process.argv[2]||process.env.TWITCH_CHANNEL||'').replace(/^#/,'');
if(!channel){console.error('Set TWITCH_CHANNEL in .env or pass a channel name.');process.exit(1);}
let messages=0;const viewers=new Set();let connected=false;
const chat=new TwitchChat({channel,username:process.env.TWITCH_USERNAME,token:process.env.TWITCH_OAUTH_TOKEN});
chat.on('status',s=>{if(s.connected){connected=true;console.log(`Connected to #${channel} (${s.anonymous?'anonymous':'authenticated'})`);}if(s.notice)console.log('NOTICE:',s.notice);});
chat.on('message',m=>{messages++;viewers.add(m.userId);if(messages<=8)console.log(`[${m.displayName}] ${m.text}`);});
chat.connect();
setTimeout(()=>{chat.close();console.log(`Messages: ${messages}; unique chatters: ${viewers.size}`);if(!connected){console.error('FAIL: connection did not open');process.exit(1);}console.log(messages?'PASS: live Twitch messages arrived':'PASS: connected (channel was quiet during check)');process.exit(0);},60_000);
