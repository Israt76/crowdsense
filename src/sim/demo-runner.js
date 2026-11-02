import { CrowdSense } from '../engine/engine.js';
import { WindowBaseline } from '../engine/baselines.js';

export class DemoRunner {
  constructor(script,{config={}}={}) {
    this.script=script; this.engine=new CrowdSense(config);
    this.counter=new WindowBaseline('keyword',{options:['left','right']});
    this.i=0; this.t=0; this.captions=[]; this.caption=null; this.ended=false;
  }
  advance(t,hooks={}) {
    const ev=this.script.events;
    while(this.i<ev.length&&ev[this.i].ts<=t){
      const e=ev[this.i++];
      if(e.kind==='msg'){this.engine.ingest(e);this.counter.ingest(e);hooks.onMessage?.(e);}
      else if(e.kind==='action'){
        if(e.action==='heard')this.engine.markHeard(e.key,e.ts);
        else if(e.action==='context'){this.engine.setContext(e.hint,e.ts);this.counter=new WindowBaseline('keyword',{options:['left','right']});}
        else if(e.action==='end')this.ended=true;
        hooks.onAction?.(e);
      } else if(e.kind==='caption'){this.caption=e;hooks.onCaption?.(e);}
    }
    this.t=t;
    const snap=this.engine.tick(t);
    return {snap,counterView:this._counterView(t)};
  }
  _counterView(t){
    const counts={left:0,right:0};
    for(const v of this.counter.votes)if(t-v.t<=60_000)counts[v.option]++;
    return counts;
  }
}

export function runDemoHeadless(script,tickMs=250){
  const d=new DemoRunner(script);const out=[];let last=null;
  for(let t=0;t<=script.duration;t+=tickMs){
    const {snap,counterView}=d.advance(t);
    const kind=snap.overlay?snap.overlay.kind:'EMPTY';
    const key=kind+(snap.overlay?.label||snap.overlay?.option||'');
    if(key!==last){out.push({t,kind,overlay:snap.overlay,counter:counterView});last=key;}
  }
  return out;
}
