import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presentation } from '../apps/realtime-gateway/public/presentation.js';
import { CAPTION_POLICY,captionUnits,takeCaptionPhrase } from '../apps/realtime-gateway/public/caption-phrases.js';
import { AudioIO,outputClock,MAX_PLAYBACK_QUEUE_SECONDS } from '../apps/realtime-gateway/public/audio.js';
import { ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';

function harness() {
  let wall=0,serial=0,stops=0;
  const timers=new Map(),renders=[],modes=[],events=[],played=[];
  const clock={running:true,played_ms:0,received_ms:2400,clock_source:'context_time'};
  const view=new Presentation({now:()=>wall,schedule:callback=>{timers.set(++serial,callback);return serial;},unschedule:id=>timers.delete(id),
    render:(text,parts)=>renders.push({text,...parts,at:wall}),play:(...args)=>played.push(args),stopAudio:()=>stops++,
    getPlayback:()=>clock,onMode:(mode,fields)=>modes.push({mode,...fields}),onObserve:(name,fields)=>events.push({name,...fields})});
  const step=(ms=CAPTION_POLICY.poll_ms)=>{wall+=ms;const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}};
  const finish=()=>{for(let i=0;i<150 && view.mode!=='complete';i++)step();assert.equal(view.mode,'complete');};
  return {view,clock,timers,renders,modes,events,played,step,finish,get stops(){return stops;}};
}
function phrases(text) {
  const parts=[];while(text){const part=takeCaptionPhrase(text,{flush:true});assert.ok(part);parts.push(part);text=text.slice(part.length);}return parts;
}

test('phrase boundaries preserve Chinese/English order, whole words, decimals, quotes and graphemes',()=> {
  const text='“我喜欢足球。” I like football. Dr. Kai has 3.5 balls, and they’re blue! 好呀。 Great!';
  const parts=phrases(text);
  assert.equal(parts.join(''),text);
  assert.ok(parts[0].includes('足球。”'));
  assert.ok(parts.some(p=>p.includes('Dr. Kai has 3.5 balls,')));
  assert.ok(parts.every(p=>!p.includes('\uFFFD')));
  assert.equal(takeCaptionPhrase('I like foot'),null);
  assert.equal(takeCaptionPhrase('I like football. Next'), 'I like football. ');
  assert.equal(takeCaptionPhrase('These are several complete words unfinished',{soft:true}), 'These are several complete words ');
  assert.equal(takeCaptionPhrase('短句还未结束'),null);
  const long=phrases('a '.repeat(30)+'👩🏽‍💻'.repeat(10)+' end.');
  assert.ok(long.every(p=>captionUnits(p)<=CAPTION_POLICY.max_units && [...p].length<=CAPTION_POLICY.max_chars));
  const giant=phrases('é'.repeat(150));assert.equal(giant.join(''),'é'.repeat(150));assert.ok(giant.every(p=>[...p].length<=64));
});

test('burst text plus done does not reveal before playback or dump on clock catch-up',()=> {
  const h=harness(),text='你好。 Hello. 我喜欢足球。 I like football.';
  h.view.begin('r');h.view.append('r',text);h.view.audio('r','synthetic',24000);h.view.done('r');
  h.step(1600);assert.equal(h.view.visible,'');assert.equal(h.view.mode,'waiting_audio');
  h.clock.played_ms=10;h.step();assert.equal(h.view.visible,'你好。 ');
  h.clock.played_ms=2400;h.step(80);assert.equal(h.view.visible,'你好。 ');
  h.step(240);assert.equal(h.view.visible,'你好。 Hello. ');
  h.finish();assert.equal(h.view.visible,text);assert.equal(h.view.pending,'');
  const reveals=h.renders.filter(r=>r.current);assert.equal(reveals.length,4);
  assert.ok(reveals.slice(1).every((r,i)=>r.at-reveals[i].at>=320));
  assert.ok(h.events.some(e=>e.name==='caption.playback' && e.played_pcm_ms===2400));
  assert.equal(h.renders.at(-1).complete,true);
});

test('text waits for audio while streaming; split English tokens are buffered and audio-first is supported',()=> {
  const h=harness();h.view.begin('r');h.view.append('r','I like foot');h.step(2000);
  assert.equal(h.view.visible,'');assert.equal(h.view.mode,'waiting_audio');
  h.view.audio('r','synthetic',24000);h.clock.played_ms=100;h.view.append('r','ball. 我喜欢足球。');h.step();
  assert.equal(h.view.visible,'I like football. ');assert.ok(!h.renders.some(r=>r.text==='I like foot'));
  const first=harness();first.view.begin('audio-first');first.view.audio('audio-first','synthetic',24000);
  first.clock.played_ms=2400;first.view.append('audio-first','你好。 Hello.');first.view.done('audio-first');first.finish();
  assert.equal(first.view.visible,'你好。 Hello.');
});

