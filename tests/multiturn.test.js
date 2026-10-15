import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,symlink,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { selectCases,profileMemory,readAudioManifest,sha256 } from '../apps/eval-runner/src/multiturn-plan.js';
import { runMultiturn,runPreflight,privateRunDirectory,writeRunCheckpoint } from '../apps/eval-runner/src/multiturn.js';
import { synthesizeInput,prepareInputAudio } from '../apps/eval-runner/src/input-audio.js';
import { protocolPeer,fixtureCases,fixtureInputs } from './helpers/multiturn.js';

const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url)));
const reviewed=()=>{const p=structuredClone(template);p.reviewed=p.realtime.reviewed=p.realtime.ordered_acks_reviewed=true;return p;};
const prepared=JSON.parse(await readFile(new URL('../docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json',import.meta.url)));
const versions={candidateRevision:'a'.repeat(40),datasetVersion:'fixture-v1',datasetSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)};

test('prepared selection excludes all reference/gold/soft-goal fields; full original and contrast cases are selectable',()=>{
  const selected=selectCases(prepared);assert.equal(selected.length,1);assert.equal(selected[0].turns.length,4);
  assert.deepEqual(Object.keys(selected[0].turns[0]),['turn','text','dependency']);
  assert.deepEqual(selected[0].initial_profile,{support_language:'auto',chinese_comprehension:'unknown',known_expressions:[]});
  assert.ok(!JSON.stringify(selected).includes(prepared.cases[0].turns[0].reference_for_judge_only));
  const all=selectCases(prepared,{limit:100,includeLanguage:true});assert.equal(all.length,48);assert.equal(all.reduce((n,c)=>n+c.turns.length,0),255);
  assert.throws(()=>selectCases(prepared,{caseIds:['missing']}),/UNKNOWN_RUN_CASE/);
  assert.throws(()=>selectCases(prepared,{caseIds:['ask-kai-language-01']}),/UNKNOWN_RUN_CASE/);
  assert.equal(selectCases(prepared,{caseIds:['ask-kai-language-03'],includeLanguage:true})[0].initial_profile.chinese_comprehension,'comfortable');
});
test('unknown initial state stays unknown, declared fixture preferences pass the same HSKai validation',()=>{
  const unknown=profileMemory({support_language:'auto',chinese_comprehension:'unknown',known_expressions:[]});
  assert.deepEqual(unknown.map(r=>r.field),['support_language']);
  const full=profileMemory({support_language:'zh',chinese_comprehension:'comfortable',known_expressions:['再见']});assert.equal(full.length,3);
  assert.throws(()=>profileMemory({support_language:'unsafe',chinese_comprehension:'unknown',known_expressions:[]}),/INVALID_MEMORY/);
});
test('preflight is offline and refuses unreviewed/probe profiles, absent key/audio, dirty candidate and synthetic input',()=>{
  const cases=fixtureCases(),inputs=fixtureInputs(cases);
  let p=runPreflight({cases,profile:template,inputs,env:{},worktreeClean:false});
  assert.equal(p.provider_calls,0);assert.equal(p.judge_calls,0);assert.equal(p.live_eligible,false);
  assert.ok(p.blockers.includes('candidate_worktree_not_clean'));assert.ok(p.blockers.includes('synthetic_audio_not_live_input'));
  const scoped=reviewed();scoped.realtime.review_scope='protocol_smoke';assert.equal(runPreflight({cases,profile:scoped,inputs,env:{DOUBAO_API_KEY:'fixture'}}).live_eligible,false);
  const valid=new Map([...inputs].map(([k,v])=>[k,{...v,source:'authored_tts'}]));
  assert.equal(runPreflight({cases,profile:reviewed(),inputs:valid,env:{DOUBAO_API_KEY:'fixture'}}).live_eligible,true);
  assert.ok(runPreflight({cases,profile:reviewed(),env:{DOUBAO_API_KEY:'fixture'}}).blockers.includes('input_audio_manifest_required'));
});
test('audio manifest binds dataset, scripts, bytes and provenance; rejects corruption, silence and escaping symlinks',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kai-input-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const cases=fixtureCases([['你好']]),bytes=Buffer.alloc(640,1),path=join(root,'manifest.json');
  await writeFile(join(root,'input.pcm'),bytes);
  const base={version:1,kind:'ask-kai-eval-input-audio',dataset_sha256:'b'.repeat(64),format:'pcm_s16le',sample_rate:16000,channels:1,entries:[{case_id:cases[0].id,turn:1,path:'input.pcm',source:'authored_tts',bytes:640,sha256:sha256(bytes),script_sha256:sha256(Buffer.from('你好'))}]};
  const check=async d=>{await writeFile(path,JSON.stringify(d));return readAudioManifest(path,cases,{datasetSha256:'b'.repeat(64)});};
  assert.equal((await check(base)).inputs.size,1);
  for(const [mutate,error] of [[d=>d.entries[0].script_sha256='a'.repeat(64),'AUDIO_SCRIPT_MISMATCH'],[d=>d.entries[0].sha256='a'.repeat(64),'AUDIO_HASH_MISMATCH'],[d=>d.entries[0].bytes=642,'AUDIO_SIZE_MISMATCH'],[d=>d.entries=[],'MISSING_TURN_AUDIO'],[d=>d.entries.push(d.entries[0]),'INVALID_AUDIO_ENTRY'],[d=>d.entries[0].path='../other.pcm','INVALID_AUDIO_ENTRY']]) {
    const d=structuredClone(base);mutate(d);await assert.rejects(check(d),new RegExp(error));
  }
  const outside=await mkdtemp(join(tmpdir(),'kai-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await writeFile(join(outside,'input.pcm'),bytes);await symlink(join(outside,'input.pcm'),join(root,'link.pcm'));
  const escaped=structuredClone(base);escaped.entries[0].path='link.pcm';await assert.rejects(check(escaped),/AUDIO_OUTSIDE/);
  const silence=Buffer.alloc(640);await writeFile(join(root,'input.pcm'),silence);const d=structuredClone(base);d.entries[0].sha256=sha256(silence);await assert.rejects(check(d),/SILENT_TURN_AUDIO/);
});
test('multi-turn collection uses actual production adapter and authorized gateway; context updates and cases are isolated',async t=>{
  const scripts=[['你好','再见'],['只用中文','再见']],outputs=[['你好。Hello.','再见。Bye.'],['好的。','再见。']];
  const peer=await protocolPeer(t,{scripts,outputs,contextDelayMs:30}),cases=fixtureCases(scripts),snapshots=[];
  cases[0].turns[1].dependency={type:'prior_reply_semantics',source_turns:[1],condition:'authored dependency'};
  cases[1].initial_profile={support_language:'zh',chinese_comprehension:'comfortable',known_expressions:['再见']};
  const r=await runMultiturn({cases,inputs:fixtureInputs(cases),profile:reviewed(),providerKind:'test',providerFactory:peer.providerFactory(reviewed()),...versions,turnTimeoutMs:3000,checkpoint:async(o,p)=>snapshots.push(structuredClone(p))});
  assert.equal(r.report.status,'observations_collected');assert.equal(r.report.collected_turns,4);assert.equal(r.report.live_provider_sessions,0);assert.equal(r.observations.execution,'synthetic_fixture');assert.equal(r.observations.scores_present,false);
  assert.deepEqual(r.observations.cases.map(c=>c.turns.map(t=>t.actual_kai)),outputs);
  assert.ok(r.observations.cases.every(c=>c.summary.business_source==='mock_hskai'));
  assert.ok(r.observations.cases[0].turns[0].diagnostics.some(d=>d.name==='context.applied'));
  assert.ok(r.observations.cases.every(c=>c.turns.every(t=>t.context_update_confirmed&&t.diagnostics.some(d=>d.name==='context.applied'))));
  assert.deepEqual(r.observations.cases[0].turns.map(t=>t.next_turn_context_version),[2,3]);
  assert.deepEqual(r.report.cases[0].dependency_review_turns,[2]);assert.equal(r.observations.history_source,'actual_provider_session_only');
  assert.equal(peer.sessions.length,2);assert.deepEqual(peer.sessions.map(s=>s.inputs),scripts);
  for(const c of r.observations.cases)for(const turn of c.turns){assert.equal(turn.author_provider_association.case_id,c.case_id);assert.equal(turn.author_provider_association.status,'single');assert.equal(turn.author_provider_association.eligible_as_complete_turn,true);assert.equal(turn.author_provider_association.semantic_alignment_verified,false);}
  assert.ok(peer.sessions[0].instructions[0].includes('自由聊天'));assert.ok(!peer.sessions[0].instructions[0].includes('足球","source'));
  assert.ok(peer.sessions[1].instructions[0].includes('comfortable'));assert.ok(!peer.sessions[1].instructions[0].includes('Hello.'));
  assert.ok(peer.requests.every(r=>!['conversation.item.create','speech_text_buffer.commit'].includes(r.type)));
  assert.ok(snapshots.some(s=>s.collected_turns===1));
});
test('ASR drift is recorded for review without replacing actual transcript or claiming content passes',async t=>{
  const peer=await protocolPeer(t,{scripts:[['你好']],outputs:[['你好。Hello.']],asrOverride:'你好吗'}),cases=fixtureCases([['你好']]);
  const r=await runMultiturn({cases,inputs:fixtureInputs(cases),profile:reviewed(),providerKind:'test',providerFactory:peer.providerFactory(reviewed()),...versions,turnTimeoutMs:3000});
  assert.equal(r.observations.cases[0].turns[0].actual_student_transcript,'你好吗');assert.equal(r.observations.cases[0].turns[0].script_input,'你好');assert.deepEqual(r.report.cases[0].asr_review_turns,[1]);assert.equal(r.report.needs_review,true);assert.equal(r.report.content_scored,false);
});
test('timeout retains prior replies and a partial failed turn; subsequent case gets a fresh session',async t=>{
  const scripts=[['你好','再见'],['你好']],outputs=[['你好。Hello.','再见。Bye.'],['你好。Hello.']];
  const peer=await protocolPeer(t,{scripts,outputs,omitReplyTurn:2}),cases=fixtureCases(scripts);
  const r=await runMultiturn({cases,inputs:fixtureInputs(cases),profile:reviewed(),providerKind:'test',providerFactory:peer.providerFactory(reviewed()),...versions,turnTimeoutMs:1000});
  assert.equal(r.report.status,'incomplete');assert.equal(r.observations.cases[0].failure,'TURN_TIMEOUT');assert.equal(r.observations.cases[0].turns[0].actual_kai,outputs[0][0]);assert.equal(r.observations.cases[0].turns[1].reply_complete,false);assert.equal(r.observations.cases[0].turns[1].actual_kai,null);assert.equal(r.observations.cases[0].turns[1].actual_student_transcript,'再见');assert.equal(r.observations.cases[1].status,'collected');
});
test('reply bound to a foreign question cannot become the current student reply',async t=>{
  const peer=await protocolPeer(t,{scripts:[['你好']],outputs:[['foreign reply']],foreignTurn:true}),cases=fixtureCases([['你好']]);
  const r=await runMultiturn({cases,inputs:fixtureInputs(cases),profile:reviewed(),providerKind:'test',providerFactory:peer.providerFactory(reviewed()),...versions,turnTimeoutMs:1000});
  assert.equal(r.report.status,'incomplete');assert.equal(r.report.collected_turns,0);
  assert.equal(r.observations.cases[0].turns[0].actual_kai,null);
  assert.equal(r.observations.cases[0].turns[0].actual_student_transcript,'你好');
});
test('aborted collection performs no provider session and preserves an incomplete report',async()=>{
  const c=new AbortController();c.abort();let opened=0;const cases=fixtureCases();
  const r=await runMultiturn({cases,inputs:fixtureInputs(cases),providerKind:'test',providerFactory:()=>{},signal:c.signal,...versions,openSession:async()=>{opened++;}});
  assert.equal(opened,0);assert.equal(r.report.status,'incomplete');assert.equal(r.report.cases[0].failure,'RUN_ABORTED');
});
test('input TTS uses only student text, resamples to PCM16k and verifies graceful close without scoring it',async t=>{
  const peer=await protocolPeer(t),profile=reviewed();
  const pcm=await synthesizeInput({text:'你好',profile,env:{DOUBAO_API_KEY:'fixture-only-key'},socketFactory:peer.socketFactory,timeoutMs:2000});
  assert.ok(pcm.length>640&&pcm.length<4800);assert.equal(pcm.length%2,0);assert.ok(pcm.some(v=>v!==0));
  assert.deepEqual(peer.requests.filter(r=>r.type==='speech_text_buffer.commit').map(r=>r.text),['你好']);assert.ok(peer.requests.some(r=>r.type==='input_audio_mute.commit'));assert.ok(peer.requests.some(r=>r.type==='session.close'));
});
test('audio preparation caches repeated student inputs and preserves a partial manifest on failure',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kai-prepare-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;const scripts=[['你好','你好','再见']];
  await assert.rejects(prepareInputAudio({cases:fixtureCases(scripts),datasetSha256:'b'.repeat(64),profile:reviewed(),directory:root,synthesize:async()=>{if(++calls===2)throw new Error('TTS_TIMEOUT');return Buffer.alloc(640,1);}}),/TTS_TIMEOUT/);
  const m=JSON.parse(await readFile(join(root,'audio-manifest.json')));assert.equal(m.status,'partial');assert.equal(m.entries.length,2);assert.equal(m.entries[0].path,m.entries[1].path);assert.equal(calls,2);assert.equal((await stat(join(root,m.entries[0].path))).mode&0o777,0o600);
});
test('private artifacts exclude transcript from summary report and reject tracked output/overwrite',async t=>{
  await assert.rejects(privateRunDirectory('docs/should-not-write'),/PRIVATE/);
  const path=`.local/eval-test-${randomUUID()}`,directory=await privateRunDirectory(path);t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(privateRunDirectory(path),{code:'EEXIST'});
  await writeRunCheckpoint(directory,{actual_kai:'private actual reply'},{status:'incomplete'});
  assert.ok(!(await readFile(join(directory,'report.json'),'utf8')).includes('private actual reply'));assert.equal((await stat(join(directory,'observations.json'))).mode&0o777,0o600);
});
test('CLI default does offline preflight; malformed/unknown selection and blocked live calls never execute',()=>{
  const call=args=>spawnSync(process.execPath,['scripts/multiturn-eval.js',...args],{encoding:'utf8',env:{...process.env,DOUBAO_API_KEY:'',DOUBAO_REALTIME_PROFILE:''}});
  const p=call([]);assert.equal(p.status,0);assert.equal(JSON.parse(p.stdout).provider_calls,0);
  const live=call(['--live']);assert.equal(live.status,1);assert.match(live.stderr,/PREFLIGHT_BLOCKED/);assert.equal(JSON.parse(live.stdout).provider_calls,0);
  assert.equal(call(['--case','foreign-case']).status,1);assert.equal(call(['--all','--limit','3']).status,1);assert.equal(call(['--turn-timeout-ms','NaN']).status,1);
});
