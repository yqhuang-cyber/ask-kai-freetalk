import test from 'node:test';
import assert from 'node:assert/strict';
import {authoredInputEvidence,pcmWave,trimAuthoredPcm} from '../evidence.js';
test('authored pace evidence accepts Unicode compatibility forms while preserving language and negation',()=>{
  const expected='中文慢慢说，英文正常说。';
  assert.equal(authoredInputEvidence('中⽂慢慢说，英⽂正常说。',expected).canonical_exact,true);
  assert.equal(authoredInputEvidence('中⽂慢慢说，英⽂正常说。',expected).legacy_exact,false);
  for(const wrong of ['中文不用慢慢说，英文正常说。','英文慢慢说，中文正常说。','中文慢慢说。','“中文慢慢说”是什么意思？']){
    assert.equal(authoredInputEvidence(wrong,expected).accepted,false);
  }
  assert.equal(authoredInputEvidence('请用中文慢慢说，英文正常说。',expected,['请用中文慢慢说，英文正常说。']).accepted,true);
  const homophone=authoredInputEvidence('中午慢慢说，英文正常说。',expected);
  assert.equal(homophone.accepted,false);assert.equal(homophone.diagnostic_homophone_repair_matches,true);
});
test('authored demonstration trimming preserves sound and only shortens silent edges',()=>{
  const pcm=Buffer.alloc(16000);
  for(let i=6400;i<9600;i+=2)pcm.writeInt16LE(1000,i);
  const trimmed=trimAuthoredPcm(pcm);
  assert.equal(trimmed.length,4480);
  assert.equal(trimmed.readInt16LE(640),1000);
  assert.throws(()=>trimAuthoredPcm(Buffer.alloc(3200)));
});
test('authored PCM review clips preserve sample rate and duration in WAV headers',()=>{
  const pcm=Buffer.alloc(4800),wav=pcmWave(pcm);
  assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt32LE(40),4800);
  assert.equal(wav.length,4844);assert.deepEqual(wav.subarray(44),pcm);
  assert.throws(()=>pcmWave(Buffer.alloc(3)));
});
