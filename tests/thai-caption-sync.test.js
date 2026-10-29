import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Presentation} from '../apps/free-talk-thai/public/presentation.js';
import {CAPTION_POLICY,captionSpeechUnits,takeCaptionPhrase} from '../apps/free-talk-thai/public/caption-phrases.js';
import {createThaiApp} from '../apps/free-talk-thai/src/server.js';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';

function harness(){
  let now=0,serial=0;const timers=new Map(),renders=[],events=[];
  const clock={running:true,played_ms:0,received_ms:12000};
  const view=new Presentation({now:()=>now,schedule:(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;},unschedule:id=>timers.delete(id),getPlayback:()=>clock,play:()=>{},stopAudio:()=>{},render:(text,parts)=>renders.push({text,...parts,now}),onObserve:(name,f)=>events.push({name,...f,now})});
  const step=(ms=60)=>{const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
  return {view,clock,renders,events,timers,step};
}
const input='今天我很开心，因为我见到了朋友。 วันนี้ฉันมีความสุขมาก เพราะได้เจอเพื่อน';
test('Thai duration calibration matches measured authored pairs without dictionary-word timing',()=>{
  const pairs=[['今天我很开心，因为我见到了朋友。',2611,'วันนี้ฉันมีความสุขมาก เพราะได้เจอเพื่อน',2382],['我喜欢听音乐，也喜欢和朋友聊天。',2587,'ฉันชอบฟังเพลง และชอบคุยกับเพื่อน',2378]];
  for(const [zh,zms,th,tms] of pairs){const estimated=captionSpeechUnits(zh)/(captionSpeechUnits(zh)+captionSpeechUnits(th)),observed=zms/(zms+tms);assert(Math.abs(estimated-observed)<0.04);}
  assert.equal(captionSpeechUnits('。 \n'),0);
});
test('Thai language boundary follows calibrated audio ratio at normal, slow and faster PCM durations',()=>{
  // Known authored fixed-speech durations, including each language's pauses.
  for(const scale of [.7,1,1.5]){
    const h=harness(),total=(2611+2382)*scale;h.clock.received_ms=total;
    h.view.begin('r');h.view.append('r',input);h.view.audio('r','synthetic',24000);h.view.done('r');
    let firstThai;
    for(let t=0;t<=total+1000;t+=60){h.clock.played_ms=Math.min(t,total);h.step();if(!firstThai&&/\p{Script=Thai}/u.test(h.view.visible))firstThai=t;}
    assert(firstThai!==undefined);assert(Math.abs(firstThai-2611*scale)<500,`Thai boundary ${firstThai}, reference ${2611*scale}`);
    assert.equal(h.view.visible,input);assert.equal(h.view.mode,'complete');
  }
});
test('Thai captions remain progressive, wait for initial audio and freeze on suspension and underrun',()=>{
  const h=harness();h.view.begin('r');h.view.append('r',input);h.step(2000);assert.equal(h.view.visible,'');
  h.view.audio('r','synthetic',24000);h.step();assert.equal(h.view.visible,'');
  h.clock.played_ms=10;h.step();const first=h.view.visible;assert(first&&first!==input);
  h.clock.running=false;h.clock.played_ms=10000;h.step(3000);assert.equal(h.view.visible,first);assert.equal(h.view.mode,'paused');
  h.clock.running=true;h.clock.played_ms=10;h.step(3000);assert.equal(h.view.visible,first);
  h.clock.played_ms=12000;h.view.done('r');h.step();assert.notEqual(h.view.visible,input);h.step(3000);assert.equal(h.view.visible,input);assert.equal(h.view.mode,'complete');
});
test('Thai audio-first, late text and no-audio fallback finish with exact source characters',()=>{
  for(const textOnly of [true,false]){
    const h=harness();h.view.begin('r');if(!textOnly){h.view.audio('r','synthetic',24000);h.clock.played_ms=12000;}
    h.step(3000);h.view.append('r','你好。 ฉันชอบคุยกับเพื่อน');h.view.done('r');h.step(3000);
    assert.equal(h.view.visible,'你好。 ฉันชอบคุยกับเพื่อน');assert.equal(h.view.mode,'complete');
  }
});
test('Thai cancellation and reconnect fence stale timers, text, PCM and completion',()=>{
  const h=harness();h.view.begin('old');h.view.append('old',input);const obsolete=[...h.timers.values()][0].fn;
  h.view.stop();h.view.begin('new');h.view.append('new','新的回复。 คำตอบใหม่');h.view.done('new');obsolete();
  assert.equal(h.view.append('old','迟到'),false);assert.equal(h.view.audio('old','late',24000),false);assert.equal(h.view.done('old'),false);assert.equal(h.view.stop('old'),false);
  h.step(3000);assert.equal(h.view.visible,'新的回复。 คำตอบใหม่');h.view.reset();h.view.begin('old');obsolete();assert.equal(h.view.visible,'');
});
test('Thai streaming splits preserve graphemes and keep language transitions in separate phrases',()=>{
  for(const text of [input,'中文ไม่มีช่องว่าง中文','วันนี้ฉันอยากไปเดินเล่นที่สวนสาธารณะ','👩🏽‍💻'.repeat(40), 'ก้'.repeat(80)]){
    let pending=text;const parts=[];
    while(pending){const p=takeCaptionPhrase(pending,{flush:true});assert(p);parts.push(p);pending=pending.slice(p.length);}
    assert.equal(parts.join(''),text);
    const offsets=new Set([...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(text)].map(g=>g.index));offsets.add(text.length);
    let offset=0;for(const p of parts){offset+=p.length;assert(offsets.has(offset));assert(!(/\p{Script=Han}/u.test(p)&&/\p{Script=Thai}/u.test(p)));}
  }
  const h=harness();h.view.begin('r');h.view.append('r','你好。 ฉันชอ');h.view.append('r','บฟังเพลง');h.view.done('r');h.step(3000);assert.equal(h.view.visible,'你好。 ฉันชอบฟังเพลง');
});
test('Thai server serves only its own scheduler and leaves the shared English scheduler byte-identical',async t=>{
  const backend=await startMockBackend(),server=createThaiApp({backend});t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await backend.close();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/presentation.js');assert.equal(response.status,200);
  assert.equal(await response.text(),await readFile(new URL('../apps/free-talk-thai/public/presentation.js',import.meta.url),'utf8'));
  const baseline=JSON.parse(await readFile(new URL('../scripts/teacher-assistant/freetalk-baseline.json',import.meta.url),'utf8'));
  const unchanged={'presentation.js':'bd7ba56ca69031f4b8d6f5a8cae5250964520d1600a68555a2a3d8741daf40cb','caption-phrases.js':'050c7a4ff9de152c8e409a39c4eea0e8d7aaec34772d9092781e009732bd2796','audio.js':'04ed78c9a21bcbb09dd813ce16aa47b6be73a68b24b7464115fcec525a2c019a'};
  for(const name of ['presentation.js','caption-phrases.js','audio.js','web.js']){const path='apps/realtime-gateway/public/'+name;assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),baseline.files[path]??unchanged[name],path);}
  assert.equal(CAPTION_POLICY.version,'kai-thai-captions-v2');
});
