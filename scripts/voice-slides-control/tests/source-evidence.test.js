import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourceEvidenceLedger,normalizeSource,withSourceEvidence} from '../source-evidence.js';
import {SLIDES_TOOL} from '../../../packages/contracts/ui-actions.js';
import {SlidesCoordinator} from '../../../apps/realtime-gateway/src/slides-coordinator.js';
test('source matching preserves words; only punctuation, spacing, case and ordinal digit forms normalize',()=>{
  assert.equal(normalizeSource('请回第２页。'),normalizeSource('请回第二页！'));
  assert.notEqual(normalizeSource('先不要翻页'),normalizeSource('翻页'));
  assert.notEqual(normalizeSource('他说“上一页”'),normalizeSource('上一页'));
  assert.throws(()=>normalizeSource(' !!! '),/INVALID_SOURCE_TEXT/);
  const ledger=new SourceEvidenceLedger();ledger.begin('i1');ledger.complete('i1','帮我回到上一页。');
  assert.equal(ledger.claim('c1','回到上一页','previous').reason,'SOURCE_NOT_RECOGNIZED');
  assert.equal(ledger.claim('c2','帮我回到上一页','previous').input_id,'i1');ledger.close();
});
test('an old call arriving after any new candidate is rejected rather than assigned to latest',()=>{
  const ledger=new SourceEvidenceLedger();ledger.begin('old');ledger.complete('old','帮我上一页');ledger.begin('new');
  assert.equal(ledger.claim('late','帮我上一页','previous').reason,'SOURCE_NOT_CURRENT');
  ledger.complete('new','算了不要翻了');assert.equal(ledger.claim('cancel','算了不要翻了','cancel').input_id,'new');
});
test('identical repeated inputs remain ambiguous even after the first result; no history eviction shortcut',()=>{
  const ledger=new SourceEvidenceLedger();ledger.begin('one');ledger.complete('one','上一页');
  assert.equal(ledger.claim('first','上一页','previous').input_id,'one');
  ledger.begin('two');ledger.complete('two','上一页');
  assert.equal(ledger.claim('second','上一页','previous').reason,'SOURCE_AMBIGUOUS');
  // The learner answers the associated clarification after that reply has finished.
  ledger.settleReply('two');
  ledger.begin('three');ledger.complete('three','请再往前翻一页');assert.equal(ledger.claim('third','请再往前翻一页','previous').input_id,'three');
});
test('a duplicate call retains original ownership and conflicts cannot mutate or apply again',()=>{
  const ledger=new SourceEvidenceLedger();ledger.begin('one');ledger.complete('one','上一页');
  const accepted=ledger.claim('call','上一页','previous');ledger.begin('two');ledger.complete('two','不要翻页');
  assert.equal(ledger.claim('call','上一页！','previous'),accepted);
  assert.equal(ledger.claim('call','不要翻页','previous').reason,'SOURCE_CALL_CONFLICT');
  assert.equal(ledger.claim('call','上一页','goto').reason,'SOURCE_CALL_CONFLICT');
});
test('missing start, conflicting final, expiry and capacity fail without guessing an owner',()=>{
  const unbound=new SourceEvidenceLedger();unbound.complete('unknown','上一页');assert.equal(unbound.claim('c','上一页','previous').reason,'SOURCE_UNBOUND_FINAL');
  const conflicting=new SourceEvidenceLedger();conflicting.begin('i');conflicting.complete('i','上一页');conflicting.complete('i','下一页');
  assert.equal(conflicting.claim('c','下一页','previous').reason,'SOURCE_FINAL_CONFLICT');
  let time=0;const expired=new SourceEvidenceLedger({now:()=>time,maxAgeMs:10});expired.begin('i');expired.complete('i','上一页');time=11;
  assert.equal(expired.claim('c','上一页','previous').reason,'SOURCE_EXPIRED');
  const bounded=new SourceEvidenceLedger({limit:1});bounded.begin('i');bounded.complete('i','上一页');bounded.begin('j');
  assert.equal(bounded.claim('c','上一页','previous').reason,'SOURCE_INPUT_LIMIT');bounded.close();
  assert.equal(bounded.claim('c','上一页','previous').reason,'SOURCE_SESSION_CLOSED');
});
test('source schemas are isolated clones and cannot alter the ordinary navigation contract',()=>{
  const [tool]=withSourceEvidence([SLIDES_TOOL]);assert.deepEqual(tool.parameters.required,['action','source_text']);
  assert.equal(SLIDES_TOOL.parameters.properties.source_text,undefined);
});
test('an unresolved older ASR mismatch cannot be relabeled as a later matching input',()=>{
  const ledger=new SourceEvidenceLedger();ledger.begin('old');ledger.complete('old','上衣也');
  ledger.begin('current');ledger.complete('current','上一页');
  assert.equal(ledger.claim('late','上一页','previous').reason,'SOURCE_UNRESOLVED_INPUT');
  assert.equal(ledger.claim('late','上一页','previous').reason,'SOURCE_UNRESOLVED_INPUT');
});
test('a provider-owned complete ordinary reply releases only its own unresolved input',()=>{
  const ledger=new SourceEvidenceLedger();ledger.begin('chat');ledger.complete('chat','这个词是什么意思');ledger.settleReply('chat');
  ledger.begin('review');ledger.complete('review','请回到第一页');assert.equal(ledger.claim('call','请回到第一页','goto1').input_id,'review');
});
test('accepted work survives ordinary new speech; unaccepted late work never enters the coordinator',async()=>{
  const ledger=new SourceEvidenceLedger(),packets=[];
  const coor=new SlidesCoordinator({sessionId:'s',viewerId:'v',generation:'g',send:p=>packets.push(p)});
  for(let page=1;page<=3;page++){const result=coor.present(page,{requestId:'host'+page});const p=packets.at(-1);coor.receive({type:'slides.ack',session_id:'s',viewer_instance_id:'v',generation:'g',deck_id:'kai-demo',deck_version:'1',command_id:p.command_id,page:p.page,revision:p.revision,status:'applied'});await result;}
  ledger.begin('a');ledger.complete('a','帮我回到上一页');const claim=ledger.claim('accepted','帮我回到上一页','previous');assert.equal(claim.status,'matched');
  const result=coor.execute({action:'previous'},{requestId:'accepted'});ledger.begin('b');ledger.complete('b','你刚才说的是什么意思');
  assert.equal(ledger.claim('late','帮我回到上一页','previous').reason,'SOURCE_NOT_CURRENT');
  const p=packets.at(-1);coor.receive({type:'slides.ack',session_id:'s',viewer_instance_id:'v',generation:'g',deck_id:'kai-demo',deck_version:'1',command_id:p.command_id,page:p.page,revision:p.revision,status:'applied'});
  assert.equal((await result).page,2);assert.equal(coor.snapshot().page,2);coor.close();ledger.close();
});
