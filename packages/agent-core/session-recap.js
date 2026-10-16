import { GENERAL_EXPRESSIONS,RECAP_TOPICS,forwardedExpressionRanges } from './summary-directory.js';
import { SUMMARY_EXPRESSIONS } from './learning-summary.js';
import { SPORTS_LESSON } from './lessons.js';
import { validateSessionRecap } from '../contracts/conversation-record.js';
const directory=[...SUMMARY_EXPRESSIONS,...GENERAL_EXPRESSIONS];
// Extract only bounded, explicit language examples. No general transcript is saved.
export class SessionRecap {
  constructor({sessionId,mode,mission,planning}) {
    this.sessionId=sessionId;this.revision=1;this.pointSeq=0;this.points=new Map();this.topics=new Set();this.replies=new Map();this.excluded=new Set();this.truncated=false;
    this.purpose=planning?.plan.conversation_purpose??(mode==='free'?'由你选择话题，自然交流。':mode==='mission'?'承接 Mission 进行中文交流。':'围绕运动进行中文交流。');
    this.initialGoal=planning?.plan.primary_goal?.label??(planning?null:mode==='mission'?mission.targets[0]:mode==='sports'?SPORTS_LESSON.goal.label:null);
    this.goals=[];this.goal(planning?.plan);
  }
  goal(plan) {
    if(!plan?.primary_goal)return;
    const g=plan.primary_goal,row={id:g.id,label:g.label,status:plan.goal_status==='retired'?'retired':plan.goal_status==='paused'?'paused':'active',plan_revision:plan.revision};
    const before=JSON.stringify(this.goals),old=this.goals.find(r=>r.id===g.id);if(old)Object.assign(old,row);else if(this.goals.length<8)this.goals.push(row);else this.truncated=true;
    if(before!==JSON.stringify(this.goals))this.revision++;
  }
  add(text,type,meaning,event,occurrence='discussed') {
    if(!text||text.length>100)return;
    const key=type+':'+text,ref={turn_id:event.turn_id,source_event_id:event.event_id,response_id:event.response_id??null};
    let row=this.points.get(key);
    if(!row){if(this.points.size>=24){this.truncated=true;return;}row={id:`point-${++this.pointSeq}`,type,text,meaning_or_usage:meaning??null,example:type==='expression'?text:null,occurrence,source_refs:[]};this.points.set(key,row);}
    if(!row.source_refs.some(r=>r.source_event_id===ref.source_event_id)&&row.source_refs.length<3)row.source_refs.push(ref);
    if(row.meaning_or_usage===null&&meaning)row.meaning_or_usage=meaning;
    if(occurrence==='teacher_demonstrated')row.occurrence=occurrence;
  }
  observe(text,event,teacher=false) {
    const before=JSON.stringify([[...this.points.values()],[...this.topics]]);
    for(const t of RECAP_TOPICS)if(t.pattern.test(text))this.topics.add(t.label);
    for(const entry of directory)if(forwardedExpressionRanges(text,entry).length)this.add(entry.text,entry.type==='word'?'vocabulary':'expression',entry.english,event,teacher?'teacher_demonstrated':'discussed');
    if(!teacher){
      for(const match of text.matchAll(/(?:这里的|这里说的)[“「‘"']?([\p{Script=Han}]{1,8}?)[”」’"']?(?:是?什么意思|怎么用|的用法)/gu))this.add(match[1],'vocabulary',null,event);
      for(const match of text.matchAll(/[“「‘"']([^”」’"'\n]{1,40})[”」’"']\s*(?:是?什么意思|怎么用|的用法|中文怎么说)/gu))if(/[\p{Script=Han}]/u.test(match[1]))this.add(match[1],match[1].length<=4?'vocabulary':'expression',null,event);
    }
    // Explicitly marked examples from an actual completed teacher reply. Quoted
    // story/dialogue without a language-help cue is deliberately not harvested.
    if(teacher&&/(?:可以说|比如说|中文(?:是|叫|说)|用中文|意思|表示|表达|这个词|这个句式|you can say|means|in Chinese)/iu.test(text)) {
      for(const match of text.matchAll(/[“「‘"']([^”」’"'\n]{1,60})[”」’"']/gu))if(/[\u3400-\u9fff]/u.test(match[1])){
        const after=text.slice(match.index+match[0].length),meaning=after.match(/^(?:的意思是|是指|表示)[：:\s]*([^。！？\n]{1,100})/u)?.[1]??null;
        this.add(match[1],match[1].length<=4?'vocabulary':'expression',meaning,event,'teacher_demonstrated');
      }
      for(const match of text.matchAll(/(?:中文(?:是|叫)|可以说)[：:\s]*([^，。！？\n“「‘"']{1,30})(?=[，。！？\n]|$)/gu))this.add(match[1].trim(),match[1].trim().length<=4?'vocabulary':'expression',null,event,'teacher_demonstrated');
    }
    if(before!==JSON.stringify([[...this.points.values()],[...this.topics]]))this.revision++;
  }
  removeSources(predicate){for(const [key,row] of this.points){row.source_refs=row.source_refs.filter(r=>!predicate(r));if(!row.source_refs.length)this.points.delete(key);}this.revision++;}
  input(event,{closing=false,plan}={}) {if(closing){this.excluded.add(event.turn_id);this.removeSources(r=>r.turn_id===event.turn_id);return;}this.goal(plan);this.observe(event.payload.text,event);}
  forward(packet) {
    if(packet.type==='output.stop'){for(const [id] of this.replies)if(!packet.response_id||id===packet.response_id)this.replies.delete(id);return;}
    const e=packet.type==='event'?packet.event:null;if(!e||e.session_id!==this.sessionId||this.excluded.has(e.turn_id))return;
    if(e.type==='response.started'){if(this.replies.size<8)this.replies.set(e.response_id,{text:'',turn_id:e.turn_id,truncated:false});return;}
    const r=this.replies.get(e.response_id);if(!r||r.turn_id!==e.turn_id)return;
    if(e.type==='response.text.delta'){if(r.text.length+e.payload.text.length<=4096)r.text+=e.payload.text;else r.truncated=true;}
    if(e.type==='response.done'||e.type==='response.cancelled'){this.replies.delete(e.response_id);if(e.type==='response.done'&&!r.truncated)this.observe(r.text,e,true);else if(r.truncated)this.truncated=true;}
  }
  snapshot() {return validateSessionRecap({schema_version:'session-recap-v1',session_id:this.sessionId,revision:this.revision,objective:{purpose:this.purpose,initial_goal:this.initialGoal,goals:structuredClone(this.goals),progress:'unverified'},knowledge_points:[...this.points.values()],topics:[...this.topics].slice(0,8),coverage:{complete_inventory:false,truncated:this.truncated,mastery_assessed:false}},this.sessionId);}
}
