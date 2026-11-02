import { CrowdSense } from '../engine/engine.js';
import { readLog } from '../live/privacy.js';

const args=process.argv.slice(2);
const file=args.find((a)=>!a.startsWith('--'));
const hint=(args.find((a)=>a.startsWith('--hint='))||'').slice(7);
if(!file){console.error('usage: npm run replay:cli -- <log.jsonl> [--hint="fork: a / b"]');process.exit(1);}
const rows=readLog(file);const cs=new CrowdSense();if(hint)cs.setContext(hint,0);
const end=(rows.at(-1)?.ts??0)+15_000;let i=0;const people=new Set(rows.map((r)=>r.userId));
console.log(`Replaying ${rows.length} messages from ${people.size} anonymized viewers (${(end/1000).toFixed(0)} s)\n`);
for(let t=0;t<=end;t+=250){
  while(i<rows.length&&rows[i].ts<=t)cs.ingest(rows[i++]);
  const snap=cs.tick(t);
  for(const e of snap.events){
    const at=`${(t/1000).toFixed(1).padStart(6)}s`;
    if(e.type==='DECIDE_STATE')console.log(at,'decision',e.state,e.label||'');
    else if(e.type==='SIGNAL')console.log(at,e.kind,e.label,`(${e.viewers} viewers)`);
    else if(e.type==='TRANSIENT')console.log(at,e.kind,e.label||e.to||'',e.dropPct!=null?`↓ ${e.dropPct}%`:'');
  }
}
console.log('\nWhy (final state):');console.log(JSON.stringify(cs.explain(),null,2));
