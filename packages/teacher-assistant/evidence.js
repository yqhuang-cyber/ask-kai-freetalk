import {VERSION} from './contracts.js';
import {diningQuestion,diningAnswer,observeDining,observeOrganization,ANALYSIS_VERSION} from './report-observations.js';
export {observeDining} from './report-observations.js';
export class EvidenceRecorder {
  constructor({attemptId,sessionId,planHash,plan}){
    Object.assign(this,{attemptId,sessionId,planHash});this.plan=plan;
    this.dining=!plan||(plan.pack.topic==='点餐'&&(plan.schema_version==='homework-v1'||plan.brief?.kind==='dining'));
    this.seen=new Set();this.responseIds=new Set();this.observations=[];this.organization=[];this.help=[];this.responses=new Map();this.replies=[];this.interactions=[];this.truncated=false;this.questionCount=0;
  }
  input(event){
    if(this.closed||event.type!=='user.final'||(event.session_id&&event.session_id!==this.sessionId)||this.seen.has(event.turn_id))return false;
    if(this.seen.size>=1000){this.truncated=true;return false;}
    const facts=observeDining(event.payload.text),prompt=this.pendingPrompt;
    this.pendingPrompt=null;
    if(prompt&&prompt.turn_id===this.latestTurn&&this.responses.size===0){
      const interpretation=diningAnswer(prompt.kind,event.payload.text,facts);
      if(interpretation){
        if(this.interactions.length<24)this.interactions.push({prompt,answer:{event_id:event.event_id,turn_id:event.turn_id,excerpt:event.payload.text},interpretation,relation:'delivery_order_only',support_basis:'unknown'});
        else this.truncated=true;
      }
    }
    this.seen.add(event.turn_id);this.latestTurn=event.turn_id;
    for(const fact of observeOrganization(event.payload.text)){
      if(this.organization.length<24)this.organization.push({...fact,event_id:event.event_id,turn_id:event.turn_id});else this.truncated=true;
    }
    for(const fact of facts){if(this.plan&&!this.plan.goals.some(g=>g.id===fact.goal_id&&g.observation_rule!=='unassessed'))continue;if(this.observations.length<24)this.observations.push({...fact,event_id:event.event_id,turn_id:event.turn_id,support_basis:'unknown'});else this.truncated=true;}
    if(!/[“”「」『』"‘’]|他说|她说|老师说/u.test(event.payload.text)&&/^(?:请|可以|能不能)?(?:帮我|我不会说|给我示范|示范|这(?:句|个).{0,20}怎么说|用中文怎么说|can you help|help|how (?:do|can) I say)/iu.test(event.payload.text)){
      if(this.help.length<12)this.help.push({event_id:event.event_id,turn_id:event.turn_id});else this.truncated=true;
    }
    return true;
  }
  forward(packet){
    if(this.closed)return;
    const e=packet.type==='event'?packet.event:null;
    if(!e||packet.speech_control||(e.session_id&&e.session_id!==this.sessionId))return;
    if(e.type==='response.started'){
      if(this.responseIds.has(e.response_id))return;
      this.pendingPrompt=null;
      if(this.responseIds.size>=1000){this.truncated=true;return;}
      this.responseIds.add(e.response_id);
      if(this.responses.size<24)this.responses.set(e.response_id,{response_id:e.response_id,turn_id:e.turn_id,status:'interrupted',playback_confirmed:false,text:'',text_truncated:false});
      else this.truncated=true;
    }
    const r=this.responses.get(e.response_id);
    if(!r||e.turn_id!==r.turn_id)return;
    if(e.type==='response.text.delta'){
      const text=r.text+e.payload.text;r.text=text.slice(0,320);r.text_truncated||=text.length>320;
    }
    if(['response.done','response.cancelled'].includes(e.type)){
      r.status=e.type==='response.done'?'done':'cancelled';
      const question=this.dining&&r.status==='done'&&!r.text_truncated&&r.turn_id===this.latestTurn?diningQuestion(r.text):null;
      if(question){this.questionCount++;if(this.replies.length<24)this.pendingPrompt={...question,event_id:e.event_id,response_id:r.response_id,turn_id:r.turn_id};else this.truncated=true;}
      else this.pendingPrompt=null;
      const {text,text_truncated,...metadata}=r;
      if(this.replies.length<24)this.replies.push(metadata);else this.truncated=true;
      this.responses.delete(e.response_id);
    }
  }
  finalize({endReason='student_end',providerKind,ready=false}){
    if(this.snapshot)return structuredClone(this.snapshot);
    this.closed=true;const suppressed=['authorization_revoked','safety_restricted'].includes(endReason);
    this.snapshot={schema_version:VERSION,attempt_id:this.attemptId,session_id:this.sessionId,plan_hash:this.planHash,voice_source:providerKind==='doubao'?'doubao':'synthetic',ready:!!ready,end_reason:endReason,final_turns:suppressed?0:this.seen.size,observations:suppressed?[]:this.observations,help_requests:suppressed?[]:this.help,replies:suppressed?[]:[...this.replies,...[...this.responses.values()].map(({text,text_truncated,...r})=>r)].slice(0,24),truncated:this.truncated||this.replies.length+this.responses.size>24,support_causality:'unknown',mastery:'unassessed',pronunciation:'unassessed',analysis_version:ANALYSIS_VERSION,interactions:suppressed?[]:this.interactions,recognized_questions:suppressed?0:this.questionCount};
    this.snapshot.organization_observations=suppressed?[]:this.organization;
    this.responses.clear();this.seen.clear();this.responseIds.clear();this.pendingPrompt=null;
    return structuredClone(this.snapshot);
  }
}