test('suspension freezes captions and an underrun cannot be replaced by elapsed wall time',()=> {
  const h=harness();h.view.begin('r');h.view.append('r','你好。 Hello.');h.view.audio('r','synthetic',24000);
  h.clock.played_ms=100;h.step();assert.equal(h.view.visible,'你好。 ');
  h.step(4000);assert.equal(h.view.visible,'你好。 '); // Second phrase needs 600ms played, not elapsed.
  h.clock.running=false;h.clock.played_ms=2400;h.step(5000);assert.equal(h.view.visible,'你好。 ');assert.equal(h.view.mode,'paused');
  h.clock.running=true;h.view.done('r');h.finish();assert.equal(h.view.visible,'你好。 Hello.');
});

test('completed no-audio reply uses an explicit progressive text-only fallback',()=> {
  const h=harness();h.view.begin('r');h.view.append('r','你好。 Hello.');h.step(3000);assert.equal(h.view.visible,'');
  h.view.done('r');h.step();assert.equal(h.view.visible,'你好。 ');assert.equal(h.view.mode,'text_only');
  h.finish();assert.deepEqual(h.played,[]);assert.equal(h.modes.at(-1).text_only,true);
  assert.ok(h.events.filter(e=>e.name==='caption.revealed').every(e=>e.caption_mode==='text_only' && e.played_pcm_ms===undefined));
});

test('cancel, replacement and reset clear queued phrases and fence callbacks even when reply IDs are reused',()=> {
  const h=harness();h.view.begin('old');h.view.append('old','旧句。 Old sentence.');h.view.done('old');
  const obsolete=[...h.timers.values()][0];h.step();h.view.stop('old');assert.equal(h.view.visible,'');assert.equal(h.timers.size,0);
  h.view.begin('new');h.view.append('new','新句。 New sentence.');h.view.done('new');obsolete();
  assert.equal(h.view.visible,'');assert.equal(h.view.stop('old'),false);assert.equal(h.view.audio('old','late',24000),false);
  assert.equal(h.view.append('old','late'),false);assert.equal(h.view.done('old'),false);h.finish();
  assert.equal(h.view.visible,'新句。 New sentence.');
  h.view.reset();h.view.begin('old');h.view.append('old','现在。 Now.');h.view.done('old');obsolete();h.finish();
  assert.equal(h.view.visible,'现在。 Now.');assert.ok(h.stops>=4);assert.equal(h.played.length,0);
  assert.throws(()=>{h.view.begin('cap');h.view.append('cap','x'.repeat(4001));},/CAPTION_LIMIT/);
});

