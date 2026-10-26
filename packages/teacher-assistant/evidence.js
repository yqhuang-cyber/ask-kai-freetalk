import {VERSION} from './contracts.js';
// Deliberately narrow authored rules. Anything outside the complete forms stays unassessed.
// No single keyword, third-party statement, quotation, question or uncertain ASR is evidence.
export function observeDining(raw){
  if(typeof raw!=='string'||raw.length>160||/[“”「」『』"‘’？?]|(?:他说|她说|老师说|可能|好像|也许|听不清|识别不确定|怎么说|什么意思|翻译)/u.test(raw))return [];
  const clauses=raw.trim().replace(/[。！!]+$/u,'').split(/[，,。；;]/u).map(s=>s.trim()).filter(Boolean);
  const found=[];
  for(const text of clauses){
    if(/^(?:我(?:想|要|想要)|请(?:给我)?|给我)(?:来)?(?:一(?:碗|份|盘))?(?:面条|面|米饭|饭|饺子|包子|炒饭|牛肉面|鸡肉)(?:吧|谢谢)?$/u.test(text))found.push({goal_id:'order_food',excerpt:text});
    if(/^(?:(?:我)?(?:要|想要|喜欢|想吃)(?:微辣|少辣|不辣|清淡|辣的|甜的|咸的)|(?:请)?(?:不要辣|不放辣椒|少放盐|少放辣椒|微辣|少辣|不辣|清淡一点))(?:吧|谢谢)?$/u.test(text))found.push({goal_id:'taste_preference',excerpt:text});
  }
  return found;
}
export class EvidenceRecorder {
  constructor({attemptId,sessionId,planHash,plan}){Object.assign(this,{attemptId,sessionId,planHash});this.plan=plan;this.seen=new Set();this.observations=[];this.help=[];this.responses=new Map();this.replies=[];this.truncated=false;}
  input(event){if(this.closed||event.type!=='user.final'||this.seen.has(event.turn_id))return false;this.seen.add(event.turn_id);
    for(const fact of observeDining(event.payload.text)){if(this.plan&&!this.plan.goals.some(g=>g.id===fact.goal_id&&g.observation_rule!=='unassessed'))continue;if(this.observations.length<24)this.observations.push({...fact,event_id:event.event_id,turn_id:event.turn_id,support_basis:'unknown'});else this.truncated=true;}
    if(!/[“”「」『』"‘’]|他说|她说|老师说/u.test(event.payload.text)&&/^(?:请|可以|能不能)?(?:帮我|我不会说|给我示范|示范|这(?:句|个).{0,20}怎么说|用中文怎么说|can you help|help|how (?:do|can) I say)/iu.test(event.payload.text)){if(this.help.length<12)this.help.push({event_id:event.event_id,turn_id:event.turn_id});else this.truncated=true;}return true;
  }
  forward(packet){if(this.closed)return;const e=packet.type==='event'?packet.event:null;if(!e)return;
    if(e.type==='response.started'){if(this.responses.size<24)this.responses.set(e.response_id,{response_id:e.response_id,turn_id:e.turn_id,status:'interrupted',playback_confirmed:false});else this.truncated=true;}
    if(['response.done','response.cancelled'].includes(e.type)){const r=this.responses.get(e.response_id);if(r){r.status=e.type==='response.done'?'done':'cancelled';if(this.replies.length<24)this.replies.push(r);else this.truncated=true;this.responses.delete(e.response_id);}}
  }
  finalize({endReason='student_end',providerKind,ready=false}){if(this.snapshot)return this.snapshot;this.closed=true;const suppressed=['authorization_revoked','safety_restricted'].includes(endReason);
    this.snapshot={schema_version:VERSION,attempt_id:this.attemptId,session_id:this.sessionId,plan_hash:this.planHash,voice_source:providerKind==='doubao'?'doubao':'synthetic',ready:!!ready,end_reason:endReason,final_turns:suppressed?0:this.seen.size,observations:suppressed?[]:this.observations,help_requests:suppressed?[]:this.help,replies:suppressed?[]:[...this.replies,...this.responses.values()].slice(0,24),truncated:this.truncated||this.replies.length+this.responses.size>24,support_causality:'unknown',mastery:'unassessed',pronunciation:'unassessed'};
    this.responses.clear();this.seen.clear();return structuredClone(this.snapshot);
  }
}
