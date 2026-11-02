const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=new URLSearchParams(location.search).get('token');
async function post(path,body={}){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-panel-token':token}:{})},body:JSON.stringify(body)});return r.json();}
const DESCRIBE={VOICE:o=>`The crowd says ${o.label}`,DIVIDED:()=> 'Chat is divided',CONFUSED:o=>`Chat needs help: ${o.label}`,REQUEST:o=>`Chat wants: ${o.label}`,PAUSED:()=> 'Crowd Voice paused — unusual activity'};

export function mountPanel(root){
 root.innerHTML=`<div class="p-now"><div class="p-label">On the overlay now</div><div class="p-focus" id="p-focus">Nothing — chat is just chatting.</div><div class="p-actions"><button id="p-heard" class="p-primary" disabled>Heard</button><button id="p-dismiss" disabled>Dismiss</button></div></div><form class="p-context" id="p-context"><label for="p-hint" class="p-label">Context hint <span class="p-opt">optional</span></label><div class="p-row"><input id="p-hint" placeholder="fork: left door / right door" maxlength="120" autocomplete="off"><button>Set</button></div><div class="p-current" id="p-current"></div></form><details class="p-why" id="p-why"><summary>Why am I seeing this?</summary><div id="p-why-body" class="p-why-body">Open while something is on the overlay.</div></details><div><div class="p-label">Recent crowd moments</div><ol class="p-moments" id="p-moments"><li class="p-empty">No moments yet.</li></ol></div>`;
 const $=(id)=>root.querySelector('#'+id);let focus=null;
 $('p-heard').onclick=()=>focus&&post('/api/heard',{key:focus});
 $('p-dismiss').onclick=()=>focus&&post('/api/dismiss',{key:focus});
 $('p-context').onsubmit=(e)=>{e.preventDefault();post('/api/context',{hint:$('p-hint').value});$('p-hint').value='';};
 async function refreshWhy(){
  if(!$('p-why').open)return;const x=await(await fetch('/api/explain')).json();const parts=[];const d=x.decide;
  if(d&&d.uniqueViewers){parts.push(`<p><b>${d.uniqueViewers}</b> different viewers lean <b>${esc(d.option)}</b> (${Math.round(d.share*100)}% of ${d.participants} people taking part, room of ${x.room}).</p>`);if(d.meanings?.length)parts.push(`<p>${d.meanings.map(m=>`<span class="p-chip">${esc(m.text)} ×${m.count}</span>`).join(' ')}</p>`);if(d.reasons?.length)parts.push(`<p class="p-warn">${d.reasons.map(esc).join('; ')}</p>`);}
  for(const s of x.signals||[])parts.push(`<p><b>${s.uniqueViewers}</b> viewers ${s.kind==='CONFUSED'?'are confused':'are asking'}${s.topics?.length?` about <b>${esc(s.topics.join(', '))}</b>`:''}.</p>`);
  $('p-why-body').innerHTML=parts.join('')||'Nothing is being signalled right now.';
 }
 $('p-why').addEventListener('toggle',refreshWhy);setInterval(refreshWhy,1000);
 return{update(snap){const o=snap.overlay;const target=o&&DESCRIBE[o.kind]?o:null;focus=target?.signal||null;$('p-focus').textContent=target?DESCRIBE[o.kind](o):o?o.kind.replace('_',' '):'Nothing — chat is just chatting.';$('p-heard').disabled=!focus||o?.kind==='PAUSED'||o?.kind==='DIVIDED';$('p-dismiss').disabled=!focus;$('p-current').textContent=snap.context?`Current: ${snap.context}`:'No hint — options come from chat.';const m=snap.moments||[];$('p-moments').innerHTML=m.length?m.map(x=>`<li><span class="p-t">${fmt(x.at,snap)}</span>${esc(x.text)}</li>`).join(''):'<li class="p-empty">No moments yet.</li>';}};}
function fmt(at,snap){if(snap.status?.simulated||snap.status?.replay)return`${(at/1000).toFixed(0)}s`;return new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
