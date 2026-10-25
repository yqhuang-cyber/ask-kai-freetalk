import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const names=process.argv.slice(2);
if(!names.length||names.some(n=>!/^bp\d+[a-z]*(?:retry)?$/.test(n)))throw new Error('INVALID_BILINGUAL_REPORT_SELECTION');
const sources=[],groups=new Map(),sampleEvidence=[];
const median=values=>{const a=[...values].sort((a,b)=>a-b);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
for(const name of names){
  const bytes=await readFile(`.local/${name}-result.json`),report=JSON.parse(bytes);
  sources.push({id:name,sha256:createHash('sha256').update(bytes).digest('hex'),status:report.status,
    samples:report.samples.length,error:report.error??null,stage:report.stage??null,
    closed_sessions:report.conditions.filter(c=>c.close_acknowledged).length,
    attempted_sessions:report.conditions.length});
  for(const sample of report.samples){
    const condition=report.conditions.find(c=>c.id===sample.condition);
    const group=sample.condition.replace(/_r\d+(?:_retry)?$/,'');
    const key=[group,sample.kind,sample.phase??'measurement'].join(':');
    if(!groups.has(key))groups.set(key,{group,kind:sample.kind,phase:sample.phase??'measurement',
      requested_voice:condition.voice??report.voice,speed:condition.speed,samples:[]});
    groups.get(key).samples.push(sample);
    sampleEvidence.push({source:name,condition:sample.condition,kind:sample.kind,phase:sample.phase??'measurement',
      input_accepted:sample.input_evidence?.accepted===true,target_matches:sample.output_matches_target,
      language_matches:sample.output_language_matches_case,complete:sample.audio_done&&sample.text_done,
      pcm_ms:sample.pcm_ms,energy_span_ms:sample.energy_span_ms,energy_active_ms:sample.energy_active_ms,
      first_pcm_after_input_ms:sample.first_pcm_after_input_ms??null});
  }
}
const summaries=[...groups.values()].map(({samples,...identity})=>{
  const valid=samples.filter(s=>s.input_evidence?.accepted&&s.output_matches_target!==false&&s.output_language_matches_case&&s.audio_done&&s.text_done&&s.energy_span_ms>0);
  const metrics={};
  for(const key of ['pcm_ms','energy_span_ms','energy_active_ms','units_per_second','first_pcm_after_input_ms']){
    const values=valid.map(s=>s[key]).filter(Number.isFinite);
    if(values.length)metrics[key]={median:Number(median(values).toFixed(3)),min:Math.min(...values),max:Math.max(...values)};
  }
  return {...identity,attempted:samples.length,valid:valid.length,invalid:samples.length-valid.length,
    metrics,review_clip_count:samples.filter(s=>s.authored_review_clip).length};
});
console.log(JSON.stringify({kind:'authored_bilingual_s2s_aggregate',version:1,
  human_listening_accepted:false,production_agent_changed:false,sources,groups:summaries,sample_evidence:sampleEvidence},null,2));
