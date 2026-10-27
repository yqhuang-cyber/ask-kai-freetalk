import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {AudioCandidateSegmenter} from '../packages/teacher-assistant/teaching-record/audio-segmenter.js';
const frame=value=>{const b=Buffer.alloc(640);for(let i=0;i<640;i+=2)b.writeInt16LE(value,i);return b;};
test('synthetic energy candidates have real sample ranges but no inferred student or text attribution',()=>{
  const s=new AudioCandidateSegmenter(),output=[];for(let i=0;i<5;i++)output.push(...s.push(frame(0)));for(let i=0;i<8;i++)output.push(...s.push(frame(1200)));for(let i=0;i<8;i++)output.push(...s.push(frame(0)));assert.equal(output.length,1);const a=output[0];assert.equal(a.sample_start,1600);assert.equal(a.sample_end,6720);assert.equal(a.pcm.length,(a.sample_end-a.sample_start)*2);assert.equal(a.sha256,createHash('sha256').update(a.pcm).digest('hex'));assert.equal(a.speaker,'unknown');assert.equal(a.alignment,null);assert.equal(a.quality.overlap,'unknown');
});
test('silence and brief impulses do not form candidates; candidate boundaries are bounded',()=>{
  const s=new AudioCandidateSegmenter({maxSegmentFrames:12,startFrames:3,tailFrames:2,maxSegments:1});for(let i=0;i<10;i++)assert.deepEqual(s.push(frame(0)),[]);assert.deepEqual(s.push(frame(1000)),[]);assert.deepEqual(s.push(frame(0)),[]);let first;for(let i=0;i<12;i++)first=s.push(frame(1200))[0]??first;assert.equal(first.boundary_reason,'capacity');for(let i=0;i<12;i++)s.push(frame(1200));assert.ok(s.droppedSamples>0);assert.deepEqual(s.finish(),[]);
});
test('clipping is surfaced, and unknown playback never proves no overlap',()=>{
  const s=new AudioCandidateSegmenter();for(let i=0;i<3;i++)s.push(frame(32767),{playback:'active'});const [a]=s.finish();assert.equal(a.quality.clipping,'detected');assert.equal(a.quality.overlap,'unknown');assert.throws(()=>s.push(frame(0)),/CLOSED/);
});
test('malformed format is rejected before advancing the source clock',()=>{const s=new AudioCandidateSegmenter();assert.throws(()=>s.push(Buffer.alloc(2)),/FRAME/);assert.equal(s.position,0);assert.throws(()=>new AudioCandidateSegmenter({sampleRate:48000}),/CONFIG/);});
