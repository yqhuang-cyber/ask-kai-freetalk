import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { SeeduplexProvider, createDoubaoProvider, validateSeeduplexProfile } from '../packages/provider-doubao/seeduplex.js';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
import { SessionRuntime } from '../packages/agent-core/session.js';
import { REPLY_INSTRUCTIONS } from '../packages/agent-core/reply-policy.js';
import { NATURAL_TEACHING_INSTRUCTIONS } from '../packages/agent-core/natural-teaching.js';
import { until } from './helpers/realtime.js';
const template = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
function profile() {
  const p = structuredClone(template); p.reviewed = true; p.realtime.reviewed = true; p.realtime.ordered_acks_reviewed = true;
  return p; // Synthetic test attestation, never evidence about a real supplier account.
}
function setup() {
  const socket = new EventEmitter(), sent = [], packets = [], failures = [];
  Object.assign(socket,{readyState:1,bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),terminate:()=>socket.ended=true});
  const provider = createDoubaoProvider({profile:profile(),env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:(_url,options)=>{
    assert.equal(options.headers['X-Api-Key'],'synthetic-only'); assert.equal(options.maxPayload,131072); return socket;
  }});
  provider.open({sessionId:'local-session',instructions:'trusted lesson',onEvent:p=>packets.push(p),onFailure:code=>failures.push(code)});
  socket.emit('open');
  let seq = 0;
  const wire = raw => socket.emit('message',Buffer.from(JSON.stringify({event_id:`wire-${++seq}`,...raw})),false);
  const ready = () => wire({type:'session.created',session:{id:'private-session'}});
  return {provider,socket,sent,packets,failures,wire,ready};
}
const output = (type,response='private-r1',question='private-q1',extra={})=>({type,response_id:response,question_id:question,...extra});

