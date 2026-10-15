import test from 'node:test';
import assert from 'node:assert/strict';
import { reframeAuthoredTts } from '../apps/eval-runner/src/input-audio.js';

test('authored TTS reframing preserves PCM bytes, order and owner with production-sized chunks',()=>{
  const rows=[],provider=reframeAuthoredTts({receive:raw=>rows.push(raw)});
  const pcm=Buffer.alloc(196608);for(let i=0;i<pcm.length;i++)pcm[i]=i%251;
  provider.receive({type:'response.output_audio.delta',response_id:'owner',question_id:'turn',delta:pcm.toString('base64')});
  assert.equal(rows.length,3);assert.ok(rows.every(r=>r.response_id==='owner'&&r.question_id==='turn'&&Buffer.from(r.delta,'base64').length<=65536));
  assert.deepEqual(Buffer.concat(rows.map(r=>Buffer.from(r.delta,'base64'))),pcm);
});
test('authored TTS keeps ordinary messages unchanged and rejects oversized malformed PCM',()=>{
  const rows=[],provider=reframeAuthoredTts({receive:raw=>rows.push(raw)}),control={type:'response.output_audio.done',response_id:'owner'};
  provider.receive(control);assert.equal(rows[0],control);
  for(const delta of ['!'.repeat(90000),Buffer.alloc(65539).toString('base64'),Buffer.alloc(1440002).toString('base64')])assert.throws(()=>provider.receive({type:'response.output_audio.delta',delta}),/INVALID_PROVIDER_AUDIO/);
  assert.equal(rows.length,1);
});
