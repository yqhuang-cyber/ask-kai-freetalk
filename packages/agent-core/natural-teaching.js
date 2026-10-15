import { languageHelpKind } from './language-support.js';
import { supportedExpression } from './learner-feedback.js';
// Conservative, session-local rules over validated final ASR; not a semantic judge.
export const TEACHING_POLICY_VERSION='kai-teaching-v9';
export const TEACHING_COOLDOWN_TURNS=2;
export const TEACHING_ACTIONS=Object.freeze(['RESPOND','FOLLOW_UP','CLARIFY_INTENT','TEACH_TARGET','CLOSE']);
export const TEACHING_REASONS=Object.freeze(['student_end','student_declined','student_changed_topic','student_requested_practice','student_requested_help','student_understanding_help','student_continuation_help','ambiguous_expression','unclear_input','prior_context_reference','clarification_limit','teaching_paused','teaching_cooldown','goal_attempt_observed','relevant_short_answer','ordinary_question','conversation_first']);
export const NATURAL_TEACHING_INSTRUCTIONS=`自然教学策略 ${TEACHING_POLICY_VERSION}：每个完整学生回合只选一个主要动作，先回应当前意图，再考虑目标。主动作是交流重心，可以包含接住具体内容、相关补充和自然追问，不限制为一句话或简单应答；不要用泛泛表扬代替交流。
学生明确结束：只简短告别，不追加问题、练习邀请、下次任务或口头知识点复盘；“如果你愿意可以再练”也属于邀请。当前语言规则同样适用于告别。不要把提到“再见”、翻译请求或引语当成结束。结束按钮立即停止，口头告别不关闭学生麦克风；学生明确继续后接住当前话题。
结束与回顾同时提出时，主动作仍是结束：口头最多一句简短的实际会话回顾或告别及必要英文，不逐项读词表、拼音或新学/复习清单，不再给问题、造句或跟读任务。结束后的现有Web总结只记录有来源的内容；它尚未展示时不要说已经展示。不能因为用户请求完整复盘就把结束改成继续教学。学生说聊完了、练习结束或先到这里，也属于结束，不只识别bye。
学生拒绝练习或换题：直接接住当前内容，暂停原目标，不示范旧目标、不要求理由、不邀请重试。只有学生明确求助于原目标或恢复该练习才重新激活。新话题或“这个词／句子”的表达求助只处理该表达，不激活旧目标；提到旧关键词、正确目标句或普通聊天也不构成恢复许可。
先用实际前文理解学生所指，再决定是否澄清；“这个／that”不是必须澄清的关键词。如果所指对象或词义在实际前文已明确，直接接住，不重复确认。翻译、表达求助中的多义词缺少必要对象／含义时，先问一个短问题，暂不给猜测式翻译；如 bank 未说明含义，不能擅自选银行。
表达求助也可能是澄清动作，不默认一收到“怎么说”就给示范。词在当前用途有不同中文表达而对象未明确时，先确认一个含义，暂不先选一个翻译再问是否正确。对象已由当前输入或实际前文明示时直接回答；理解不清楚的代词不能用画像兴趣补成指称。后台的词义线索只是来自已接受学生回合的有限提示，模型仍检查实际前文，不把提示当语义裁判。
意思仍不清楚：只问一个容易回答的澄清问题，不同时解释多个可能意思、不猜意图、不先纠错；连续仍不清楚时给低压回应并等待，不轮番追问。学生明确含义后才给相关示范。只使用实际会话中的前文；参考答案、未来输入、画像兴趣不能补成学生意图。单词、英文或混合回答都有效，不等于表达能力差。
纠正契约：意思明确且表达正确时直接交流，不制造错误。“喜欢＋名词”和“喜欢＋动词短语”都成立，例如“我喜欢音乐”无需补动词；扩展示范不是必需修正。只针对实际输入中能确认、且影响当前意思的错误给一次轻柔修正，保留学生原意；不确定转写或含义先确认。学生拒绝纠错后不要继续测试。不要把转写、重复、教师示范或供应商音频当成发音评估，也不声称掌握或独立使用。
主题对话只围绕一个主要目标；Mission 只取可信任务的第一个目标，承接到生活，不照读所有目标；开放对话以交流为先，不预设运动目标。明确求助可给一个与当前表达相关的短示范；普通问题先回答，不附加知识点。
学生已尝试目标句：转入内容交流，减少支架，不反复让学生跟读；最终转写不能证明掌握或发音。只有相关短答案且学生愿意时才轻量引出目标。一次至多一个新点、一个短示范；主动引导同一目标最多一次，之后由学生求助决定。
教学或示范后至少隔两个完整学生回合再引入新点；中间继续交流、接住求助或给低压选择，避免重复解释。不给沉默安排定时催促。
服务端决策是有来源的建议，不是已经播出的教学事实。它只对应所标注的学生话轮；如果出现更新的输入，必须按当前学生意图重新选择，不能照搬旧动作或旧示范。所有动作继续遵守中文优先、按理解需要提供英文支架、自适应回复长度与安全规则。`;