test('Seeduplex startup requires separate static and ACK review; output pcm is explicitly 16 bit',()=>{
  assert.throws(()=>validateSeeduplexProfile(template),/NOT_VERIFIED/);
  const ack = profile(); ack.realtime.ordered_acks_reviewed = false;
  assert.throws(()=>validateSeeduplexProfile(ack),/ACK_REVIEW_REQUIRED/);
  const audio = profile(); audio.session_create.session.audio.output.format.type = 'pcm';
  assert.throws(()=>validateSeeduplexProfile(audio),/AUDIO/);
  const tools = profile(); tools.session_create.session.tools = [{name:'unexpected'}];
  assert.throws(()=>validateSeeduplexProfile(tools),/UNREVIEWED/);
  const x = setup(); assert.ok(x.provider instanceof SeeduplexProvider);
  assert.equal(x.sent[0].session.instructions,'trusted lesson');
  assert.equal(x.sent[0].session.audio.output.format.type,'pcm_s16le');
  assert.deepEqual(x.sent[0].extension,{dialog:{extra:{enable_user_query_exit:true}}});
  const extra=profile();extra.session_create.extension={dialog:{extra:{enable_user_query_exit:true,model:'1.2.1.1'}}};
  assert.throws(()=>validateSeeduplexProfile(extra),/UNREVIEWED/);
  const bare=profile();delete bare.session_create.extension;assert.equal(validateSeeduplexProfile(bare),bare);
  x.provider.close();
});
test('text before audio starts a response once; cumulative ASR updates replace partials and final alone forms an attempt',()=>{
  const x = setup(), runtime = new SessionRuntime('local-session'); x.ready();
  x.wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-q1'});
  x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'我喜欢'});
  x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'我喜欢足球'});
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'你喜欢足球。'}));
  x.wire(output('response.output_audio.started'));
  x.wire(output('response.output_audio.delta',undefined,undefined,{delta:Buffer.alloc(960).toString('base64')}));
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球'});
  x.wire(output('response.done'));
  for (const p of x.packets) if (p.event) assert.equal(runtime.ingest(p.event).accepted,true);
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='user.partial').map(p=>p.event.payload.text),['我喜欢','我喜欢足球']);
  assert.equal(x.packets.filter(p=>p.event?.type==='response.started').length,1);
  assert.equal(runtime.evidence.length,1); assert.equal(runtime.evidence[0].kind,'attempted');
  const audio = x.packets.find(p=>p.audio); assert.equal(audio.sample_rate,24000); assert.equal(audio.event.payload.byte_length,960);
  assert.ok(!JSON.stringify(x.packets).includes('private-')); assert.deepEqual(x.failures,[]);
  x.provider.sendAudio(Buffer.alloc(640)); assert.equal(x.sent.at(-1).type,'input_audio_buffer.append');
  x.provider.close(); assert.equal(x.sent.at(-1).type,'session.close');
});
test('observed ASR text completion retains final ownership and deduplication without requiring transcript',()=>{
  const x=setup();x.ready();
  x.wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-q1'});
  x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'我喜欢'});
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',content_index:0,text:'我喜欢足球'});
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',text:'重复结果'});
  const finals=x.packets.filter(p=>p.event?.type==='user.final');
  assert.equal(finals.length,1);assert.equal(finals[0].event.payload.text,'我喜欢足球');
  assert.equal(finals[0].event.turn_id,x.packets.find(p=>p.event?.type==='user.partial').event.turn_id);
  assert.deepEqual(x.failures,[]);x.provider.close();
});
test('ASR hypotheses may revise and shorten; repeated cumulative text cannot overflow or create premature evidence',()=>{
  const x=setup(),runtime=new SessionRuntime('local-session');x.ready();
  const hypotheses=['我','我喜欢','我喜欢足球','我喜欢篮球','我喜欢'];
  for(const delta of hypotheses)x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta});
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='user.partial').map(p=>p.event.payload.text),hypotheses);
  for(let n=0;n<50;n++)x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'x'.repeat(100)});
  for(const packet of x.packets)if(packet.event)assert.equal(runtime.ingest(packet.event).accepted,true);
  assert.equal(runtime.evidence.length,0);assert.deepEqual(x.failures,[]);
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',text:'我喜欢篮球'});
  assert.equal(x.packets.at(-1).event.payload.text,'我喜欢篮球');x.provider.close();
});
test('conflicting or malformed ASR final fields cannot become student evidence',()=>{
  for(const fields of [{text:'有效',transcript:'冲突'},{text:null,transcript:'有效'},{text:''},{text:'x'.repeat(2001)}]) {
    const x=setup();x.ready();x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',...fields});
    assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']);assert.ok(!x.packets.some(p=>p.event?.type==='user.final'));x.provider.close();
  }
  const x=setup();x.ready();x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',text:'一致',transcript:'一致'});
  assert.equal(x.packets.at(-1).event.payload.text,'一致');assert.deepEqual(x.failures,[]);x.provider.close();
});
test('audio completion alone does not finish the interaction; completed text contributes only its suffix',()=>{
  const x = setup(); x.ready();
  x.wire(output('response.output_audio.started'));
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'你好'}));
  x.wire(output('response.output_audio.done'));
  assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,0);
  x.wire(output('response.output_text.done',undefined,undefined,{text:'你好！'}));
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='response.text.delta').map(p=>p.event.payload.text),['你好','！']);
  x.wire(output('response.done')); x.wire(output('response.output_text.delta',undefined,undefined,{delta:'迟到'}));
  assert.equal(x.packets.filter(p=>p.event?.type==='response.started').length,1);
  assert.ok(!JSON.stringify(x.packets).includes('迟到')); x.provider.close();
});
test('cancel uses official simple request; sole pending ACK preserves newer response and old output is fenced',()=>{
  const x = setup(); x.ready(); x.wire(output('response.output_text.delta',undefined,undefined,{delta:'旧回复'}));
  const old = x.packets.find(p=>p.event?.type==='response.started').event;
  x.provider.cancel(old.response_id);
  assert.deepEqual(Object.keys(x.sent.at(-1)).sort(),['event_id','type']);
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'迟到旧回复'}));
  x.wire(output('response.output_text.delta','private-r2','private-q2',{delta:'新回复'}));
  x.wire({type:'response.canceled',event_id:'cancel-ack-1'});
  const ack = x.packets.find(p=>p.event?.type==='response.cancelled').event;
  assert.equal(ack.response_id,old.response_id); assert.notEqual(x.provider.activeReply.id,old.response_id);
  x.wire(output('response.output_audio.delta',undefined,undefined,{delta:'AAAAAA=='}));
  assert.ok(!x.packets.some(p=>p.audio)); assert.ok(!JSON.stringify(x.packets).includes('迟到旧回复'));
  assert.deepEqual(x.failures,[]); x.provider.close();
});
test('context ACK is session-bound, serialized and deduplicated; no invented version field goes over wire',()=>{
  const x = setup(); x.ready(); x.provider.updateContext({instructions:'lesson two',version:2});
  const update = x.sent.at(-1); assert.equal(update.type,'session.update'); assert.equal(update.session.id,'private-session');
  assert.ok(!Object.hasOwn(update,'version')); assert.ok(!Object.hasOwn(update.session,'version'));
  assert.throws(()=>x.provider.updateContext({instructions:'overlap',version:3}),/CONTROL_PENDING/);
  x.wire({type:'session.updated',session:{id:'private-session'},event_id:'context-ack-1'});
  assert.equal(x.packets.at(-1).version,2);
  x.provider.updateContext({instructions:'lesson three',version:3});
  x.wire({type:'session.updated',session:{id:'private-session'},event_id:'context-ack-1'});
  assert.equal(x.provider.pendingControl.version,3);
  x.wire({type:'session.updated',session:{id:'another-session'}});
  assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']); x.provider.close();
});
test('missing/foreign ownership, unsolicited controls, bad audio and wire errors are masked',()=>{
  const cases = [
    {type:'response.done'}, {type:'session.updated',session:{id:'private-session'}}, {type:'response.canceled'},
    output('response.output_audio.delta',undefined,undefined,{delta:'***'}),
    {type:'error',error:{message:'private-error synthetic-only'}}
  ];
  for (const raw of cases) { const x = setup(); x.ready(); x.wire(raw); assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']); assert.ok(!JSON.stringify(x.failures).includes('private-')); x.provider.close(); }
});
test('request budget and input framing remain bounded; wire duplicates cannot repeat final student evidence',()=>{
  const x = setup(); assert.throws(()=>x.provider.sendAudio(Buffer.alloc(640)),/INPUT_AUDIO/); x.ready();
  for (const size of [0,1,642]) assert.throws(()=>x.provider.sendAudio(Buffer.alloc(size)),/INPUT_AUDIO/);
  const final = {type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球',event_id:'final-1'};
  x.wire(final); x.wire(final); x.wire({...final,event_id:'final-2'});
  assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,1);
  x.provider.close(); const before = x.packets.length; x.wire({type:'session.created',session:{id:'late-session'}}); assert.equal(x.packets.length,before);
});
const usage = () => ({type:'response.done',response:{usage:{output_tokens:1}}});
const pcm = () => ({type:'response.output_audio.delta',delta:Buffer.alloc(60000,1).toString('base64')});
test('identified audio boundaries own ID-less PCM; usage never completes output or the next reply',()=>{
  const x=setup();x.ready();x.wire(usage());
  x.wire(output('response.output_audio.started'));x.wire(pcm());x.wire(usage());
  const first=x.provider.activeReply;
  assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,0);
  assert.equal(x.packets.find(p=>p.audio).event.response_id,first.id);
  assert.equal(x.packets.find(p=>p.audio).event.payload.byte_length,60000);
  x.wire(output('response.output_audio.done'));assert.equal(x.provider.activeReply,null);
  x.wire(output('response.output_audio.started','private-r2','private-q2'));const fresh=x.provider.activeReply;
  x.wire(usage());x.wire(output('response.output_audio.done'));x.wire(output('response.done'));
  x.wire(output('response.output_audio.started')); // closed boundary cannot retake the new lane
  assert.equal(x.provider.activeReply,fresh);assert.equal(x.provider.audioLane,fresh);
  x.wire(pcm());x.wire(output('response.output_audio.done','private-r2','private-q2'));x.wire(usage());
  assert.deepEqual(x.packets.filter(p=>p.audio).map(p=>p.event.response_id),[first.id,fresh.id]);
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='response.done').map(p=>p.event.response_id),[first.id,fresh.id]);
  assert.deepEqual(x.failures,[]);x.provider.close();
});
test('mute is an explicit keepalive event and audio that already started cannot take a closing brief',()=>{
  const x=setup();x.ready();
  x.provider.mute();
  assert.equal(x.sent.at(-1).type,'input_audio_mute.commit');
  x.provider.updateContext({instructions:'本轮结束',version:2});
  assert.equal(x.sent.at(-1).session.instructions,'本轮结束');
  x.wire({type:'session.updated',session:{id:'private-session'}});
  x.wire(output('response.output_audio.started'));
  assert.throws(()=>x.provider.updateContext({instructions:'太晚',version:3,duringSilentReply:true}),/CONTROL_PENDING/);
  assert.deepEqual(x.failures,[]);x.provider.close();
});
test('audio.done exit status asks the client to leave; other codes stay ordinary completions',()=>{
  const exited=setup();exited.ready();
  exited.wire(output('response.output_audio.started'));
  exited.wire(output('response.output_audio.done',undefined,undefined,{status_code:'20000002'}));
  assert.equal(exited.packets.filter(p=>p.control==='user.exit.intent').length,1);
  assert.equal(exited.packets.filter(p=>p.event?.type==='response.done').length,1);
  assert.deepEqual(exited.failures,[]);exited.provider.close();
  const numeric=setup();numeric.ready();
  numeric.wire(output('response.output_audio.started'));
  numeric.wire(output('response.output_audio.done',undefined,undefined,{status_code:20000002}));
  assert.equal(numeric.packets.filter(p=>p.control==='user.exit.intent').length,1);
  numeric.provider.close();
  const ordinary=setup();ordinary.ready();
  ordinary.wire(output('response.output_audio.started'));
  ordinary.wire(output('response.output_audio.done',undefined,undefined,{status_code:'20000000'}));
  assert.equal(ordinary.packets.some(p=>p.control==='user.exit.intent'),false);
  assert.equal(ordinary.provider.activeReply,null);assert.deepEqual(ordinary.failures,[]);ordinary.provider.close();
});
test('unbound audio fails before a boundary; post-completion no-ID audio stays fenced',()=>{
  const orphan=setup();orphan.ready();orphan.wire(pcm());assert.deepEqual(orphan.failures,['PROVIDER_PROTOCOL_ERROR']);orphan.provider.close();
  const x=setup();x.ready();x.wire(output('response.output_audio.started'));x.wire(output('response.output_audio.done'));
  x.wire(pcm());assert.ok(!x.packets.some(p=>p.audio));assert.deepEqual(x.failures,[]);x.provider.close();
});
test('cancel discards ID-less in-flight PCM and late usage cannot close a new reply',()=>{
  const x=setup();x.ready();x.wire(output('response.output_audio.started'));x.wire(pcm());
  const old=x.provider.activeReply;x.provider.cancel(old.id);x.wire(pcm());
  x.wire({type:'response.canceled',event_id:'same-cancel-ack'});x.wire(pcm());
  x.wire(output('response.output_audio.started','private-r2','private-q2'));const fresh=x.provider.activeReply;
  x.wire({type:'response.canceled',event_id:'same-cancel-ack'});x.wire(usage());
  x.wire(output('response.output_audio.done'));x.wire(output('response.output_audio.delta',undefined,undefined,{delta:'AAAA'}));
  x.wire(pcm());assert.equal(x.provider.activeReply,fresh);
  assert.deepEqual(x.packets.filter(p=>p.audio).map(p=>p.event.response_id),[old.id,fresh.id]);
  assert.equal(x.packets.filter(p=>p.event?.type==='response.cancelled').length,1);
  assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,0);
  assert.deepEqual(x.failures,[]);x.provider.close();
});
test('ambiguous audio start fails before forwarding a new owner, with or without cancel ACK pending',()=>{
  for(const cancel of [false,true]) {
    const x=setup();x.ready();x.wire(output('response.output_audio.started'));
    if(cancel)x.provider.cancel(x.provider.activeReply.id);
    x.wire(output('response.output_audio.started','private-r2','private-q2'));
    assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']);
    assert.equal(x.packets.filter(p=>p.event?.type==='response.started').length,1);x.provider.close();
  }
});
test('text finished before audio waits for audio.done; usage does not add student evidence',()=>{
  const x=setup();x.ready();x.wire(output('response.output_text.delta',undefined,undefined,{delta:'你好。'}));
  x.wire(output('response.output_audio.started'));x.wire(output('response.output_text.done',undefined,undefined,{text:'你好。Hello.'}));
  x.wire(usage());assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,0);
  x.wire(pcm());x.wire(output('response.output_audio.done'));x.wire(usage());
  const runtime=new SessionRuntime('local-session');for(const p of x.packets)if(p.event)assert.equal(runtime.ingest(p.event).accepted,true);
  assert.equal(runtime.evidence.length,0);assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,1);
  assert.deepEqual(x.failures,[]);x.provider.close();
});
test('graceful close fences output, awaits real ACK once and suppresses intentional transport failures',async()=>{
  const x=setup();x.ready();x.wire(output('response.output_audio.started'));
  const before=x.packets.length,result=x.provider.close();assert.equal(x.provider.close(),result);
  assert.ok(!x.socket.ended);x.wire(pcm());assert.equal(x.packets.length,before);
  x.wire({type:'session.closed'});assert.deepEqual(await result,{acknowledged:true});
  assert.ok(x.socket.ended);assert.equal(x.sent.filter(p=>p.type==='session.close').length,1);
  x.socket.emit('error',new Error('synthetic intentional close'));x.socket.emit('close');assert.deepEqual(x.failures,[]);
  assert.equal(x.provider.ids.size,0);assert.equal(x.provider.activeReply,null);
});
test('graceful close falls back on missing ACK and a closed-before-open transport never sends create',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const x=setup();x.ready();const result=x.provider.close();t.mock.timers.tick(2000);
  assert.deepEqual(await result,{acknowledged:false});assert.ok(x.socket.ended);
  const y=setup();await y.provider.close();const sent=y.sent.length;y.socket.emit('open');
  assert.equal(y.sent.length,sent);assert.deepEqual(y.failures,[]);
});
test('probe-only runtime attestation cannot enable ordinary Web sessions',()=>{
  const p=profile();p.realtime.review_scope='protocol_smoke';
  assert.throws(()=>validateSeeduplexProfile(p),/PROBE_ONLY/);
  assert.throws(()=>createDoubaoProvider({profile:p,env:{DOUBAO_API_KEY:'synthetic-only'}}),/PROBE_ONLY/);
  assert.equal(validateSeeduplexProfile(p,{protocolProbe:true}),p);
});
test('Seeduplex wire events integrate through browser WSS and teaching context ACK (synthetic peer only)',async t=>{
  let wire, sent = [];
  const server = createGateway({providerKind:'test',providerFactory:()=>{
    const socket = new EventEmitter(); Object.assign(socket,{readyState:1,bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),terminate:()=>{}});
    const p = new SeeduplexProvider({profile:profile(),env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const open = p.open.bind(p); p.open = options=>{open(options);socket.emit('open');};
    let seq = 0; wire = raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`w-${++seq}`,...raw})),false);
    return p;
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.stopRealtime();server.close(resolve);server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'sports'})});
  assert.equal(res.status,201); const ticket = await res.json();
  const ws = new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin}), packets = [];
  ws.on('message',b=>packets.push(JSON.parse(b.toString()))); await once(ws,'open');
  assert.ok(sent.find(e=>e.type==='session.create').session.instructions.includes(REPLY_INSTRUCTIONS));
  assert.ok(sent.find(e=>e.type==='session.create').session.instructions.includes(NATURAL_TEACHING_INSTRUCTIONS));
  wire({type:'session.created',session:{id:'private-session'}});
  wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球'});
  wire(output('response.output_text.delta',undefined,undefined,{delta:'很好！'}));
  wire(output('response.output_audio.started'));wire(pcm());
  wire(output('response.output_text.done',undefined,undefined,{text:'很好！'}));wire(output('response.output_audio.done'));
  await until(()=>sent.some(e=>e.type==='session.update'));
  wire(usage()); // ID-less telemetry cannot affect the pending teaching context update.
  assert.ok(sent.find(e=>e.type==='session.update').session.instructions.includes(REPLY_INSTRUCTIONS));
  assert.ok(sent.find(e=>e.type==='session.update').session.instructions.includes(NATURAL_TEACHING_INSTRUCTIONS));
  wire({type:'session.updated',session:{id:'private-session'}});
  await until(()=>packets.some(e=>e.type==='teaching.context.applied'));
  assert.equal(packets.filter(e=>e.type==='teaching.state').at(-1).attempts[0].kind,'attempted');
  assert.ok(packets.every(p=>p.synthetic!==false)); ws.close(); await once(ws,'close');
});

