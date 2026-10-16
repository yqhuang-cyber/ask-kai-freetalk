import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openAgentHarness} from '../apps/eval-runner/src/agent-harness.js';
import {wavPCM} from './prepare-fc-probe-inputs.js';
// A bounded two-input real-provider check. No microphone or external TTS, no raw
// traces/response transcripts written to disk or emitted in the result.
if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,provider_calls:0,requires:'--live and configured local Doubao profile/key'}));
else {
  let session,currentInput,currentAudio,completedReplies=0,stage='prepare';
  try {
    const directory='.local/closing-probe-inputs';await mkdir(directory,{recursive:true,mode:0o700});
    const texts=['我今天坐地铁上班。这里的坐是什么意思？','就聊到这儿吧。'];const inputs=[];
    for(let i=0;i<texts.length;i++){
      const path=`${directory}/turn-${i+1}`;execFileSync('/usr/bin/say',['-v','Tingting','-o',path+'.aiff',texts[i]]);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
      const bytes=wavPCM(await readFile(path+'.wav'));inputs.push({bytes,source:'local_os_authored_speech',sha256:createHash('sha256').update(bytes).digest('hex'),duration_ms:bytes.length/32});
    }
    const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
    stage='connect';session=await openAgentHarness({profile,env:process.env,initialProfile:{support_language:'zh',chinese_comprehension:'comfortable',known_expressions:[]},caseId:'closing-probe',turnTimeoutMs:45000});
    const turns=[];
    for(let i=0;i<2;i++){stage=`turn-${i+1}`;currentInput={turn:i+1,text:texts[i],dependency:{type:'none',source_turns:[]}};currentAudio=inputs[i];turns.push(await session.turn(currentInput,currentAudio));completedReplies++;}
    const final=await session.finish();
    console.log(JSON.stringify({kind:'closing_voice_probe',real_provider:true,input_source:'local_os_authored_speech',microphone_uploaded:false,provider_sessions:1,completed_replies:turns.length,closing_mentions_actual_content:/(?:地铁|坐|上班)/u.test(turns[1].actual_kai),closing_farewell_observed:/(?:再见|拜拜|下次见)/u.test(turns[1].actual_kai),closing_question_observed:/[?？]/u.test(turns[1].actual_kai),summary_knowledge_items:final.summary?.session_recap?.knowledge_points.length??0,summary_has_requested_word:final.summary?.session_recap?.knowledge_points.some(k=>k.text==='坐')??false,session_terminal:final.session_terminal,failure:final.failure,playback_measured:false,controlled_generation_verified:false,real_experience_accepted:false}));
  }catch(error){const snapshot=session&&currentInput?session.snapshotTurn(currentInput,currentAudio):null;console.log(JSON.stringify({stage,completed_replies:completedReplies,asr_observed:!!snapshot?.actual_student_transcript,model_reply_complete:snapshot?.model_reply_complete??false,reply_fragments:snapshot?.reply_fragments?.length??0,last_diagnostics:snapshot?.diagnostics?.slice(-5).map(d=>d.name)??[],kind:'closing_voice_probe',status:'incomplete',failure:/^[A-Z_]{1,80}$/.test(error.message)?error.message:'PROBE_FAILED',microphone_uploaded:false,real_experience_accepted:false}));process.exitCode=1;}
  finally{await session?.close();}
}