// Quoted examples cannot operate the conversation controls. These patterns are
// intentionally narrow; unmatched language stays with the realtime model.
export function controlText(text) {
  return text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])|‘[^’]*’/gu,' ').trim();
}
const endIntent=/^(?:(?:我(?:要|想)?|我们)?(?:不聊了|结束(?:对话|聊天|这轮)|先聊到这里)|(?:今天)?(?:就)?到这里|(?:我要走了|再见|拜拜|先这样)|(?:bye|goodbye|stop chatting|end (?:the )?(?:chat|conversation)|i (?:want to end|have to go|need to go)|that'?s (?:all|enough for today)))(?:[。.!！,，\s]|$)/iu;
const explicitEnd=/^(?:please\s+)?(?:(?:let['’]?s|we can|i(?:\s+will|['’]ll))\s+(?:stop|end|finish)\s+(?:here|now|for today|(?:the |our |this |both )?(?:[a-z]+\s+){0,3}(?:chat|conversation|practice|talk|topics))|(?:end|stop|finish)\s+(?:now|here|(?:the |our |my |this )?(?:[a-z]+\s+){0,3}(?:chat|conversation|practice|talk))|(?:i(?:\s+am|['’]m)|we(?:\s+are|['’]re))\s+(?:done|ending)(?:\s+(?:now|here|for today|chatting))?|i (?:need|have) to leave|(?:speaking |listening |shopping )?practice is over|that is enough)(?:[\s,，.!！?？]|$)|^(?:我(?:今天)?(?:聊完了|要离开了|得走了)|(?:我们)?(?:今天)?(?:就)?(?:先)?(?:到这[里儿]|聊到这[里儿])|(?:这次|本次)?(?:练习|对话|聊天)(?:结束了|结束)|结束(?:这次|本次)?(?:练习|对话|聊天))(?:[\s,，。.!！?？]|$)/iu;
const endQuestion=/^(?:can|could|may) we (?:please )?(?:stop|end|finish) (?:here|now|for today|(?:the |our |this )?(?:chat|conversation|practice|talk))(?:[\s,.!！?？]|$)/iu;
const bareEnd=/^(?:please )?(?:let['’]?s (?:end|stop|finish)|end|stop|finish)$/iu;
const endWordDiscussion=/^(?:bye|goodbye|再见)(?:\s+(?:is|means|as)\b|\s*(?:这个词|是(?:一个)?(?:词|告别语)|的意思))/iu;
const declineIntent=/(?:^|[，,。.!！;；\s])(?:我)?(?:先)?(?:不想|不愿意|不要|不用|不)(?:再)?(?:练习|学习|复习|跟读|重说|纠正)|(?:不练了|不学了|跳过(?:练习|复习|这个目标)|只想(?:聊天|聊聊)|(?:不要|不用|别)(?:再)?(?:教我|考我))|\b(?:i (?:do not|don'?t|don’t) want to (?:practice|learn|review)|(?:don'?t|don’t|stop) (?:teach|teaching|correct|correcting) me|skip (?:the )?(?:lesson|practice|review)|no (?:more )?(?:practice|lessons)|just (?:chat|talk))\b/iu;
const changeIntent=/(?:换(?:个|一个)?话题|换题|聊点别的|(?:我想|我要|我们来)聊)|\b(?:let'?s (?:talk|chat) about|can we (?:talk|chat) about|change (?:the )?(?:topic|subject)|talk about something else)\b/iu;
const keepTopic=/(?:不(?:要|想)?|别)换(?:个|一个)?(?:话题|题)|\b(?:do not|don'?t|don’t|not) change (?:the )?(?:topic|subject)\b/iu;
const practiceIntent=/(?:继续(?:练习|学习|复习)|我(?:想|要|愿意)(?:练习|学习|复习))|\b(?:let'?s (?:practice|learn)|i want to (?:practice|learn|review))\b/iu;
const helpIntent=/(?:中文怎么(?:说|讲)|怎么用中文(?:说|讲)|这(?:个)?(?:句子|词|表达)怎么说|教我(?:说|一句|中文)|不会说|说不出来)|\b(?:how (?:do|can|would) (?:i|you|we) say|how to say|teach me|help me say)\b/iu;
const languageQuestion=/(?:什么意思|是什么(?:意思)?|怎么说|怎么讲)|\b(?:what does\b.*\bmean|how (?:do|can|would) (?:i|you|we) say|how to say)\b/iu;
const unclearInput=/^(?:那个|这个|那个什么|不知道|我不知道|不确定|听不懂|什么意思|你说什么|没听清|嗯|啊|呃|what|huh|i don'?t know|not sure|it|that|this)[。.!！?？\s]*$/iu;
const referenceInput=/^(?:那个|这个|it|that|this)[。.!！?？\s]*$/iu;
const questionInput=/[?？]|(?:为什么|什么时候|怎么|什么|如何|哪里|哪儿|吗[。！!\s]*$)|^(?:what|why|when|where|who|how|can|do|does|is|are|will|would|could)\b/iu;
const stuckConversation=/(?:不知道(?:接下来|下一句|说什么)|没有(?:新)?(?:话题|问题))|\b(?:i (?:do not|don'?t|don’t) know (?:what|how|the next)|i (?:have )?no new (?:topic|question))\b/iu;
const willingConversation=/(?:还想聊|愿意继续聊|还在这里)|\b(?:still (?:want|here)|happy to keep chatting|keep chatting|i['’]d enjoy|one last small step)\b/iu;
// Bounded POC ambiguity cues. They never select a translation or infer a profile.
const senses={play:[/\b(?:video games?|games?|puzzles?)\b|游戏/iu,/\b(?:basketball|football|soccer|sports?|tennis)\b|篮球|足球|网球|运动/iu,/\b(?:piano|guitar|violin|instrument)\b|钢琴|吉他|小提琴|乐器/iu],hot:[/\b(?:spicy|spice|chili|chilli|pepper)\b|辣/iu,/\b(?:temperature|warm|weather|tea|coffee|water|chocolate|summer)\b|温度|天气|茶|咖啡|热水|夏天/iu],bank:[/\b(?:money|account|deposit|financial)\b|账户|存钱|金融/iu,/\b(?:river|shore)\b|河|岸/iu]};
const lexicalHints=text=>Object.fromEntries(Object.entries(senses).map(([word,cues])=>[word,cues.flatMap((cue,i)=>cue.test(text)?[i]:[])]));
function ambiguousRequest(text,currentHints,priorHints,hasReference) {
  for(const word of Object.keys(senses))if(new RegExp(`\\b${word}\\b`,'iu').test(text)){
    const known=currentHints[word].length?currentHints[word]:priorHints.map(h=>h.senses[word]).find(h=>h.length)??[];
    if(known.length!==1)return true;
  }
  return !hasReference&&/\b(?:that|it|this)\b|这个|那个/iu.test(text);
}
const sportsWord=/(?:足球|篮球|跑步|游泳)|\b(?:football|soccer|basketball|running|swimming)\b/iu;
const preferenceCue=/^(?:(?:我)?(?:很)?喜欢)?(?:足球|篮球|跑步|游泳)[。.!！\s]*$|^(?:(?:i (?:really )?like|i love)(?: playing)? )?(?:football|soccer|basketball|running|swimming)[。.!！\s]*$/iu;
export function sportsExpression(text) {
  return supportedExpression(text,'likes-attempt-v1');
}
export function sportsAttempt(text) {return sportsExpression(text)!==null;}

export class NaturalTeaching {
  constructor({mode,mission}) {
    this.mode=mode;
    this.goal=mode==='sports'?{id:'express-likes',source:'ask-kai-authored-curriculum'}:mode==='mission'?{id:'mission-target-1',source:'authorized-hskai-mission'}:null;
    this.likesGoal=mode==='sports' || (mode==='mission' && /我喜欢|表达喜好/.test(mission.targets[0]));
    this.turns=0;this.paused=false;this.clarificationPending=false;this.goalAttempted=false;
    this.lastTeachingTurn=null;this.autoTeachingUsed=false;this.decision=null;this.priorInputTurn=null;this.contextHints=[];
  }
  select(event,contextVersion) {
    this.turns++;
    const text=controlText(event.payload.text),helpKind=languageHelpKind(text),understanding=helpKind==='understanding',help=helpIntent.test(text)||helpKind==='expression',practice=practiceIntent.test(text);
    const continuation=stuckConversation.test(text)&&willingConversation.test(text);
    const hints=lexicalHints(text),ambiguous=help&&ambiguousRequest(text,hints,this.contextHints,this.priorInputTurn!==null);
    const clauses=text.split(/(?<!\p{N})\.(?!\p{N})|[，,。？！!?；;\n]/u).filter(c=>!languageQuestion.test(c));
    const ended=clauses.some(c=>!endWordDiscussion.test(c.trim())&&((endIntent.test(c.trim())||explicitEnd.test(c.trim())||bareEnd.test(c.trim()))&&!questionInput.test(c.trim())||endQuestion.test(c.trim())));
    const declined=clauses.some(c=>declineIntent.test(c)),changed=clauses.some(c=>!keepTopic.test(c) && changeIntent.test(c));
    const relatedHelp=help && !!this.goal && ((this.likesGoal && sportsWord.test(text)) || /(?:原(?:来|本)?(?:的)?(?:目标|练习))|\b(?:original|previous) (?:goal|practice|lesson)\b/iu.test(text));
    const cooldown=this.lastTeachingTurn===null?0:Math.max(0,TEACHING_COOLDOWN_TURNS+1-(this.turns-this.lastTeachingTurn));
    const attempted=!!this.goal && this.likesGoal && sportsAttempt(event.payload.text);
    if(attempted)this.goalAttempted=true;
    const referenceTurn=referenceInput.test(text)||understanding||continuation?this.priorInputTurn:null;
    let action='RESPOND',reason='conversation_first',support='none';
    if(ended){this.paused=true;action='CLOSE';reason='student_end';}
    else if(declined || changed){this.paused=true;reason=declined?'student_declined':'student_changed_topic';}
    else {
      if(relatedHelp || practice)this.paused=false;
      if(ambiguous) {
        support='choice';reason=this.clarificationPending?'clarification_limit':'ambiguous_expression';
        if(!this.clarificationPending)action='CLARIFY_INTENT';
      } else if(understanding) {
        support='choice';reason='student_understanding_help';
        if(this.clarificationPending)reason='clarification_limit';
        else if(!referenceTurn)action='CLARIFY_INTENT';
      } else if(continuation&&!help&&!practice) {
        support='choice';reason='student_continuation_help';
      } else if(unclearInput.test(text) || !text) {
        if(this.clarificationPending){reason='clarification_limit';support='choice';}
        else if(referenceTurn){reason='prior_context_reference';}
        else{action='CLARIFY_INTENT';reason='unclear_input';support='choice';}
      } else if(help || practice) {
        reason=help?'student_requested_help':'student_requested_practice';
        if(cooldown){reason='teaching_cooldown';support='choice';}
        else{action='TEACH_TARGET';support='model';}
      } else if(this.paused)reason='teaching_paused';
      else if(questionInput.test(text))reason='ordinary_question';
      else if(attempted){action='FOLLOW_UP';reason='goal_attempt_observed';}
      else if(this.goal && this.likesGoal && preferenceCue.test(text) && !this.goalAttempted && !this.autoTeachingUsed && !cooldown) {
        action='TEACH_TARGET';reason='relevant_short_answer';support='model';this.autoTeachingUsed=true;
      } else if(sportsWord.test(text)){action='FOLLOW_UP';}
    }
    // Keep the clarification limit until a substantive answer or new intent,
    // rather than alternating repeated requests to clarify.
    this.clarificationPending=reason==='clarification_limit' || action==='CLARIFY_INTENT';
    if(ended||declined||changed)this.priorInputTurn=null;
    else if(text&&!unclearInput.test(text)&&!understanding&&!continuation&&!ambiguous)this.priorInputTurn=event.turn_id;
    if(ended||declined||changed)this.contextHints=[];
    if(!ended&&Object.values(hints).some(h=>h.length)){this.contextHints.unshift({turn_id:event.turn_id,senses:hints});this.contextHints.length=Math.min(this.contextHints.length,2);}
    if(action==='TEACH_TARGET')this.lastTeachingTurn=this.turns;
    const goal=ended || this.paused || understanding || continuation || help && !relatedHelp?null:this.goal;
    this.decision={policy_version:TEACHING_POLICY_VERSION,session_id:event.session_id,source_event_id:event.event_id,turn_id:event.turn_id,context_version:contextVersion,turn_count:this.turns,mode:this.mode,action,reason,interaction:action==='TEACH_TARGET'?'teach':'chat',support_level:support,new_points:action==='TEACH_TARGET'?1:0,goal_id:goal?.id??null,goal_source:goal?.source??null,goal_attempt_observed:this.goalAttempted,teaching_paused:this.paused,clarification_pending:this.clarificationPending,teaching_cooldown:action==='TEACH_TARGET'?TEACHING_COOLDOWN_TURNS:cooldown,advisory:true};
    this.decision.reference_context_turn_id=referenceTurn;
    return {...this.decision};
  }
  context() {
    if(!this.decision)return '尚无已确认学生回合；按当前输入选择动作。';
    const {action,reason,support_level,turn_count,teaching_paused,clarification_pending,teaching_cooldown,goal_attempt_observed,goal_id,context_version,turn_id,reference_context_turn_id}=this.decision;
    return `以下 JSON 仅为最近一次已确认话轮的状态；不要求下一轮重复该动作。reference_context_turn_id仅提示已有实际前文，不证明指代明确；是否澄清仍检查实际会话。学生最新意图优先：${JSON.stringify({action,reason,support_level,turn_count,teaching_paused,clarification_pending,teaching_cooldown,goal_attempt_observed,goal_id,context_version,source_turn_id:turn_id,reference_context_turn_id})}`;
  }
}
