import { validateEvent } from '../contracts/events.js';
import { SPORTS_LESSON } from './lessons.js';
import { sportsExpression } from './natural-teaching.js';
import { GENERAL_EXPRESSIONS,EXPRESSION_DIRECTORY_VERSION,RECAP_TOPICS,directExpression,forwardedExpressionRanges,expressionRequest } from './summary-directory.js';

export const SUMMARY_POLICY_VERSION='kai-summary-v3';
export const SUMMARY_SCHEMA_VERSION=2;
export const SUMMARY_LIMITS=Object.freeze({reply_chars:4096,text_events:256,refs_per_item:5,view_attempts:20,forward_events:10000,pending_replies:8});
// Versioned authored expressions already covered by the sports attempt rule.
// This is a bounded POC vocabulary, not inferred HSK alignment or a general judge.
export const SUMMARY_EXPRESSIONS=Object.freeze([
  {id:'likes-football',text:'我喜欢足球',pinyin:'wǒ xǐ huān zú qiú',english:'I like football.'},
  {id:'likes-basketball',text:'我喜欢篮球',pinyin:'wǒ xǐ huān lán qiú',english:'I like basketball.'},
  {id:'likes-running',text:'我喜欢跑步',pinyin:'wǒ xǐ huān pǎo bù',english:'I like running.'},
  {id:'likes-swimming',text:'我喜欢游泳',pinyin:'wǒ xǐ huān yóu yǒng',english:'I like swimming.'}
].map(Object.freeze));
const directory=[...SUMMARY_EXPRESSIONS,...GENERAL_EXPRESSIONS];
const clip=(label,items,empty)=>{const text=`${label}：${items.length?items.join('、'):empty}`;return text.length<=100?text:`${text.slice(0,99)}…`;};
export function closingBrief(recap) {
  const line=(label,items)=>`${label}：${items.length?items.join('、'):''}`;
  return `本轮结束：学生这一句是在结束对话。只用一两句轻声收束。先接住结束，再自然带上后面列出的真实内容，然后告别。不要说出“词汇”“表达”这些标签，不要加小标题，不要提问，不要教新内容，不要说已经掌握或学会了。某一行是空的就不要提那一类；两行都空就只告别，不要编造。\n${line('词汇',recap.vocabulary)}\n${line('表达',recap.expressions)}`;
}
// Detailed labeled recap. The spoken close does not read this aloud.
export function spokenCloseScript(recap) {
  const text=`这轮先说到这里。${clip('知识点',recap.knowledge_points,'这轮没有可核验的新知识点')}。${clip('词汇',recap.vocabulary,'这轮没有单独记下的新词汇')}。${clip('表达',recap.expressions,'这轮没有单独记下的新表达')}。这些只是这轮实际出现过的内容，还不代表已经掌握。再见。`;
  return text.length<=400?text:`${text.slice(0,399)}。`;
}
export function savedRecapLines(recap) {
  if(!recap)return ['本地 mock 已保存本轮表达尝试；未评估掌握，未升级作者设定的学习画像。'];
  return [clip('知识点',recap.knowledge_points,'这轮没有可核验的新知识点'),clip('词汇',recap.vocabulary,'这轮没有单独记下的新词汇'),clip('表达',recap.expressions,'这轮没有单独记下的新表达')];
}
const sourceRef=event=>({session_id:event.session_id,turn_id:event.turn_id,source_event_id:event.event_id,scope:'accepted_final_asr'});
const missionAliases=new Set(['用「我喜欢……」表达喜好','用「我喜欢……」说说喜欢的运动。','表达喜好']);
function missionRule(target) {
  const literal=sportsExpression(target.replace(/[。！!]$/u,''));
  if(literal && /^我(?:很)?喜欢(?:踢足球|打篮球|足球|篮球|跑步|游泳)[。！!]?$/u.test(target))return {supported:true,literal};
  return {supported:missionAliases.has(target),literal:null};
}
const endReasons=new Set(['student_end','provider_closed','transport_closed','service_failure','session_limit','safety_restricted','authorization_revoked']);
const headlines={
  practice_observed:{zh:'本轮记录了表达尝试。',en:'Expression attempts were recorded.'},
  target_text_observed:{zh:'回复中出现了目标表达，尚无学生尝试记录。',en:'The target appeared in reply text; no learner attempt was recorded.'},
  conversation_only:{zh:'本轮以交流为主，未记录可核验的目标练习。',en:'This session focused on conversation; no verifiable target practice was recorded.'},
  insufficient:{zh:'本轮记录不足，暂不生成学习结论。',en:'There is not enough session data for a learning conclusion.'},
  unavailable:{zh:'本轮总结不可用。',en:'This session summary is unavailable.'}
};
function retained(refs,value) {
  if(refs.length<SUMMARY_LIMITS.refs_per_item)refs.push(value);
  else refs[refs.length-1]=value; // Retain the first observations and the latest.
}

