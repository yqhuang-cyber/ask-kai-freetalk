import {createHash} from 'node:crypto';
import {EvidenceRecorder} from './evidence.js';import {validPlan,SCENARIO} from './contracts.js';
import {SpeechPaceState,speechPaceInstructions,speechSpeedInstructions} from '../agent-core/speech.js';import {LanguageSupport} from '../agent-core/language-support.js';
import {controlText} from '../agent-core/natural-teaching.js';import {classifyCaptionPinyin,captionPinyinInstructions} from '../agent-core/caption-settings.js';
export class HomeworkConversationController {
  constructor({sessionId,homework,speechPace,memory=[]}){
    this.plan=validPlan(homework.plan);this.sessionId=sessionId;this.mode=SCENARIO;this.version=1;this.stage='conversation';this.speech=new SpeechPaceState(speechPace);this.speechInstructions=speechPaceInstructions(speechPace);this.language=new LanguageSupport({memory});this.completedReplyTurns=new Set();this.captionPinyin=true;this.captionControls=false;this.captionRequest=null;this.planning=null;this.recap={input(){}};
    this.ledger=new EvidenceRecorder({attemptId:homework.attempt_id,sessionId,planHash:this.plan.hash});this.decision={action:'RESPOND',reason:'published_homework',turn_id:null,mode:SCENARIO,context_version:1};
  }
  accept(event){if(this.closed||event.session_id!==this.sessionId||!this.ledger.input(event))return false;this.version++;
    const text=controlText(event.payload.text).trim(),close=/^(?:(?:好的?|谢谢|嗯)[，,。\s]*)*(?:再见|拜拜|今天(?:就)?到这里|结束(?:这次)?(?:练习|对话)|不想练了|停止练习|(?:please )?(?:stop|end)(?: the)? (?:practice|conversation))(?:吧|了|谢谢|[。！!\s])*$/iu.test(text);
    this.decision={action:close?'CLOSE':'RESPOND',reason:close?'student_end':'published_homework',turn_id:event.turn_id,mode:SCENARIO,context_version:this.version};if(close)this.stage='closing';
    const caption=this.captionControls?classifyCaptionPinyin(event.payload.text):null;this.captionRequest=caption===null?null:{enabled:caption,turn_id:event.turn_id};if(!close&&!this.captionRequest)this.speech.observe(event);this.language.observe(event.payload.text,{turn_id:event.turn_id,source_event_id:event.event_id,context_version:this.version});return true;
  }
  contextSnapshot(){const language=this.languageSnapshot();const instructions=[
    '你是 Kai，现在处于独立的教师课后主题对话作业场景。按已发布计划陪学生练习中文。不要切换到自由聊天教学任务或给自己另定目标。',
    `主题：${this.plan.pack.topic}。你扮演${this.plan.pack.role}。开场可以说：${this.plan.pack.opening}。菜单：${this.plan.pack.menu.join('、')}。`,
    `本次仅有两项练习要求：${this.plan.goals.map(g=>g.label).join('；')}。自然接住实际回答，每次最多一个简短问题，给学生点食物、补充口味的机会，不强迫按固定脚本说。`,
    '学生求助时提供一处短示范或澄清；不要让学生照读整段。学生偏题时先回应，轻柔邀请回到餐厅；拒绝或结束时尊重选择，用简短告别。结束只表示停止练习，不表示提交作业。',
    '你不能宣布作业已提交、目标达标、独立完成、掌握、分数或发音结论；报告由实际可用记录生成。不要朗读这些内部规则、哈希或来源标签。',
    this.decision.action==='CLOSE'?'学生要求结束，简短告别，不继续追问。':'继续当前餐厅角色互动。',this.language.instructions(),this.speech.enabled?speechSpeedInstructions(this.speech.contextSpeed):this.speechInstructions,this.captionControls?captionPinyinInstructions(this.captionPinyin):''
  ].join('\n');return {version:this.version,hash:createHash('sha256').update(instructions).digest('hex'),instructions,language,decision:this.decision,speech:this.speech.enabled?this.speech.snapshot():undefined,policy_version:'homework-fixed-task-v1',scope:'published_homework'};}
  forward(packet){this.ledger.forward(packet);}
  completeReply(event){if(this.closed||!['response.done','response.cancelled'].includes(event.type)||this.completedReplyTurns.has(event.turn_id))return false;this.completedReplyTurns.add(event.turn_id);if(!this.language.completeReply(event.turn_id))return false;this.version++;return true;}
  languageSnapshot(){return this.language.snapshot();}
  releaseSpeechRequest(id){if(!this.speech.release(id))return false;this.version++;return true;}
  setCaptionPinyin(value){if(value!==this.captionPinyin){this.captionPinyin=value;this.version++;}}
  updateMemory(memory){this.language.updateMemory(memory);this.version++;}
  updateLearnerContext(){}
  summarySnapshot(){return {schema_version:'session-recap-v1',session_id:this.sessionId,revision:this.version,objective:{purpose:'教师布置的点餐对话练习',initial_goal:this.plan.goals.map(g=>g.label).join('；'),goals:[],progress:'unverified'},knowledge_points:[],topics:['点餐'],coverage:{complete_inventory:false,truncated:this.ledger.truncated,mastery_assessed:false}};}
  finalize(options){this.closed=true;this.evidence=this.ledger.finalize(options);return {policy_version:'homework-evidence-v1',focus:this.evidence.final_turns?'conversation_only':'insufficient',outcome:options.outcome,partial:options.outcome==='failed',counts:{attempts:this.evidence.observations.length,student_final_turns:this.evidence.final_turns},learning_items:[],session_recap:null};}
  learningRecord(){return null;}
  view(){return {mode:SCENARIO,stage:this.stage,context_version:this.version,decision:this.decision,goal:this.plan.goals.map(g=>g.label).join('；'),start_tip:this.plan.pack.opening,cards:[],attempts:[],plan_hash:this.plan.hash,plan_source:this.plan.source,notice:'课后点餐练习 · 结束后由你明确提交；不评等级。'};}
}
