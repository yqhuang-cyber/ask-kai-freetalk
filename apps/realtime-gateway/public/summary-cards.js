// Versioned, session-owned, ephemeral view; never display IDs or transcripts.
const modes={topic:'主题对话',sports:'运动主题',mission:'Mission 后对话',free:'自由聊天'};
const focuses=new Set(['practice_observed','target_text_observed','conversation_only','insufficient','unavailable']);
const id=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const count=(v,max=1000)=>Number.isSafeInteger(v) && v>=0 && v<=max;
const line=(v,max=160)=>typeof v==='string' && v.length>0 && v.length<=max;
const empty={focus:'unavailable',headline:{zh:'本轮总结暂不可用。',en:'This session summary is unavailable.'},items:[],recap:{topics:[],expressions:[]},review:null,goal:null,partial:false,synthetic:false,mock:false};
function projectRecap(recap,sessionId,finalTurns) {
  if(!recap||recap.schema_version!==1||recap.source!=='accepted_student_final'||recap.correctness_assessed!==false||recap.complete_inventory!==false||!Array.isArray(recap.topics)||!Array.isArray(recap.expressions)||recap.topics.length>4||recap.expressions.length>4)return null;
  const topics={sports:'运动',food:'日常饮食',hobbies:'兴趣爱好',weather:'天气'};
  const validRefs=row=>count(row.observation_count)&&row.observation_count>0&&row.observation_count<=finalTurns&&Array.isArray(row.source_refs)&&row.source_refs.length>0&&row.source_refs.length<=5&&row.source_refs.length<=row.observation_count&&new Set(row.source_refs.map(r=>r?.source_event_id)).size===row.source_refs.length&&row.source_refs.every(r=>r&&r.session_id===sessionId&&id(r.turn_id)&&id(r.source_event_id)&&r.scope==='accepted_final_asr');
  if(new Set(recap.topics.map(t=>t?.id)).size!==recap.topics.length||new Set(recap.expressions.map(t=>t?.id)).size!==recap.expressions.length)return null;
  if(recap.topics.some(t=>!t||!Object.hasOwn(topics,t.id)||t.label!==topics[t.id]||!validRefs(t)))return null;
  if(recap.expressions.some(e=>!e||!id(e.id)||!line(e.text,100)||!line(e.pinyin,100)||!line(e.english,120)||e.kind!=='student_text_observed'||e.content_source?.kind!=='ask-kai-authored-expression-directory'||e.content_source.directory_version!=='kai-expression-directory-v1'||!validRefs(e)))return null;
  return {topics:recap.topics.map(t=>t.label),expressions:recap.expressions.map(e=>({text:e.text,pinyin:e.pinyin,english:e.english,observations:e.observation_count}))};
}
export function projectSummary(packet,{sessionId,mode}) {
  const s=packet?.summary;
  if(s?.schema_version===3&&['kai-dynamic-summary-v1','kai-dynamic-summary-v2'].includes(s.policy_version))return projectDynamicSummary(packet,{sessionId,mode});
  if(packet?.type!=='teaching.summary' || packet.session_id!==sessionId || !id(sessionId) || !Object.hasOwn(modes,mode) || s?.session_id!==sessionId || s.mode!==mode || !(s.schema_version===1&&s.policy_version==='kai-summary-v1'||s.schema_version===2&&['kai-summary-v2','kai-summary-v3'].includes(s.policy_version)) || !focuses.has(s.focus))return null;
  if(!['ended','failed'].includes(s.outcome) || typeof s.partial!=='boolean' || !['mock_hskai','external_hskai','unconfigured'].includes(s.business_source) || !['not_connected','synthetic','real_provider'].includes(s.voice?.kind) || s.voice.real_experience_accepted!==false)return null;
  if(!count(s.counts?.attempts) || !count(s.counts.student_final_turns) || !count(s.counts.forwarded_completed_replies,10000) || !line(s.headline?.zh) || !line(s.headline.en))return null;
  if(!Array.isArray(s.goals) || s.goals.length>1 || !Array.isArray(s.learning_items) || s.learning_items.length>4 || !Array.isArray(s.review_suggestions) || s.review_suggestions.length>1 || s.assessment?.mastery_assessed!==false || s.assessment.pronunciation_assessed!==false || s.assessment.independent_use_assessed!==false)return null;
  if(s.focus==='unavailable')return {...structuredClone(empty),mode,reason:s.end_reason};
  const recap=s.schema_version===2?projectRecap(s.conversation_recap,sessionId,s.counts.student_final_turns):{topics:[],expressions:[]};if(!recap)return null;
  const goal=s.goals[0];if(s.goals.length && (!goal || !id(goal.id) || !line(goal.label,100) || typeof goal.attempt_rule_supported!=='boolean'))return null;
  const seen=new Set(),items=[];let total=0;
  for(const item of s.learning_items) {
    if(!goal || !item || !id(item.id) || seen.has(item.id) || item.goal_id!==goal.id || !line(item.text,100) || !line(item.pinyin,100) || !line(item.english,120) || !['attempted','target_text_observed'].includes(item.kind) || !count(item.attempt_count) || !count(item.target_text_count,10000))return null;
    seen.add(item.id);total+=item.attempt_count;
    if(!Array.isArray(item.attempt_refs) || item.attempt_refs.length>5 || item.attempt_refs.length>item.attempt_count || !Array.isArray(item.target_text_refs) || item.target_text_refs.length>5 || item.target_text_refs.length>item.target_text_count || (item.attempt_count>0 && !item.attempt_refs.length) || (item.target_text_count>0 && !item.target_text_refs.length))return null;
    if(item.attempt_refs.some(r=>!r || r.kind!=='attempted' || r.session_id!==sessionId || !id(r.source_event_id) || !id(r.turn_id) || r.expression_id!==item.id || r.goal_id!==goal.id || r.pronunciation_assessed!==false))return null;
    if(item.target_text_refs.some(r=>!r || r.kind!=='target_text_forwarded' || r.session_id!==sessionId || !id(r.response_id) || !id(r.turn_id) || !id(r.completion_event_id) || r.scope!=='gateway_forwarded_text' || r.playback_confirmed!==false || !Array.isArray(r.source_event_ids) || !r.source_event_ids.length || r.source_event_ids.length>20 || r.source_event_ids.some(v=>!id(v))))return null;
    if(item.kind!==(item.attempt_count?'attempted':'target_text_observed') || (!item.attempt_count && !item.target_text_count))return null;
    items.push({id:item.id,text:item.text,pinyin:item.pinyin,english:item.english,attempts:item.attempt_count});
  }
  if(total!==s.counts.attempts || total>s.counts.student_final_turns || (s.focus==='practice_observed' && !total) || (s.focus==='target_text_observed' && (total || !items.length)) || (s.focus==='conversation_only' && (items.length || !s.counts.student_final_turns)))return null;
  const suggestion=s.review_suggestions[0];let review=null;
  if(s.review_suggestions.length && !suggestion)return null;
  if(suggestion) {
    if(suggestion.goal_id!==goal?.id || suggestion.optional!==true || !['attempt_not_assessed','target_text_without_attempt'].includes(suggestion.reason))return null;
    const item=items.find(i=>i.id===suggestion.expression_id);if(!item)return null;review={...item};
  }
  return {mode,focus:s.focus,headline:{zh:s.headline.zh,en:s.headline.en},items:s.focus==='insufficient'?[]:items,recap:s.focus==='insufficient'?{topics:[],expressions:[]}:recap,review:s.focus==='insufficient'?null:review,
    goal:goal?{label:goal.label,supported:goal.attempt_rule_supported}:null,partial:s.partial || s.outcome==='failed',synthetic:s.voice.kind==='synthetic',mock:s.business_source==='mock_hskai'};
}
function projectDynamicSummary(packet,{sessionId,mode}) {
  const s=packet.summary;
  if(packet.type!=='teaching.summary'||packet.session_id!==sessionId||s.session_id!==sessionId||s.mode!==mode||!id(sessionId)||!Object.hasOwn(modes,mode)||!focuses.has(s.focus)||!['ended','failed'].includes(s.outcome)||typeof s.partial!=='boolean'||!line(s.headline?.zh)||!line(s.headline.en)||s.business_source!=='mock_hskai'||!['not_connected','synthetic','real_provider'].includes(s.voice?.kind)||s.voice.real_experience_accepted!==false||!count(s.counts?.student_final_turns)||!count(s.counts.attempts)||s.assessment?.mastery_assessed!==false||s.assessment.pronunciation_assessed!==false||s.assessment.independent_use_assessed!==false||s.planning?.controlled_execution!==false||!['next_turn_advisory','controlled'].includes(s.planning.path))return null;
  const v2=s.policy_version==='kai-dynamic-summary-v2';
  if(!Array.isArray(s.goals)||s.goals.length>(v2?8:1)||s.goals.some(g=>!id(g.id)||!line(g.label,100)||typeof g.attempt_rule_supported!=='boolean')||!Array.isArray(s.dynamic_observations)||s.dynamic_observations.length>100||s.counts.attempts<s.dynamic_observations.length||s.counts.attempts>s.counts.student_final_turns||s.dynamic_observations.some(o=>o.session_id!==sessionId||![o.observation_id,o.turn_id,o.source_event_id,o.kp_id].every(id)||!line(o.label,100)||o.state!=='attempted'||!['unknown','prompted'].includes(o.support)||o.execution_ref!==null&&!id(o.execution_ref))||new Set(s.dynamic_observations.map(o=>o.turn_id)).size!==s.dynamic_observations.length)return null;
  if(v2&&(new Set(s.goals.map(g=>g.id)).size!==s.goals.length||s.goals.some(g=>!['paused','retired','unverified'].includes(g.status)||g.assessment?.goal_id!==g.id||g.assessment.status!=='unverified'||g.assessment.mastery_assessed!==false||!count(g.assessment.attempt_count)||!Array.isArray(g.assessment.missing)||!g.assessment.missing.includes('semantic_review')&&g.assessment.success_rule_ref!=='unassessed'||!Array.isArray(g.assessment.observation_refs)||g.assessment.observation_refs.length>12||g.assessment.observation_refs.some(ref=>!s.dynamic_observations.some(o=>o.observation_id===ref&&o.goal_id===g.id)))||s.dynamic_observations.some(o=>!id(o.goal_id)||!s.goals.some(g=>g.id===o.goal_id)||!count(o.plan_revision)||o.plan_revision<1||!['likes-attempt-v1','time-attempt-v1'].includes(o.attempt_rule_ref))))return null;
  if(s.focus==='unavailable')return {...structuredClone(empty),mode,reason:s.end_reason};
  const observed=new Map();for(const o of s.dynamic_observations){const row=observed.get(o.kp_id)??{label:o.label,count:0};row.count++;observed.set(o.kp_id,row);}
  return {mode,focus:s.focus,headline:s.headline,goals:v2?s.goals.map(g=>({label:g.label,status:g.status})):[],items:[],observations:[...observed.values()],recap:{topics:[],expressions:[]},review:null,goal:s.goals[0]?{label:s.goals[0].label,supported:s.goals[0].attempt_rule_supported}:null,partial:s.partial,synthetic:s.voice.kind==='synthetic',mock:true};
}
export class SummaryState {
  constructor(){this.reset();}
  reset(){this.sessionId=null;this.mode=null;this.data=null;this.ended=false;this.suppressed=false;}
  begin(sessionId,mode){this.reset();if(!id(sessionId) || !Object.hasOwn(modes,mode))return false;this.sessionId=sessionId;this.mode=mode;return true;}
  accept(packet){if(!this.sessionId || this.ended || this.suppressed || this.data)return false;const data=projectSummary(packet,{sessionId:this.sessionId,mode:this.mode});if(!data)return false;this.data=data;return true;}
  suppress(reason){this.suppressed=true;this.data={...structuredClone(empty),mode:this.mode,reason};}
  finish(){if(!this.sessionId)return null;this.ended=true;return structuredClone(this.data??{...empty,mode:this.mode,reason:'missing'});}
}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function bilingual(parent,zh,en){parent.append(element('p',zh,'summary-zh'));const english=element('p',en,'summary-en');english.lang='en';parent.append(english);}
export class SummaryCards {
  constructor({root,link,onRestart}){Object.assign(this,{root,link,onRestart});this.state=new SummaryState();this.reset();}
  reset(){this.state.reset();this.root.replaceChildren();this.root.hidden=true;this.link.hidden=true;}
  begin(sessionId,mode){this.reset();return this.state.begin(sessionId,mode);}
  accept(packet){return this.state.accept(packet);}
  suppress(reason){this.state.suppress(reason);this.root.replaceChildren();this.root.hidden=true;this.link.hidden=true;}
  finish(){const data=this.state.finish();if(data)this.render(data);}
  render(data){
    this.root.replaceChildren();this.root.hidden=false;this.link.hidden=false;this.root.dataset.focus=data.focus;
    const header=element('div',undefined,'summary-header');header.append(element('h2','本轮小结','summary-title'));header.firstChild.id='summary-title';header.append(element('span',modes[data.mode]??'本轮对话','summary-mode'));this.root.append(header);
    const status=element('div',undefined,'summary-status');status.setAttribute('role','status');bilingual(status,data.headline.zh,data.headline.en);this.root.append(status);
    if(data.synthetic)bilingual(this.root,'工程测试数据，不代表真实语音体验。','Engineering test data; this is not real voice acceptance.');
    if(data.mock)this.root.append(element('p','独立 POC · 身份与课程为本地示例。','summary-source'));
    if(data.partial)bilingual(this.root,'对话提前结束，仅展示已收到的部分记录。','The conversation ended early; only received records are shown.');
    if(data.focus==='unavailable')bilingual(this.root,'没有可展示的总结，请重新开始一轮。','No summary is available. You can start another conversation.');
    else {
      if(data.goals?.length){for(const goal of data.goals)this.root.append(element('p','会话中的练习方向：'+goal.label+'（'+(goal.status==='paused'?'已暂停':goal.status==='retired'?'已停止':'达成尚未确认')+'）','summary-goal'));}
      else if(data.goal)this.root.append(element('p',`本轮对话目标：${data.goal.label}`,'summary-goal'));
      if(data.goal && !data.goal.supported)bilingual(this.root,'当前目标暂未自动评估，未据此判断学习结果。','This target has not been assessed; no learning result is inferred.');
      if(data.recap?.topics.length)this.root.append(element('p',`本轮提到的话题：${data.recap.topics.join('、')}`,'summary-topics'));
      if(data.recap?.expressions.length){
        const recap=element('section',undefined,'summary-recap');recap.append(element('h3','本轮说到的表达'));
        const entries=element('div',undefined,'summary-grid');
        for(const expression of data.recap.expressions){const card=element('article',undefined,'summary-card');card.append(element('h4',expression.text));card.append(element('p',expression.pinyin,'pinyin'));const english=element('p',expression.english,'summary-en');english.lang='en';card.append(english);entries.append(card);}
        recap.append(entries);bilingual(recap,'根据本轮识别文字整理，不代表已掌握或发音评估。','From recognized text in this session; this is not a mastery or pronunciation assessment.');this.root.append(recap);
      }
      const grid=element('div',undefined,'summary-grid summary-learning-grid');
      for(const item of data.items){
        const card=element('article',undefined,'summary-card');card.append(element('p',item.attempts?`表达尝试 · ${item.attempts} 次`:'回复中的表达 · 尚无尝试记录','summary-label'));
        card.append(element('h3',item.text));card.append(element('p',item.pinyin,'pinyin'));const translation=element('p',item.english,'summary-en');translation.lang='en';card.append(translation);grid.append(card);
      }
      this.root.append(grid);
      for(const row of data.observations??[])this.root.append(element('p',`${row.label}：${row.count} 次识别表达尝试；提示程度与掌握未评估。`,'summary-observation'));
      if(data.review){const review=element('div',undefined,'summary-review');review.append(element('h3','可再练一句 · 自愿练习'));bilingual(review,data.review.text,data.review.english);bilingual(review,'下次想练习时，可以再试试这句话。','You can try this sentence again whenever you want.');this.root.append(review);}
      bilingual(this.root,'仅根据本轮记录整理；尚未评估掌握、独立使用或发音。','Based on this session only; mastery, independent use and pronunciation were not assessed.');
    }
    const restart=element('button','再聊一轮','summary-restart');restart.type='button';restart.addEventListener('click',()=>this.onRestart?.());this.root.append(restart);
  }
}
