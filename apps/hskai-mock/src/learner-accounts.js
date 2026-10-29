import { syllabusInventory,inventorySummary } from './hsk-inventory.js';
import { savedRecapLines } from '../../../packages/agent-core/learning-summary.js';
import { immutable,validateLearnerContext } from '../../../packages/contracts/planning.js';

// Authored synthetic teaching scenarios, not an official HSK syllabus or certification.
export const LEARNER_FIXTURE_VERSION='mock-learners-v2';
const points=[
  ['likes-expression','表达喜好',['我喜欢篮球。','我不喜欢跑步。']],
  ['time-expression','简单时间表达',['我下午打篮球。','我上午跑步。']],
  ['greetings','问候与告别',['你好。','明天见。']],
  ['self-introduction','简单自我介绍',['我叫 Alex。','我是学生。']],
  ['numbers','数量与数字',['我有两个球。','我们有三个人。']],
  ['sports-vocabulary','常见运动词',['足球','篮球','跑步']],
  ['location-questions','询问地点',['你在哪里打球？','我在公园跑步。']],
  ['frequency-expression','表达频率',['我每周跑三次。','我经常打篮球。']],
  ['simple-reasons','说明简单原因',['因为运动让我开心。','所以我想继续跑步。']],
  ['event-sequence','叙述事件顺序',['先热身，再跑步。','打完球以后，我回家了。']],
  ['past-experience','描述过去经历',['上周我参加了比赛。','我以前打过篮球。']],
  ['plans-and-duration','表达计划与持续时间',['我打算周末去跑步。','我练了半个小时。']],
  ['comparison','比较不同选择',['跑步比足球更方便。','两种运动各有好处。']],
  ['pros-and-cons','解释利弊',['团队运动有趣，不过时间不容易协调。']],
  ['supporting-opinions','用理由支撑观点',['我更看重配合，因为个人能力也需要团队支持。']],
  ['conditional-reasoning','讨论条件与结果',['如果只看比分，就可能忽略队员的进步。']],
  ['qualified-claims','限定观点适用范围',['这在业余比赛中可能成立，但职业比赛有所不同。']],
  ['counterargument','回应不同立场',['我理解这个观点，不过它没有考虑长期影响。']],
  ['register-and-nuance','调整语体与措辞',['与其说完全不公平，不如说规则仍有改进空间。']],
  ['tradeoff-argument','讨论抽象权衡',['竞技成绩与公平之间的取舍，需要考虑规则的目的。']]
];
const accounts=[
  {uid:'poc-learner',name:'Alex',level:'HSK1',count:8,mastered:points.slice(0,7).map(p=>p[0]),practicing:['frequency-expression'],introduced:[],review:['frequency-expression'],sports:'足球、篮球',pace:'slow',comprehension:'beginner',motivation:'希望用中文和朋友进行简单日常交流。',routine:'周末和朋友踢足球，也喜欢看篮球；一次通常运动半小时。',style:'喜欢具体问题和选项，需要时希望听到一句短示范。',other:['音乐','校园生活'],ability:'模拟已完成HSK1；能独立进行熟悉生活场景的简单交流，喜好、时间与地点表达已稳定。进入HSK2后，频率和经历表达仍需局部支架；陌生词可用短英文。',focus:'frequency-expression',difficulty:'基础喜好、时间和地点问句可独立使用；表达每周次数时偶尔需要局部提示。',next:'希望下次继续聊自己喜欢的运动。'},
  {uid:'mock-maya-hsk3',name:'Maya',level:'HSK3',count:12,mastered:points.slice(0,12).map(p=>p[0]),practicing:[],introduced:[],review:['event-sequence'],sports:'跑步、篮球',pace:'slow',comprehension:'comfortable',motivation:'希望用中文讲清楚自己的生活和运动习惯。',routine:'每周跑步三次，偶尔和同事打篮球；正在养成规律运动的习惯。',style:'愿意先自己表达，卡住时希望得到局部提示。',other:['旅行','烹饪'],ability:'模拟已完成HSK1至3，继承低级语法和词汇背景；能有效交流日常生活、工作和学习，独立叙述熟悉经历与简单原因。陌生运动词及较长叙述组织仍可需要帮助。',focus:'event-sequence',difficulty:'基本先后顺序已稳定；讲一次意外中断的跑步经历时，时间跨度和信息取舍需要建议，不能据此判定没有掌握一级至三级知识。',next:'希望下次聊怎样坚持运动。'},
  {uid:'mock-leo-hsk5',name:'Leo',level:'HSK5',count:16,mastered:points.slice(0,12).map(p=>p[0]),practicing:['comparison','pros-and-cons','supporting-opinions'],introduced:['conditional-reasoning'],review:['supporting-opinions'],sports:'足球、篮球比赛',pace:'normal',comprehension:'comfortable',motivation:'希望自然参与中文讨论，能把自己的观点和理由说清楚。',routine:'每周踢一次足球，关注篮球比赛；尤其在意团队配合。',style:'希望先聊内容，再对影响表达的一个问题给反馈。',other:['电影','团队活动'],ability:'能比较选择、解释原因和描述经历；需要练习展开论据与准确措辞，基础喜好和时间句已有跨情境独立证据。',focus:'supporting-opinions',difficulty:'比较个人运动和团队运动时，观点明确但理由较笼统，需要一个具体例子。',next:'希望继续讨论团队配合与个人技术。'},
  {uid:'mock-nina-hsk7',name:'Nina',level:'HSK7',count:20,mastered:points.slice(0,16).map(p=>p[0]),practicing:['qualified-claims','counterargument','register-and-nuance'],introduced:['tradeoff-argument'],review:['qualified-claims','register-and-nuance'],sports:'羽毛球、篮球赛事',pace:'normal',comprehension:'comfortable',motivation:'希望通过有深度的中文交流练习立场限定、反驳与细微措辞。',routine:'每周打羽毛球，也关注篮球赛事和体育文化；对竞技公平感兴趣。',style:'希望平等讨论，需要时指出措辞或语气的细微差异。',other:['文化','公共议题'],ability:'能讨论抽象问题、回应不同立场；观点限定、反驳和语气仍需打磨，不应重复基础句型练习。',focus:'qualified-claims',difficulty:'讨论竞技公平时曾用过过于绝对的判断；希望保留立场并增加适用范围。',next:'愿意继续聊成绩、规则和体育精神之间的关系。'},
  // Keep the existing UID stable; its old level suffix is not the current level.
  {uid:'mock-dao-hsk4',name:'Dao',level:'HSK1',nativeLanguage:'泰语',count:8,mastered:points.slice(0,7).map(p=>p[0]),practicing:['frequency-expression'],introduced:[],review:['frequency-expression'],sports:'羽毛球',pace:'slow',comprehension:'beginner',seedComprehension:true,lifeContext:'27岁，居住曼谷，是社区咖啡馆店长；学中文约4个月，每周约5小时，中文交流需要慢速短句与泰语帮助。',motivation:'希望先用简单中文介绍自己、说喜欢的食物和日常安排。',routine:'每周打两三次羽毛球，打完有时去夜市。',style:'中文初学者，需要慢速、短句和对应的泰语帮助，不预设已经听懂。',other:['夜市小吃','烹饪'],ability:'当前为HSK1中文初学者，只接触过基础问候、自我介绍、喜好、时间和地点表达；不预设能独立理解熟悉交流，需要对应泰语帮助理解。',skillProfile:{listening:'需要慢速、简单中文和对应泰语帮助；不预设能独立听懂日常交流。',speaking:'尝试使用基础问候、自我介绍和喜好短句，表达频率时仍需要提示。',reading:'接触过基础词语和简单菜单，阅读仍需帮助。',writing:'尝试写姓名和简单短句。',translation:'未评估；泰语帮助不算翻译成绩。'},focus:'frequency-expression',difficulty:'想说每周打几次羽毛球时仍需短句示范和泰语帮助，不预设已经理解。',next:'希望下次用简单中文聊喜欢的小吃。'}
];
export const MOCK_LEARNERS=immutable(accounts.map(a=>({uid:a.uid,owner_id:'poc-owner',learner_id:a.uid,market:'SG',name:a.name,course_level:a.level,fictional:true})));
export const mockLearner=uid=>MOCK_LEARNERS.find(a=>a.uid===uid);

