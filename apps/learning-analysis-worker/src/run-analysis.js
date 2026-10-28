import {ReportAnalyzer} from '../../../packages/teacher-assistant/report.js';
import {audioEligibility,verifiedAudioReference} from '../../../packages/provider-tencent-soe/assessment.js';
const terminal=['complete','partial'];
function reason(error){if(['AbortError','TimeoutError'].includes(error?.name))return 'deadline';const code=error?.message??'';return /AUTHORIZ|PURPOSE|NOTICE|EXPIRED/.test(code)?'not_authorized':/RESTRICTED/.test(code)?'restricted_content':/NOT_ENABLED/.test(code)?'not_enabled':/TIMEOUT|ABORT|LEASE/.test(code)?'deadline':/OUTPUT|SEMANTIC|INVALID|REFERENCE/.test(code)?'output_rejected':'provider_failed';}
export async function runClaimedAnalysis({job,call,textAnalyzer,audioPort,signal,heartbeatMs=5000}){
  const ref={job_id:job.job_id,lease_id:job.lease_id},report=new ReportAnalyzer().analyze(job.plan,job.evidence,job.attempt);
  if(!job.deep){await call('commit',{...ref,source_hash:job.source_hash,report});return;}
  const root=new AbortController(),controllers={text:new AbortController(),audio:new AbortController()},combined=signal?AbortSignal.any([root.signal,signal,AbortSignal.timeout(120000)]):AbortSignal.any([root.signal,AbortSignal.timeout(120000)]);
  let checking=false;const heartbeat=async()=>{if(checking)return;checking=true;try{const status=await call('heartbeat',ref);for(const kind of ['text','audio'])if(status.stages?.[kind]==='not_authorized')controllers[kind].abort();}catch{root.abort();}finally{checking=false;}};
  const timer=setInterval(()=>void heartbeat(),heartbeatMs);timer.unref?.();
  const skip=async(branch,why)=>{try{await call('stage_skip',{...ref,branch,reason:why});}catch{/* Source deletion or an expired lease forbids further writes. */}};
  try{
    await call('commit_base',{...ref,source_hash:job.source_hash,report});
    const text=async()=>{
      if(terminal.includes(job.deep.stages.text.state)||job.deep.stages.text.state==='not_authorized')return;
      if(job.deep.stages.text.provider==='none')return skip('text','not_enabled');
      if(!textAnalyzer?.transport)return skip('text','not_configured');
      const current=AbortSignal.any([combined,controllers.text.signal]);let authorization;
      try{const input=await call('read_text',ref);if(input.state!=='available'||!input.snapshot.transcript.some(s=>s.role==='learner'&&s.kind==='content'))return skip('text','source_unavailable');
        const resumed=await call('stage_resume',{...ref,branch:'text'});const result=await textAnalyzer.analyze(job.plan,input.snapshot,{previous:resumed.result,signal:current,beforeCall:async progress=>{current.throwIfAborted();authorization=await call('stage_authorize',{...ref,branch:'text',progress});current.throwIfAborted();},onProgress:async progress=>{current.throwIfAborted();if(authorization)await call('stage_progress',{...ref,branch:'text',call_id:authorization.call_id,progress});}});current.throwIfAborted();
        if(!authorization)return skip('text','source_unavailable');await call('stage_commit',{...ref,branch:'text',call_id:authorization.call_id,result});
      }catch(e){await skip('text',reason(e));}
    };
    const audio=async()=>{
      if(terminal.includes(job.deep.stages.audio.state)||job.deep.stages.audio.state==='not_authorized')return;
      if(job.deep.stages.audio.provider==='none')return skip('audio','not_enabled');
      if(!audioPort)return skip('audio','not_configured');
      const current=AbortSignal.any([combined,controllers.audio.signal,AbortSignal.timeout(90000)]);let authorization;const assessments=[],skipped=[];
      try{const input=await call('read_audio_manifest',ref);if(input.state!=='available'||!input.manifest.segment_refs.length)return skip('audio','source_unavailable');
        const resumed=await call('stage_resume',{...ref,branch:'audio'}),previous=new Map((resumed.result?.assessments??[]).map(a=>[a.audio.id,a]));let attempts=0;
        for(const segment of input.manifest.segment_refs){
          if(previous.has(segment.id)){assessments.push(previous.get(segment.id));continue;}
          if(current.aborted||assessments.length>=12||attempts>=12){skipped.push({id:segment.id,reason:'budget_limit'});continue;}
          let source;try{source=await call('read_audio',{...ref,segment_id:segment.id});if(source.state!=='available')throw new Error('INPUT_UNAVAILABLE');}catch{skipped.push({id:segment.id,reason:'input_unavailable'});continue;}
          const eligible=audioEligibility(source.segment);if(!eligible.eligible){skipped.push({id:segment.id,reason:eligible.reason});continue;}
          const reference=verifiedAudioReference(source.segment);
          try{const assessment=await audioPort.assess({...source,mode:reference?1:3,reference},{signal:current,beforeSend:async()=>{current.throwIfAborted();authorization=await call('stage_authorize',{...ref,branch:'audio',segment_id:segment.id,progress:{phase:'assessing',current:assessments.length+skipped.length+1,total:input.manifest.segment_refs.length,processed:assessments.length+skipped.length,attempt:1}});attempts++;current.throwIfAborted();}});current.throwIfAborted();if(Buffer.byteLength(JSON.stringify([...assessments,assessment]))>180000)skipped.push({id:segment.id,reason:'budget_limit'});else assessments.push(assessment);}
          catch(e){if(/AUTHORIZ|RECORD_|LEASE|STAGE_/.test(e.message))throw e;skipped.push({id:segment.id,reason:'provider_failed'});}
        }
        if(!authorization)return skip('audio','no_eligible_audio');current.throwIfAborted();await call('stage_commit',{...ref,branch:'audio',call_id:authorization.call_id,result:{schema_version:'audio-branch-v1',manifest_hash:input.manifest.manifest_hash,assessments,skipped}});
      }catch(e){await skip('audio',reason(e));}
    };
    await Promise.all([text(),audio()]);combined.throwIfAborted();await call('commit',{...ref,source_hash:job.source_hash,report});
  }finally{clearInterval(timer);root.abort();}
}
