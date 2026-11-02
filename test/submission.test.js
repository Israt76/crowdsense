import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/engine/normalize.js';
import { analyzeStance, parseHint } from '../src/engine/stance.js';
import { minVoices } from '../src/engine/thresholds.js';
import { CrowdSense, DEFAULT_CONFIG } from '../src/engine/engine.js';
import { parseIrcLine, parseTags } from '../src/live/twitch.js';

const stance=(text,options=['left','right'],hint=null)=>analyzeStance(normalize(text),{options,hint:hint?parseHint(hint):null,fuzzy:true,stance:true});
const cases=[
['normalizes lowercase',()=>assert.equal(normalize('LEFT!!').text,'left')],
['compresses elongation',()=>assert.equal(normalize('leeeeft').text,'left')],
['detects question',()=>assert.equal(normalize('left?').isQuestion,true)],
['detects shouting',()=>assert.equal(normalize('LEFT').shout,true)],
['removes mention',()=>assert.equal(normalize('@bob go left').text,'go left')],
['support left',()=>assert.equal(stance('go left').preference,'left')],
['plain left',()=>assert.equal(stance('left').preference,'left')],
['oppose right verdict',()=>assert.deepEqual(stance('right is a trap').opposed,['right'])],
['oppose right negation',()=>assert.deepEqual(stance("don't go right").opposed,['right'])],
['anything but right',()=>assert.deepEqual(stance('anything but right').opposed,['right'])],
['nothing but left',()=>assert.equal(stance('nothing but left').preference,'left')],
['comparative left over right',()=>assert.equal(stance('left > right').preference,'left')],
['question not counted',()=>assert.equal(stance('why is everyone saying left?').counted,false)],
['reported speech not support',()=>assert.equal(stance('everyone is saying left').preference,null)],
['hint parses two options',()=>assert.equal(parseHint('fork: left door / right door').options.length,2)],
['hint canonical left',()=>assert.equal(parseHint('fork: left door / right door').options[0].name,'left')],
['hint canonical right',()=>assert.equal(parseHint('fork: left door / right door').options[1].name,'right')],
['hint maps first door',()=>assert.equal(stance('first door',['left','right'],'fork: left door / right door').preference,'left')],
['threshold tiny room',()=>assert.equal(minVoices(4,DEFAULT_CONFIG),3)],
['threshold eight room',()=>assert.equal(minVoices(8,DEFAULT_CONFIG),3)],
['threshold scales',()=>assert.ok(minVoices(100,DEFAULT_CONFIG)>minVoices(20,DEFAULT_CONFIG))],
['threshold sublinear',()=>assert.ok(minVoices(400,DEFAULT_CONFIG)<40)],
['fixed threshold ablation',()=>assert.equal(minVoices(400,{...DEFAULT_CONFIG,adaptive:false}),DEFAULT_CONFIG.fixedMinVoices)],
['irc tag parser',()=>assert.equal(parseTags('display-name=Jenny;user-id=42')['user-id'],'42')],
['irc ping parser',()=>assert.equal(parseIrcLine('PING :tmi.twitch.tv').type,'ping')],
['irc privmsg parser',()=>assert.equal(parseIrcLine('@display-name=Jenny;user-id=42;tmi-sent-ts=1000 :jenny!j@j PRIVMSG #room :go left').text,'go left')],
['irc stable user id',()=>assert.equal(parseIrcLine('@display-name=Jenny;user-id=42 :jenny!j@j PRIVMSG #room :left').userId,'42')],
['irc display name',()=>assert.equal(parseIrcLine('@display-name=Jenny;user-id=42 :jenny!j@j PRIVMSG #room :left').displayName,'Jenny')],
['irc channel',()=>assert.equal(parseIrcLine('@display-name=Jenny;user-id=42 :jenny!j@j PRIVMSG #room :left').channel,'room')],
['irc first-msg true',()=>assert.equal(parseIrcLine('@display-name=Jenny;user-id=42;first-msg=1 :jenny!j@j PRIVMSG #room :left').firstMsg,true)],
['engine starts noise',()=>assert.equal(new CrowdSense().tick(0).decide.state,'NOISE')],
['one viewer one active voice',()=>{const c=new CrowdSense({stableMs:0});c.setContext('fork: left / right',0);c.ingest({userId:'a',text:'left',ts:1});c.ingest({userId:'a',text:'right',ts:2});assert.equal(c.tick(3).decide.participants,1)}],
['viewer mind change updates side',()=>{const c=new CrowdSense({stableMs:0,minFloor:1});c.setContext('fork: left / right',0);c.ingest({userId:'a',text:'left',ts:1});c.ingest({userId:'a',text:'actually right',ts:2});assert.equal(c.tick(3).decide.option,'right')}],
['three voices can form',()=>{const c=new CrowdSense({stableMs:0});c.setContext('fork: left / right',0);for(const u of ['a','b','c'])c.ingest({userId:u,text:'left',ts:1});assert.ok(['FORMING','VOICE'].includes(c.tick(2).decide.state))}],
['four left voices become voice',()=>{const c=new CrowdSense({stableMs:0});c.setContext('fork: left / right',0);for(const u of ['a','b','c','d'])c.ingest({userId:u,text:'left',ts:1});assert.equal(c.tick(2).decide.state,'VOICE')}],
['trap infers opposite in two-option choice',()=>{const c=new CrowdSense({stableMs:0,minFloor:1});c.setContext('fork: left / right',0);c.ingest({userId:'a',text:'right is a trap',ts:1});assert.equal(c.tick(2).decide.option,'left')}],
['matching hint preserves recent talk',()=>{const c=new CrowdSense({stableMs:0});for(const [u,t] of [['a','left'],['b','go left'],['c','right is a trap']])c.ingest({userId:u,text:t,ts:1});c.setContext('fork: left door / right door',2);assert.equal(c.tick(3).decide.participants,3)}],
['different hint clears decision talk',()=>{const c=new CrowdSense({stableMs:0});c.ingest({userId:'a',text:'left',ts:1});c.setContext('route: bridge / cave',2);assert.equal(c.tick(3).decide.participants,0)}],
['public state has no voter IDs',()=>{const c=new CrowdSense({stableMs:0,minFloor:1});c.setContext('fork: left / right',0);c.ingest({userId:'secret123',text:'left',ts:1});assert.ok(!JSON.stringify(c.tick(2)).includes('secret123'))}],
['explain is aggregate',()=>{const c=new CrowdSense({stableMs:0,minFloor:1});c.setContext('fork: left / right',0);c.ingest({userId:'secret123',text:'left',ts:1});c.tick(2);assert.ok(!JSON.stringify(c.explain()).includes('secret123'))}],
['old stance decays',()=>{const c=new CrowdSense({stableMs:0,minFloor:1});c.setContext('fork: left / right',0);c.ingest({userId:'a',text:'left',ts:1});assert.equal(c.tick(200000).decide.participants,0)}],
['dismiss does not create voice',()=>{const c=new CrowdSense();assert.equal(c.dismiss('decide',1)?.key,'decide')}],
['heard requires voice',()=>{const c=new CrowdSense();assert.equal(c.markHeard('decide',1),null)}],
['context stored',()=>{const c=new CrowdSense();c.setContext('fork: left / right',1);assert.equal(c.tick(2).context,'fork: left / right')}],
['engine counts room viewers',()=>{const c=new CrowdSense();c.ingest({userId:'a',text:'hi',ts:1});c.ingest({userId:'b',text:'hello',ts:1});assert.equal(c.tick(2).room,2)}],
['duplicate viewer room count stays one',()=>{const c=new CrowdSense();c.ingest({userId:'a',text:'hi',ts:1});c.ingest({userId:'a',text:'again',ts:2});assert.equal(c.tick(3).room,1)}],
['noise has no overlay',()=>assert.equal(new CrowdSense().tick(0).overlay,null)],
['voice overlay labels GO LEFT',()=>{const c=new CrowdSense({stableMs:0});c.setContext('fork: left / right',0);for(const u of ['a','b','c','d'])c.ingest({userId:u,text:'left',ts:1});assert.equal(c.tick(2).overlay.label,'GO LEFT')}],
];
for(const [name,fn] of cases)test(name,fn);