export function accountContext(identity,{revision=1,memory=[],now=Date.now(),fixtureAt=now,records=[]}={}) {
  const a=accounts.find(a=>a.uid===identity.learner_id);
  if(!a||identity.owner_id!=='poc-owner')throw new Error('UNKNOWN_MOCK_LEARNER');
  const as_of=new Date(now).toISOString(),value=(field,fallback)=>memory.find(r=>r.field===field)?.value??fallback;
  const id=suffix=>`${a.uid}-${suffix}`;
  // Anchor evidence at backend startup; reading the same revision must not
  // silently refresh history dates or manufacture new mastery evidence.
  const provenance=(suffix,days)=>({record_id:id(suffix),source:'mock_hskai',updated_at:new Date(fixtureAt-days*86400000).toISOString()});
  const owned=points.slice(0,a.count),mastered=new Set(a.mastered),practice=new Set(a.practicing),introduced=new Set(a.introduced);
  const status=kp=>mastered.has(kp)?'mock_mastered':practice.has(kp)?'practicing':introduced.has(kp)?'introduced':'not_started';
  const skills={
    HSK1:{listening:'能理解慢速、熟悉的生活问句和时间信息；陌生运动词需澄清。',speaking:'能用短句介绍自己、表达喜好、时间和地点；频率与经历还在学习。',reading:'能读简单菜单、时间表和短短信；长段落尚不稳定。',writing:'能填写基本信息并写简单生活短句。',translation:'本场景未评估翻译能力。'},
    HSK3:{listening:'能理解熟悉生活、学习和工作场景的正常语速交流；较长信息需确认细节。',speaking:'能叙述熟悉经历、说明原因和安排，复杂故事的信息组织仍需练习。',reading:'能理解日常通知、邮件和短叙事；专业术语需帮助。',writing:'能写日常邮件与有先后顺序的短文，复杂段落衔接仍需修改。',translation:'本场景未评估翻译能力。'},
    HSK4:{listening:'能理解店铺、生活和工作里熟悉话题的正常偏慢交流；少见词和抽象议论需要确认。',speaking:'能讲清熟悉经历、原因、安排和简单比较；把条件和结果说完整时仍需组织。',reading:'能读菜单、通知、短消息和不太长的说明；新闻评论还不稳定。',writing:'能写日常消息和有先后顺序的短说明。',translation:'本场景未评估翻译能力。泰语帮助不算翻译成绩。'},
    HSK5:{listening:'能理解一般工作讨论与较长说明，少见术语需澄清。',speaking:'能进行准确的工作和学习交流；复杂观点的例证与限定仍需打磨。',reading:'能读一般工作资料、新闻评论和非专业长文。',writing:'能组织说明与观点文章；精确措辞和论据展开是当前练习点。',translation:'本场景未设正式翻译成绩。'},
    HSK7:{listening:'能跟随通用专业讨论、访谈及学术性说明；高度专门术语不默认已知。',speaking:'能规范、流利地展开论述并回应反例；判断范围和语气需情境化打磨。',reading:'能读一般专业和通用学术文章，识别论证结构与立场。',writing:'能写结构完整的说明、评论与议论，复杂措辞仍会主动修订。',translation:'模拟能转述并翻译一般说明材料；专门术语与正式译文质量仍需复核。'}
  };
  const examples={
    HSK1:{attempt:'我喜欢足球。我下午和朋友踢球。',help:'我每个星期踢两……',feedback:'老师只提供“一周两次”的局部提示。'},
    HSK3:{attempt:'上周六我先跑步，然后和同事打了篮球。',help:'我想讲下雨以后我们改了安排，但是不知道先讲哪件事。',feedback:'老师建议先交代改计划的原因，再补时间线；不重新教基础先后句。'},
    HSK4:{attempt:'这家店比夜市方便，不过夜市更好玩。',help:'我想说改配方的原因，可是不知道先讲客人还是味道。',feedback:'老师建议先讲客人的要求，再讲改了什么；不重教因果句。'},
    HSK5:{attempt:'团队运动能锻炼合作能力，不过约时间比较困难。',help:'我觉得配合更重要，但我举的例子不太能说明原因。',feedback:'老师请他用一次实际比赛的情境说明观点，并限定比较条件。'},
    HSK7:{attempt:'评价比赛规则时，应当区分竞技目标与参与者的体验。',help:'我说“所有比赛都只重视成绩”，这个判断太绝对了。',feedback:'老师建议区分职业与业余比赛，再限定判断适用范围。'}
  }[a.level];
  const history=[
    {...provenance('choice',1),activity_type:'ask_kai',resource_id:'sports',kp_ids:[a.focus],observations:[`合成学习者选择：${a.next}`],declined_goal_ids:[],complete:true},
    {...provenance('help',2),activity_type:'ask_kai',resource_id:'sports',kp_ids:[a.focus],observations:[`合成困难记录：${a.difficulty}`,`作者合成表达：${examples.help}`,`合成反馈：${examples.feedback}`],declined_goal_ids:[],complete:true},
    {...provenance('practice',3),activity_type:'lesson',resource_id:'sports',kp_ids:a.practicing,observations:[a.practicing.length?'合成记录：本次对列出的交流技能提供局部提示；不改变累计基础知识。':'合成记录：本次练习较长叙述组织；基础结构已掌握，不将一次卡住登记为基础知识未学。',`作者合成表达：${examples.attempt}`,a.difficulty],declined_goal_ids:[],complete:true},
    {...provenance('presentation',5),activity_type:'lesson',resource_id:'sports',kp_ids:a.introduced,observations:[a.introduced.length?'合成记录：看过新交流技能示例，尚未独立输出。':`合成记录：开始接触${a.level==='HSK7'?'高级共同范围中的新材料':`HSK${Number(a.level.slice(3))+1}阶段内容`}，未由呈现推断掌握。`],declined_goal_ids:[],complete:true},
    {...provenance('transfer',7),activity_type:'ask_kai',resource_id:'sports',kp_ids:a.mastered,observations:['作者设定的模拟掌握证据：在朋友约运动的新语境中无直接提示使用这些知识点；不是本轮真实评估。'],declined_goal_ids:[],complete:true},
    {...provenance('foundation',10),activity_type:'lesson',resource_id:'daily-life',kp_ids:a.mastered,observations:['作者设定的模拟掌握证据：在日常交流复习中独立使用这些知识点；与运动迁移记录共同构成 Mock 背景。'],declined_goal_ids:[],complete:true}
  ];
  const kp_states=owned.map(([kp])=>({...provenance(`kp-${kp}`,3),kp_id:kp,skill_dimension:'oral_expression',evidence_state:mastered.has(kp)?'demonstrated_transfer':practice.has(kp)?'prompted_attempt':introduced.has(kp)?'presented':'unknown',support_needed:mastered.has(kp)?'none':practice.has(kp)?a.level==='HSK1'?'model':'partial':'unknown',evidence_refs:mastered.has(kp)?[id('foundation'),id('transfer')]:practice.has(kp)?[id('practice'),...(kp===a.focus?[id('help')]:[])]:introduced.has(kp)?[id('presentation')]:[]}));
  for(const saved of records)history.unshift({record_id:saved.receipt_id,source:'mock_hskai',updated_at:saved.updated_at??as_of,activity_type:'ask_kai',resource_id:saved.record.resource_ref?.id??'free',kp_ids:[...new Set(saved.record.observations.map(o=>o.kp_id))],observations:savedRecapLines(saved.record.session_recap),declined_goal_ids:[],complete:saved.record.outcome==='ended'});
  const interest=value('interest',null);
  return validateLearnerContext({schema_version:'learner-context-v1',snapshot_id:`ctx-${a.uid}-${revision}`,owner_id:identity.owner_id,learner_id:a.uid,revision,as_of,source:'mock_hskai',coverage:{student_profile:'available',learning_profile:'available',learning_history:history.length>10?'partial':'available'},history_page:{truncated:history.length>10,next_cursor:history.length>10?'more-history':null},student_profile:{preferred_name:a.name,age_band:'adult',native_language:a.nativeLanguage??'en',interests:interest?[{...provenance('interest',0),updated_at:memory.find(r=>r.field==='interest')?.updated_at??as_of,topic_id:'sports',label:interest}]:[],avoided_topics:[],conversation_preferences:{correction:value('correction_preference','gentle'),pace:a.pace},background:{life_context:a.lifeContext??({HSK1:'22岁，本科生，居住新加坡；学中文4个月，每周约5小时。',HSK3:'29岁，产品运营，居住新加坡；学中文2年，每周约6小时。',HSK4:'27岁，曼谷一家社区咖啡馆的店长；学中文约3年，每周约6小时，常跟中国顾客和供货商聊菜单、口味和安排。',HSK5:'34岁，工程项目经理，居住新加坡；学中文4年，每周约7小时。',HSK7:'39岁，教育研究员，居住新加坡；学中文8年，经常阅读中文专业材料。'})[a.level],learning_motivation:a.motivation,sports_routine:a.routine,conversation_style:a.style,other_interests:a.other}},learning_profile:{course_level:a.level,language_support:value('support_language','auto'),comprehension:value('chinese_comprehension',a.comprehension),kp_states,review_candidates:a.review,reported_known_expressions:value('known_expressions',[]),ability_summary:a.ability,skill_profile:a.skillProfile??skills[a.level],syllabus_summary:inventorySummary(syllabusInventory(identity,a.level,{fixtureAt})),knowledge_points:owned.map(([kp_id,label,examples])=>({kp_id,label,examples:kp_id==='self-introduction'?[`我叫 ${a.name}。`,'我是学生。']:examples,mastery_status:status(kp_id),evidence_origin:'authored_fixture'}))},learning_history:history.slice(0,10)},identity,now);
}
export function accountMemory(uid,now=Date.now()) {
  const a=accounts.find(a=>a.uid===uid);if(!a)throw new Error('UNKNOWN_MOCK_LEARNER');
  const values={interest:a.uid==='poc-learner'?'足球':a.sports,...(a.level==='HSK1'&&!a.seedComprehension?{}:{support_language:'auto',chinese_comprehension:a.comprehension})};
  return Object.entries(values).map(([field,value])=>({field,value,source:'authorized_hskai_profile',updated_at:new Date(now).toISOString(),expires_at:new Date(now+30*86400000).toISOString()}));
}

export function accountSyllabusInventory(identity,options={}) {
  const a=accounts.find(a=>a.uid===identity.learner_id);if(!a||identity.owner_id!=='poc-owner')throw new Error('UNKNOWN_MOCK_LEARNER');
  return syllabusInventory(identity,a.level,options);
}
