export function runScenario(system,scenario,{tickMs=500,onTick=null}={}){
  const msgs=scenario.messages;const actions=[...(scenario.actions||[])].sort((a,b)=>a.ts-b.ts);const timeline=[];let mi=0,ai=0;
  for(let t=0;t<=scenario.duration;t+=tickMs){
    while(mi<msgs.length&&msgs[mi].ts<=t)system.ingest(msgs[mi++]);
    while(ai<actions.length&&actions[ai].ts<=t){const a=actions[ai++];if(a.type==='heard'&&system.engine)system.engine.markHeard(a.key,t);}
    const out=system.tick(t);timeline.push({t,...out});if(onTick)onTick(t,out,system);
  }
  return timeline;
}
function phaseAt(s,t){return s.phases.find((p)=>t>=p.from&&t<p.to)||null;}
function correct(out,expect){
  if(!out)return false;
  switch(expect.kind){case'VOICE':return out.kind==='VOICE'&&out.option===expect.option;case'DIVIDED':return out.kind==='DIVIDED';case'NONE':return out.kind==='NONE';case'NOT':return !(out.kind==='VOICE'&&out.option===expect.option);default:return false;}
}
function wrongVoice(out,expect){
  if(out.kind!=='VOICE')return false;if(!expect)return true;
  if(expect.kind==='VOICE')return out.option!==expect.option;
  if(expect.kind==='NOT')return out.option===expect.option;
  return true;
}
export function scoreDecision(scenario,timeline){
  const res={checkpoints:0,correct:0,falseVoices:0,latencies:[],missed:0};let prevKey=null;
  for(const row of timeline){const p=phaseAt(scenario,row.t);const key=row.kind==='VOICE'?'VOICE:'+row.option:row.kind;if(key!==prevKey&&wrongVoice(row,p?.expect))res.falseVoices++;prevKey=key;}
  for(const p of scenario.phases){
    const at=timeline.find((r)=>r.t>=p.checkAt);res.checkpoints++;if(correct(at,p.expect))res.correct++;
    if(p.expect.kind==='VOICE'&&p.truthAt!=null){const hit=timeline.find((r)=>r.t>=p.from&&r.t<p.to&&r.kind==='VOICE'&&r.option===p.expect.option);if(hit)res.latencies.push(Math.max(0,hit.t-p.truthAt));else res.missed++;}
  }
  return res;
}