test('bounded larger provider audio is split without losing PCM or changing ownership',()=>{
  for(const size of [65536,69632,92160]) {
    const x=setup();x.ready();x.wire(output('response.output_audio.started'));
    const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%251;
    x.wire(output('response.output_audio.delta',undefined,undefined,{delta:bytes.toString('base64')}));
    const chunks=x.packets.filter(p=>p.audio),owner=x.packets.find(p=>p.event?.type==='response.started').event;
    assert.deepEqual(Buffer.concat(chunks.map(p=>Buffer.from(p.audio,'base64'))),bytes);
    assert.equal(chunks.length,Math.ceil(size/65536));
    const runtime=new SessionRuntime('local-session');
    for(const p of x.packets)if(p.event)assert.equal(runtime.ingest(p.event).accepted,true);
    for(const p of chunks){assert.ok(p.event.payload.byte_length<=65536);assert.equal(p.event.response_id,owner.response_id);assert.equal(p.event.turn_id,owner.turn_id);}
    assert.deepEqual(x.failures,[]);x.provider.close();
  }
});
test('audio compatibility stays bounded, canonical and fenced after cancellation',()=>{
  for(const delta of ['***','AB==',Buffer.alloc(3).toString('base64'),Buffer.alloc(92162).toString('base64')]) {
    const x=setup();x.ready();x.wire(output('response.output_audio.started'));
    x.wire(output('response.output_audio.delta',undefined,undefined,{delta}));
    assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']);assert.ok(!x.packets.some(p=>p.audio));x.provider.close();
  }
  const x=setup();x.ready();x.wire(output('response.output_audio.started'));
  const owner=x.packets.find(p=>p.event?.type==='response.started').event;x.provider.cancel(owner.response_id);
  x.wire(output('response.output_audio.delta',undefined,undefined,{delta:Buffer.alloc(69632).toString('base64')}));
  assert.ok(!x.packets.some(p=>p.audio));assert.deepEqual(x.failures,[]);x.provider.close();
});