/** Observes accepted final ASR and packets actually handed to this session's WS.
 * Forwarded text is not a playback receipt. Only complete, bounded replies can
 * provide an optional free-chat scaffold; planned actions/ACKs alone never do.
 */
export class LearningSummary {
  constructor({sessionId,mode,mission}) {
    Object.assign(this,{sessionId,mode});this.closed=false;this.finalTurns=0;
    this.finalTurnIds=new Set();this.pendingReplies=new Map();this.requests=new Map();this.items=new Map();this.scaffolds=new Map();
    this.forwardEvents=new Set();this.responseIds=new Set();this.active=null;this.completedReplies=0;
    this.unassessedReplies=0;
    this.recapTopics=new Map();this.recapExpressions=new Map();
    this.mission=mission?structuredClone(mission):null;
    this.rule=mode==='mission'?missionRule(mission.targets[0]):{supported:true,literal:null};
    this.goal=['free','topic'].includes(mode)?null:{id:mode==='sports'?SPORTS_LESSON.goal.id:'mission-target-1',label:mode==='sports'?SPORTS_LESSON.goal.label:mission.targets[0],
      source:mode==='sports'?{kind:SPORTS_LESSON.source,lesson_version:SPORTS_LESSON.version}:{kind:'authorized-hskai-mission',mission_id:mission.id,completion_id:mission.completion_id,target_index:0},
      attempt_rule_supported:this.rule.supported};
  }
  item(expression) {
    const authored=directory.find(e=>e.text===expression);if(!authored||!this.items.has(authored.id)&&this.items.size>=4)return null;
    if(!this.items.has(authored.id))this.items.set(authored.id,{...authored,goal_id:this.mode==='free'?'observed-expressions':this.goal.id,
      content_source:this.mode==='free'?{kind:'ask-kai-authored-expression-directory',directory_version:EXPRESSION_DIRECTORY_VERSION,rule_version:SUMMARY_POLICY_VERSION}:{kind:SPORTS_LESSON.source,lesson_version:SPORTS_LESSON.version,rule_version:SUMMARY_POLICY_VERSION},target_text_count:0,target_text_refs:[]});
    return this.items.get(authored.id);
  }
  matches(expression) {return this.rule.supported && (this.mode==='free'||SUMMARY_EXPRESSIONS.some(e=>e.text===expression)) && (!this.rule.literal || this.rule.literal===expression);}
  sourcedLists() {
    const knowledge_points=[...this.recapTopics.values()].map(topic=>topic.label);
    const vocabulary=[],expressions=[];
    for(const row of this.recapExpressions.values()) {
      const entry=directory.find(item=>item.id===row.id);
      if(entry?.type==='word')vocabulary.push(row.text);else expressions.push(row.text);
    }
    return {knowledge_points,vocabulary,expressions};
  }
  observeStudent(event) {
    const add=(map,id,value)=>{if(!map.has(id)){if(map.size>=4)return;map.set(id,{...value,observation_count:0,source_refs:[]});}const row=map.get(id);row.observation_count++;retained(row.source_refs,sourceRef(event));};
    for(const topic of RECAP_TOPICS)if(topic.pattern.test(event.payload.text))add(this.recapTopics,topic.id,{id:topic.id,label:topic.label});
    for(const entry of directory)if(directExpression(event.payload.text,entry))add(this.recapExpressions,entry.id,{id:entry.id,text:entry.text,pinyin:entry.pinyin,english:entry.english,kind:'student_text_observed',content_source:{kind:'ask-kai-authored-expression-directory',directory_version:EXPRESSION_DIRECTORY_VERSION}});
  }
  recordFinal(event,decision) {
    if(this.closed)return null;
    this.finalTurns++;this.finalTurnIds.add(event.turn_id);
    this.observeStudent(event);
    if(decision.action==='TEACH_TARGET'||expressionRequest(event.payload.text))this.requests.set(event.turn_id,{source_event_id:event.event_id,context_version:decision.context_version});
    const attempt=this.attemptFromFinal(event);
    const pending=this.pendingReplies.get(event.turn_id);
    if(pending){this.pendingReplies.delete(event.turn_id);if(this.requests.has(event.turn_id))this.observeReply(pending.reply,pending.done);}
    return attempt;
  }
  attemptFromFinal(event) {
    const expression=sportsExpression(event.payload.text)??(this.mode==='free'?GENERAL_EXPRESSIONS.find(e=>directExpression(event.payload.text,e))?.text:null);if(!expression || !this.matches(expression))return null;
    const scaffold=this.scaffolds.get(expression);
    if(this.mode==='free' && (!scaffold || scaffold.input_order>=this.finalTurns))return null;
    const item=this.item(expression);if(!item)return null;
    return {kind:'attempted',goal_id:this.mode==='free'?'observed-expressions':this.goal.id,expression_id:item.id,session_id:this.sessionId,turn_id:event.turn_id,source_event_id:event.event_id,
      rule_version:'sports-expression-attempt-v2',lesson_version:SPORTS_LESSON.version,
      scaffolding:this.mode==='free'?'model_text_available':'start_tip_available',scaffold_ref:this.mode==='free'?scaffold.ref_id:null,
      scaffold_source:this.mode==='free'?structuredClone(scaffold.source):null,pronunciation_assessed:false};
  }
  forward(packet) {
    if(this.closed)return false;
    if(packet.type==='output.stop'){this.stop(packet.response_id);return true;}
    const event=packet.type==='event'?packet.event:null;
    if(!validateEvent(event) || event.session_id!==this.sessionId || !['response.started','response.text.delta','response.done','response.cancelled'].includes(event.type) || this.forwardEvents.has(event.event_id))return false;
    if(this.forwardEvents.size>=SUMMARY_LIMITS.forward_events)throw new Error('SUMMARY_EVENT_LIMIT');
    this.forwardEvents.add(event.event_id);
    if(event.type==='response.started') {
      if(this.active || this.responseIds.has(event.response_id))return false;
      this.responseIds.add(event.response_id);this.active={id:event.response_id,turn:event.turn_id,start_event_id:event.event_id,text:'',segments:[],truncated:false};return true;
    }
    const reply=this.active;if(!reply || reply.id!==event.response_id || reply.turn!==event.turn_id)return false;
    if(event.type==='response.text.delta') {
      if(reply.text.length+event.payload.text.length>SUMMARY_LIMITS.reply_chars || reply.segments.length>=SUMMARY_LIMITS.text_events){reply.truncated=true;return true;}
      reply.segments.push({from:reply.text.length,to:reply.text.length+event.payload.text.length,event_id:event.event_id});reply.text+=event.payload.text;return true;
    }
    this.active=null;
    if(event.type==='response.done') {
      this.completedReplies++;
      if(reply.truncated){this.unassessedReplies++;return true;}
      this.observeReply(reply,event);
    }
    return true;
  }
  observeReply(reply,done) {
    const request=this.requests.get(reply.turn);
    if(this.mode==='free' && !request){
      if(!this.finalTurnIds.has(reply.turn)) {
        // Completed forwarded text may precede final ASR; keep only a bounded owned lane.
        if(this.pendingReplies.has(reply.turn))return;
        if(this.pendingReplies.size>=SUMMARY_LIMITS.pending_replies){this.pendingReplies.delete(this.pendingReplies.keys().next().value);this.unassessedReplies++;}
        this.pendingReplies.set(reply.turn,{reply,done});
      }
      return;
    }
    // Require a whole affirmative expression with a boundary, not a keyword.
    const pattern=/(?:^|[。！!，,；;：:\n“「"\s])(我(?:很)?喜欢(?:踢足球|打篮球|足球|篮球|跑步|游泳))(?=[。！!.,，；;”」"]|$)/gu;
    const observations=[...reply.text.matchAll(pattern)].map(match=>({expression:sportsExpression(match[1]),from:match.index+match[0].length-match[1].length,to:match.index+match[0].length}));
    if(this.mode==='free')for(const entry of GENERAL_EXPRESSIONS)for(const range of forwardedExpressionRanges(reply.text,entry))observations.push({expression:entry.text,...range});
    const seen=new Set();
    for(const {expression,from,to} of observations) {
      if(!expression || !this.matches(expression) || seen.has(expression))continue;
      seen.add(expression);const item=this.item(expression);if(!item)continue;
      const ref={ref_id:`text-${done.response_id}-${item.id}`,kind:'target_text_forwarded',session_id:this.sessionId,turn_id:reply.turn,response_id:reply.id,
        source_event_ids:reply.segments.filter(s=>s.to>from && s.from<to).map(s=>s.event_id),completion_event_id:done.event_id,
        request_event_id:request?.source_event_id??null,rule_version:SUMMARY_POLICY_VERSION,scope:'gateway_forwarded_text',playback_confirmed:false,interrupted:false};
      item.target_text_count++;retained(item.target_text_refs,ref);
      this.scaffolds.set(expression,{ref_id:ref.ref_id,response_id:reply.id,input_order:this.finalTurns,source:ref});
    }
  }
  stop(id) {
    for(const [turn,pending] of this.pendingReplies)if(!id || pending.reply.id===id)this.pendingReplies.delete(turn);
    if(!id || this.active?.id===id)this.active=null;
    for(const [expression,scaffold] of this.scaffolds)if(!id || scaffold.response_id===id)this.scaffolds.delete(expression);
    for(const item of this.items.values())for(const ref of item.target_text_refs)if(!id || ref.response_id===id)ref.interrupted=true;
  }
  finalize({evidence,outcome='ended',endReason='student_end',businessSource='unconfigured',providerKind='test',ready=false}) {
    if(this.result)return structuredClone(this.result);
    if(!['ended','failed'].includes(outcome) || !endReasons.has(endReason))throw new Error('INVALID_SUMMARY_END');
    this.closed=true;this.active=null;this.unassessedReplies+=this.pendingReplies.size;this.pendingReplies.clear();this.finalTurnIds.clear();this.requests.clear();this.scaffolds.clear();
    const suppressed=['authorization_revoked','safety_restricted'].includes(endReason);
    const items=[];
    if(!suppressed)for(const item of this.items.values()) {
      const attempts=evidence.filter(e=>e.expression_id===item.id);
      const refs=[];for(const attempt of attempts)retained(refs,attempt);
      items.push({...item,kind:attempts.length?'attempted':'target_text_observed',attempt_count:attempts.length,attempt_refs:refs,
        refs_truncated:attempts.length>refs.length || item.target_text_count>item.target_text_refs.length});
    }
    const focus=suppressed?'unavailable':!this.finalTurns?'insufficient':items.some(i=>i.attempt_count)?'practice_observed':items.length?'target_text_observed':'conversation_only';
    const goals=suppressed?[]:this.goal?[this.goal]:items.length?[{id:'observed-expressions',label:'本轮有来源的中文表达',source:{kind:'ask-kai-authored-expression-directory',directory_version:EXPRESSION_DIRECTORY_VERSION},attempt_rule_supported:true}]:[];
    const review=items.length?[{goal_id:goals[0].id,expression_id:items.find(i=>i.attempt_count)?.id??items[0].id,reason:items.some(i=>i.attempt_count)?'attempt_not_assessed':'target_text_without_attempt',optional:true}]:[];
    const recap={schema_version:1,source:'accepted_student_final',topics:suppressed?[]:[...this.recapTopics.values()],expressions:suppressed?[]:[...this.recapExpressions.values()],correctness_assessed:false,complete_inventory:false};
    this.result=structuredClone({schema_version:SUMMARY_SCHEMA_VERSION,policy_version:SUMMARY_POLICY_VERSION,session_id:this.sessionId,mode:this.mode,outcome,end_reason:endReason,partial:outcome==='failed' || endReason==='transport_closed',focus,
      business_source:['mock_hskai','external_hskai','unconfigured'].includes(businessSource)?businessSource:'unconfigured',
      voice:{kind:!ready?'not_connected':providerKind==='doubao'?'real_provider':'synthetic',provider_ready_observed:ready,real_experience_accepted:false},
      counts:{student_final_turns:suppressed?0:this.finalTurns,forwarded_completed_replies:suppressed?0:this.completedReplies,attempts:suppressed?0:evidence.length},
      headline:headlines[focus],goals,learning_items:items,conversation_recap:recap,review_suggestions:review,coverage:{rule_scope:this.mode==='free'?EXPRESSION_DIRECTORY_VERSION:'authored_sports_likes_v1',unassessed_replies:suppressed?0:this.unassessedReplies,complete_learning_inventory:false},
      assessment:{mastery_assessed:false,pronunciation_assessed:false,independent_use_assessed:false},
      notice:'仅记录本轮有来源的目标文本与最终识别尝试；不证明听到、独立使用、掌握或发音准确。'});
    this.items.clear();this.recapTopics.clear();this.recapExpressions.clear();return structuredClone(this.result);
  }
}
