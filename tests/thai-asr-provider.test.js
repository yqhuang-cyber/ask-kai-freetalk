import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {gzipSync} from 'node:zlib';import {readFile} from 'node:fs/promises';
import {DoubaoThaiAsr} from '../packages/provider-doubao/asr.js';import {HistoryTurnProvider} from '../packages/provider-doubao/history-turn.js';
const final=text=>{const body=gzipSync(Buffer.from(JSON.stringify({result:{text}}))),meta=Buffer.alloc(8);meta.writeInt32BE(-1);meta.writeUInt32BE(body.length,4);return Buffer.concat([Buffer.from([0x11,0x93,0x11,0]),meta,body]);};
function socket(){const s=new EventEmitter();s.readyState=1;s.bufferedAmount=0;s.sent=[];s.send=b=>s.sent.push(b);s.terminate=()=>{s.terminated=true;s.emit('close');};return s;}
test('runtime ASR streams fixed Thai, requires final, and ends with a nonempty documented last packet',async()=>{
 const s=socket();const client=new DoubaoThaiAsr({env:{DOUBAO_ASR_API_KEY:'synthetic-asr'},socketFactory:(_u,o)=>{assert.equal(o.headers['X-Api-Key'],'synthetic-asr');assert.equal(o.followRedirects,false);return s;}});
 const stream=client.start();for(let i=0;i<9;i++)stream.write(Buffer.alloc(640));stream.finish();s.emit('open');assert.equal(s.sent.at(-1)[1],0x22);assert(s.sent.at(-1).readUInt32BE(4)>0);
 s.emit('message',final('ฉันชอบแมว'),true);assert.deepEqual(await stream.result,{text:'ฉันชอบแมว',source:'doubao_asr_final'});assert.equal(s.terminated,true);
});
test('ASR cancellation terminates transport and ignores a late recognition final',async()=>{
 const s=socket(),controller=new AbortController(),client=new DoubaoThaiAsr({env:{DOUBAO_ASR_API_KEY:'synthetic-asr'},socketFactory:()=>s});const stream=client.start({signal:controller.signal});controller.abort();await assert.rejects(stream.result,/ASR_ABORTED/);s.emit('message',final('late'),true);assert.equal(s.terminated,true);
});
test('ASR handshake denial yields a bounded code and never an authorization response body',async()=>{
 const s=socket(),client=new DoubaoThaiAsr({env:{DOUBAO_ASR_API_KEY:'synthetic-asr'},socketFactory:()=>s}),stream=client.start();s.emit('unexpected-response',{}, {statusCode:403,resume(){}});await assert.rejects(stream.result,error=>error.message==='ASR_PERMISSION_DENIED');
});
test('initial history is an explicit isolated opt-in and is verified against exact returned QA',async()=>{
 const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));profile.reviewed=true;profile.realtime.reviewed=true;profile.realtime.ordered_acks_reviewed=true;
 const before=JSON.stringify(profile),s=socket(),sent=[],history=[{role:'user',text:'ฉันชื่ออะไร?'},{role:'assistant',text:'我先记下这个问题。'}];
 s.send=text=>{const v=JSON.parse(text);sent.push(v);if(v.type==='session.close')queueMicrotask(()=>s.emit('message',Buffer.from(JSON.stringify({type:'session.closed'})),false));};
 const p=new HistoryTurnProvider({profile,history,env:{DOUBAO_API_KEY:'synthetic-s2s'},socketFactory:()=>s});p.open({sessionId:'history-test',instructions:'minimal',onEvent(){},onFailure(){}});s.emit('open');s.emit('message',Buffer.from(JSON.stringify({type:'session.created',event_id:'ready',session:{id:'native-test'}})),false);
 assert.equal(JSON.stringify(profile),before);assert.deepEqual(sent[0].extension.dialog.dialog_context,history);
 const pending=p.verifyHistory();s.emit('message',Buffer.from(JSON.stringify({type:'conversation.item.retrieved',items:history.map(h=>({role:h.role,content:[{type:'input_text',text:h.text}]}))})),false);assert.equal(await pending,true);assert.equal((await p.close()).acknowledged,true);
});
