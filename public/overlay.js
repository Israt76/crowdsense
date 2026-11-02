const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(x)=>`${Math.round((x||0)*100)}%`;

export function cardHTML(o){
 if(!o)return'';
 switch(o.kind){
  case'FORMING':return `<div class="cs-forming">CROWD VOICE FORMING… <span>${esc(o.option)}?</span></div>`;
  case'VOICE':return `<div class="cs-card cs-voice"><div class="cs-kicker">THE CROWD</div><div class="cs-big">${esc(o.label)}</div><div class="cs-meta"><b>${pct(o.share)}</b> · <b>${o.viewers}</b> viewers</div></div>`;
  case'DIVIDED':return `<div class="cs-card"><div class="cs-mid">CHAT IS DIVIDED</div><div class="cs-split">${(o.options||[]).map(x=>`<div><b>${esc(x.label)}</b> ${pct(x.share)}</div>`).join('')}</div></div>`;
  case'CONFUSED':return `<div class="cs-card cs-help"><div class="cs-mid">CHAT NEEDS HELP</div><div class="cs-meta"><b>${esc(o.label)}</b> · ${o.viewers} viewers</div></div>`;
  case'REQUEST':return `<div class="cs-card cs-want"><div class="cs-kicker">CHAT WANTS</div><div class="cs-big">${esc(o.label)}</div><div class="cs-meta">${o.viewers} viewers</div></div>`;
  case'HEARD':return `<div class="cs-card cs-heard"><div class="cs-mid">✓ YOU WERE HEARD</div><div class="cs-meta">${esc(o.label)}</div></div>`;
  case'RESOLVED':return `<div class="cs-card cs-heard"><div class="cs-mid">RESOLVED</div><div class="cs-meta">${esc(o.label)} — confusion <b>↓ ${o.dropPct}%</b></div></div>`;
  case'NOT_RESOLVED':return `<div class="cs-card cs-help"><div class="cs-mid">STILL CONFUSED</div><div class="cs-meta">${esc(o.label)}</div></div>`;
  case'MIND_CHANGED':return `<div class="cs-card cs-voice"><div class="cs-kicker">CHAT CHANGED ITS MIND</div><div class="cs-mid">${esc(o.from)} → ${esc(o.to)}</div></div>`;
  case'HYPE':return `<div class="cs-card cs-hype"><div class="cs-big">CHAT JUST EXPLODED</div></div>`;
  case'PAUSED':return `<div class="cs-card cs-warn"><div class="cs-mid">Crowd Voice paused</div><div class="cs-meta">Unusual activity detected</div></div>`;
  default:return'';
 }
}
export class Overlay{
 constructor(stage){this.stage=stage;stage.classList.add('cs-stage');this.slot=document.createElement('div');this.slot.className='cs-slot';stage.appendChild(this.slot);this.key=null;}
 update(snap){const o=snap.overlay;const key=o?o.kind+'|'+(o.label||o.option||''):'EMPTY';if(key!==this.key){this.key=key;this.slot.innerHTML=cardHTML(o);}else if(o)this.slot.innerHTML=cardHTML(o);}
}
