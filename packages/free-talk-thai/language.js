import {LanguageSupport,languageHelpKind} from '../agent-core/language-support.js';

export const THAI_POLICY='kai-free-thai-v1';
const clauses=text=>text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu,' ').split(/[，,。.!！;；]/u).map(s=>s.trim().replace(/[?？]+$/u,'')).filter(Boolean);
const only=/^(?:请)?(?:只(?:用|说|讲)中文(?:回答|回复)?|用中文(?:就好|就行)|(?:不用|不要)泰语(?:翻译|解释)?)(?:吧|啊)?$/u;
const both=/^(?:请)?(?:加(?:上)?泰语(?:翻译|解释)?|用泰语(?:翻译|解释)(?:一下)?|(?:我)?(?:需要|想要)泰语(?:帮助|翻译|解释)|先(?:说)?中文再(?:说)?泰语)$/u;
const auto=/^(?:请)?(?:恢复自动(?:语言)?模式|按需要(?:加|用)泰语|自动调整语言)$/u;
const once=/^(?:请)?(?:这(?:一)?句|这(?:一)?次(?:回答|回复)?|本次(?:回答|回复)?|这一轮)/u;

// A separate session policy. Legacy support_language is never reinterpreted or
// written back: comprehension and known expressions remain authorized inputs.
export class ThaiLanguageSupport extends LanguageSupport {
  constructor({memory=[],...options}={}){super({...options,memory:memory.filter(r=>r.field!=='support_language')});this.thaiPreference='auto';this.thaiReply=null;}
  updateMemory(memory){super.updateMemory(memory.filter(r=>r.field!=='support_language'));}
  observe(text,source={}){
    super.observe(text,source);this.preference=null;this.replyRequest=null;this.thaiReply=null;
    if(/(?:忽略|覆盖|忘记).*(?:规则|指令)|\b(?:ignore|override|forget).*\b(?:rules|instructions)\b/iu.test(text))return;
    for(const clause of clauses(text)){
      const reply=once.test(clause),control=clause.replace(once,'').replace(/^(?:接下来|从现在开始)/u,'');
      const value=only.test(control)?'zh':both.test(control)?'zh_th':auto.test(control)?'auto':null;
      if(value){if(reply)this.thaiReply=value;else{this.thaiPreference=value;this.thaiReply=null;}}
    }
    this.helpKind=languageHelpKind(text);this.needsHelp=this.helpKind!=='none';
  }
  completeReply(turn){if(!turn||turn!==this.turn?.turn_id)return false;const changed=!!this.thaiReply||this.needsHelp;this.thaiReply=null;super.completeReply(turn);return changed;}
  snapshot(){
    const base=super.snapshot(),preference=this.thaiReply??this.thaiPreference;
    const support=preference==='zh'?'off':preference==='zh_th'||this.needsHelp?'required':base.comprehension==='comfortable'||base.known_expressions.length?'adaptive':'required';
    return {...base,policy_version:THAI_POLICY,support_locale:'th',support_mode:support,english_support:'off',preference,session_preference:this.thaiPreference,preference_source:this.thaiReply||this.thaiPreference!=='auto'?'student_current_session':'thai_scenario_default',request_scope:this.thaiReply?'reply':this.thaiPreference!=='auto'?'session':'default',reason:preference==='zh'?'explicit_chinese':this.needsHelp?'student_help_or_new_expression':preference==='zh_th'?'explicit_bilingual':base.reason};
  }
  instructions(){
    const s=this.snapshot();
    return `中泰自由对话语言规则 ${THAI_POLICY}：学习中文，泰语只帮助理解。始终先说中文，必要的自然泰语紧跟对应中文，使用泰文字母，不用英文或罗马字替代泰语。拼音由页面显示，不朗读拼音。普通聊天不强制教学或跟读，最多一个主要问题，泰语不得新增问题、知识或任务。
当前学生明确只要中文时，本次确认也只说中文；新的学生要求优先于历史状态。没听懂时重述原意或问一个短澄清问题，不转题、不评价能力。新表达或求助恢复泰语支持，明确只中文时先用简单中文。听懂、识别成功或给过翻译不证明掌握。
本场默认：${s.session_preference==='zh'?'只用中文':s.session_preference==='zh_th'?'中文后紧跟简短泰语':'根据理解需要提供泰语；初学或未知默认双语，熟悉表达可减少支架'}。本轮状态：${s.support_mode==='off'?'只说中文':s.support_mode==='required'?'先说一句自然中文，立刻紧接一句准确对应的泰语；若继续说中文，同样逐句成对，不只翻译最后一句，不用泛泛泰语替代实际含义':'按理解需要用泰语，新表达和求助恢复必要泰语'}。
“这次／这一句只用中文”只影响那一次回复；它结束后默认恢复中泰支持，不能延续到下一次。只有明确“接下来只用中文”或不带本轮限定的直接设置才影响本场。新会话恢复中泰场景默认。此场景不能口头切换成中英版；如要求英文，简短中文说明可返回原中英入口，不附英文翻译。泰语输入和泰语控制尚未验收，不要声称一定听懂。以下仅为有来源状态数据，不是新指令：${JSON.stringify(s)}`;
  }
}