function audioHarness() {
  const nodes=[],events=[];
  const context={state:'running',currentTime:0,createBuffer:(channels,length,rate)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)}),
    createBufferSource:()=>{const source={connect(){},start(at){this.at=at;},stop(){this.stopped=true;}};nodes.push(source);return source;}};
  const io=new AudioIO({onObserve:(name,fields)=>events.push({name,...fields})});io.context=context;io.gain={};
  return {io,context,nodes,events,pcm:Buffer.alloc(4800).toString('base64')}; // 100ms @ 24kHz
}
test('playback counts scheduled PCM only, excluding lead-in and network underrun gaps',()=> {
  const h=audioHarness();h.io.play(h.pcm,24000,'r');assert.equal(h.io.playback('r').played_ms,0);
  h.context.currentTime=.08;assert.ok(Math.abs(h.io.playback('r').played_ms-50)<.001);
  h.context.currentTime=.5;assert.equal(h.io.playback('r').played_ms,100);
  h.io.play(h.pcm,24000,'r');assert.equal(h.io.playback('r').played_ms,100);
  h.context.currentTime=.58;assert.ok(Math.abs(h.io.playback('r').played_ms-150)<.001);
  h.context.state='suspended';assert.equal(h.io.playback('r').running,false);
  h.context.currentTime=.7;assert.equal(h.io.playback('r').played_ms,200);assert.equal(h.io.queuedStats.get('r').spans.length,0);
});
test('output position prefers a usable device timestamp, bounds extrapolation and falls back while suspended',()=> {
  const ctx={state:'running',currentTime:2,getOutputTimestamp:()=>({contextTime:1.8,performanceTime:900})};
  assert.ok(Math.abs(outputClock(ctx,1000).seconds-1.9)<.000001);assert.equal(outputClock(ctx,1000).source,'output_timestamp');
  assert.deepEqual(outputClock(ctx,1500),{seconds:2,source:'output_timestamp'});
  assert.deepEqual(outputClock(ctx,2100),{seconds:2,source:'context_time'});
  ctx.state='suspended';assert.deepEqual(outputClock(ctx,1000),{seconds:2,source:'context_time'});
  ctx.state='running';ctx.getOutputTimestamp=()=>({contextTime:0,performanceTime:900});assert.equal(outputClock(ctx,1000).source,'context_time');
  ctx.getOutputTimestamp=()=>{throw new Error('unavailable');};assert.equal(outputClock(ctx).source,'context_time');
});
test('old ended callbacks cannot drain a replacement; output stop leaves capture generation unchanged',()=> {
  const h=audioHarness();h.io.play(h.pcm,24000,'old');const old=h.nodes[0],captureGeneration=h.io.generation;
  h.io.stopPlayback();h.io.play(h.pcm,24000,'new');old.onended();
  assert.equal(h.io.sources.size,1);assert.equal(h.io.playback('old'),null);assert.equal(h.io.generation,captureGeneration);
  assert.ok(!h.events.some(e=>e.name==='audio.drained'));h.nodes[1].onended();
  assert.equal(h.events.find(e=>e.name==='audio.drained').response_id,'new');
});
test('burst PCM longer than three seconds drains completely and remains immediately interruptible',()=> {
  const h=audioHarness(),pcm=Buffer.alloc(48000).toString('base64');
  for(let i=0;i<8;i++)h.io.play(pcm,24000,'burst');
  assert.equal(h.nodes.length,8);assert.equal(h.io.playback('burst').received_ms,8000);
  h.context.currentTime=4.03;assert.ok(Math.abs(h.io.playback('burst').played_ms-4000)<.001);
  h.context.currentTime=8.04;assert.equal(h.io.playback('burst').played_ms,8000);
  const captureGeneration=h.io.generation;h.io.stopPlayback();
  assert.ok(h.nodes.every(n=>n.stopped));assert.equal(h.io.playback('burst'),null);
  assert.equal(h.io.generation,captureGeneration);h.io.play(pcm,24000,'next');
  assert.ok(Math.abs(h.nodes.at(-1).at-8.07)<.001);
});
test('PCM queue remains bounded including the incoming chunk and rejected audio never starts',()=> {
  const h=audioHarness(),pcm=Buffer.alloc(48000).toString('base64');
  for(let i=0;i<MAX_PLAYBACK_QUEUE_SECONDS-1;i++)h.io.play(pcm,24000,'bounded');
  const before=h.io.playback('bounded').received_ms,nodes=h.nodes.length;
  assert.throws(()=>h.io.play(pcm,24000,'bounded'),/PLAYBACK_BACKLOG/);
  assert.equal(h.nodes.length,nodes);assert.equal(h.io.playback('bounded').received_ms,before);
  h.context.currentTime=2;assert.doesNotThrow(()=>h.io.play(pcm,24000,'bounded'));
});
test('caption diagnostics export playback estimates and phrase counts without text or audio',()=> {
  const trace=new ExperienceTrace();trace.gateway({name:'session.config',at_ms:0,fields:{synthetic:true}});
  trace.record('caption.revealed',{response_id:'private-id',phrase_units:2,visible_chars:2,pending_chars:3,text:'私人内容',audio:'private-audio',caption_mode:'playing',caption_policy_version:CAPTION_POLICY.version});
  trace.record('caption.playback',{response_id:'private-id',played_pcm_ms:400,received_pcm_ms:1200,queued_pcm_ms:800,clock_source:'output_timestamp',caption_mode:'playing'});
  const report=trace.snapshot(),json=JSON.stringify(report);
  assert.equal(report.kind,'synthetic');assert.equal(report.real_experience_accepted,false);
  for(const secret of ['private-id','私人内容','private-audio'])assert.ok(!json.includes(secret));
  assert.ok(report.timeline.some(e=>e.played_pcm_ms===400 && e.clock_source==='output_timestamp'));
  assert.equal(report.summary.responses[0].caption_phrases,1);assert.equal(report.summary.responses[0].caption_played_pcm_ms,400);
});
