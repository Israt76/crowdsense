// Offline demo script. Simulated viewers are clearly labelled and every state
// is computed live by the real CrowdSense engine.
import * as P from './phrases.js';

function rng(seed=1){
  let x=seed>>>0;
  return ()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};
}

export function buildDemo(seed=7){
  const r=rng(seed);
  const pick=(a)=>a[Math.floor(r()*a.length)];
  const ev=[];
  const msg=(ts,userId,text,firstMsg=null)=>ev.push({ts:Math.round(ts),kind:'msg',userId,text,firstMsg});
  const action=(ts,a)=>ev.push({ts,kind:'action',...a});
  const caption=(ts,scene,text)=>ev.push({ts,kind:'caption',scene,text});
  const pool=Array.from({length:110},(_,i)=>`sim_${String(i).padStart(3,'0')}`);
  const shuffled=()=>[...pool].sort(()=>r()-0.5);

  for(const u of pool){let t=r()*8_000;while(t<100_000){msg(t,u,pick(P.CHATTER));t+=20_000+r()*15_000;}}
  caption(0,1,'Normal chat. Lots of people talking. The overlay stays empty.');

  caption(5_000,2,'Viewers start saying the same thing in different words…');
  let s=shuffled();
  for(const u of s.slice(0,32))msg(5_000+r()*8_000,u,r()<0.3?pick(P.OPPOSE_RIGHT):pick(P.SUPPORT_LEFT));
  for(const u of s.slice(32,37))msg(6_000+r()*8_000,u,pick(P.SUPPORT_RIGHT));
  caption(13_500,2,'Messy chat converges into one Crowd Voice.');
  action(19_000,{action:'heard',key:'decide'});
  caption(19_000,2,'The streamer follows the crowd and presses HEARD.');

  action(22_000,{action:'context',hint:'fork: left door / right door'});
  caption(22_000,3,'New fork. Three accounts start flooding "RIGHT"…');
  s=shuffled();
  const spam=['sim_spam_1','sim_spam_2','sim_spam_3'];
  for(const u of spam)for(let k=0;k<30;k++)msg(23_000+r()*15_000,u,k%4===0?'RIGHT DOOR':'RIGHT');
  for(const u of s.slice(0,34)){const x=r();msg(23_000+r()*9_000,u,x<0.2?pick(P.HINT_LEFT):x<0.55?pick(P.OPPOSE_RIGHT):pick(P.SUPPORT_LEFT));}
  for(const u of s.slice(34,38))msg(24_000+r()*9_000,u,pick(P.SUPPORT_RIGHT));
  caption(31_000,3,'A message counter says RIGHT. CrowdSense counts people: one viewer, one voice.');

  action(40_000,{action:'context',hint:''});
  caption(40_000,4,'Next choice. This time chat is genuinely split…');
  s=shuffled();
  const bridge=['bridge','take the bridge','BRIDGE','go bridge','cave is a trap','bridge!!','bridge for sure'];
  const cave=['cave','go cave','CAVE','take the cave','bridge is a trap','cave!!','cave easy'];
  for(const u of s.slice(0,24))msg(41_000+r()*7_000,u,pick(bridge));
  for(const u of s.slice(24,47))msg(41_000+r()*7_000,u,pick(cave));
  caption(48_000,4,'CrowdSense does not invent a winner.');

  action(52_000,{action:'context',hint:''});
  caption(52_000,5,'Someone mentions a giveaway. Confusion spreads…');
  s=shuffled();const confused=s.slice(0,30);
  for(const u of confused)msg(52_000+r()*6_000,u,pick(P.CONFUSED_GIVEAWAY));
  action(62_000,{action:'heard',key:'confused'});
  caption(62_000,5,'The streamer explains the giveaway and presses HEARD. CrowdSense keeps measuring.');
  for(const u of confused.slice(0,12))msg(63_500+r()*6_000,u,pick(P.THANKS_AFTER));
  for(const u of confused.slice(12,14))msg(68_000+r()*14_000,u,pick(P.CONFUSED_GIVEAWAY));

  action(64_500,{action:'context',hint:'fork: left / right'});
  caption(65_000,6,'Meanwhile, a quick new choice…');
  s=shuffled().filter((u)=>!confused.slice(0,14).includes(u));const mc=s.slice(0,30);
  for(const u of mc)msg(65_000+r()*5_000,u,pick(P.SUPPORT_LEFT));
  for(const u of mc.slice(0,27))msg(73_000+r()*4_000,u,(r()<0.5?'actually ':'wait no ')+pick(['right','RIGHT','go right','right is safer']));
  caption(77_000,6,'…and chat changes its mind.');
  action(84_500,{action:'heard',key:'decide'});

  caption(87_000,7,'Round over. Chat asks for more — in many different words.');
  s=shuffled();for(const u of s.slice(0,26))msg(87_000+r()*4_500,u,pick(P.REMATCH));
  action(96_500,{action:'heard',key:'request:rematch'});

  caption(98_000,8,'And when something amazing happens…');
  s=shuffled();for(const u of s.slice(0,30))msg(98_500+r()*2_500,u,pick(P.HYPE));

  action(104_000,{action:'end'});
  caption(104_000,9,'No commands. No polls. Just people talking — and finally being heard.');
  ev.sort((a,b)=>a.ts-b.ts||(a.kind==='action'?-1:1));
  return {events:ev,duration:104_000};
}
