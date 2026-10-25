// Authored prompt candidates for an isolated native S2S experiment. These are
// hypotheses, not production instructions or demonstrated provider guarantees.
export const TUTOR_PACE_PROMPTS={
  neutral:'你是 Kai，一位温和、耐心的 AI 中文 Tutor。学生的母语是英语，正在学习中文。你会在中文和英文之间自然切换。两种语言都用自然正常的语速。',
  open_tutor:'你是 Kai，一位温和、耐心的 AI 中文 Tutor。学生的母语是英语，正在学习中文。根据学生当前请求调整说话方式。',
  identity_short:'你是 Kai，一位给零基础学生上课的 AI 中文老师。学生中文很弱，英文流利。讲中文时，像耐心示范新词一样慢慢说，发音节奏舒缓清楚。讲英文时，像与朋友聊天一样自然流畅地说，回到正常速度。',
  identity_zh:'你是 Kai，一位耐心细致、擅长照顾英语母语初学者的 AI 中文 Tutor。对面的学生听英文毫不费力，听中文却需要更多时间辨认声调和词语。你说中文时，自然进入耐心示范的教学状态：让每个意群内部的发音节奏明显舒缓下来，给学生跟上声音的时间，像面对面示范一个新表达。你说英文时，是用学生熟悉的语言轻松交流，立刻回到流利、自然的日常聊天节奏。这样的快慢转换是你作为双语老师的说话习惯。中文要让人听出从容慢讲，英文要让人听出自然流畅；保持同一身份和音色。不逐字蹦读，不拖长元音，不靠重复或长时间静音凑时长。直接用声音体现，不解释规则。',
  identity_en:'You are Kai, a patient AI Mandarin tutor talking to a native English speaker who is an absolute beginner in Chinese. Your teaching identity has two natural speaking registers. In Mandarin, model the sounds as an exceptionally patient tutor: speak at a noticeably unhurried beginner teaching pace, slowing the articulation within each phrase so the learner can follow the tones and words. In English, you are chatting in the learner\'s familiar language: immediately return to fluent, ordinary conversational English at a natural pace. Keep the same voice and personality. Make the difference audible whenever you switch languages, including within one reply. Do not stretch vowels, speak syllable by syllable, repeat words, or pad the reply with long silences. Perform these registers in your voice without describing them.',
  prosody:'你是 Kai，专业的 AI 双语中文老师。中文教学示范采用从容清楚的慢节奏，目标每秒约两个到两个半汉字，意群内部也慢，保留连读和自然声调；英文说明采用日常口语节奏，目标每分钟约一百五十个英文单词，英语单词之间流畅衔接。每次切换语言就切换相应的发音节奏。中文发声显著舒缓，英文发声自然流利。保持文本原样，不增加标点、不重复、不拖音、不逐字念，不通过额外长停顿替代发音速度，不朗读这些设置。',
  uniform_slow:'你是 Kai，一位正在给听力很弱的初学者做慢速语音示范的 AI 老师。无论说中文还是英文，都用非常缓慢、从容的发音节奏，大约平时的一半速度。每个意群内部也放慢，但保持连贯，不拖长单字，不添加内容、不重复，也不靠长静音凑时长。直接用声音表现极慢的节奏，不说明规则。',
  uniform_fast:'你是 Kai，一位正在做快速语音示范的 AI 老师。无论说中文还是英文，都用明显快速、流畅的发音节奏，大约平时的两倍速度。意群内部也加快，保持所有字词完整准确。不要解释语速，不省略词语，不朗读这些规则。'
};
const spokenQueries={
  zh:'我是中文初学者。请像耐心的中文老师一样，中文讲得很慢，英文正常。先只示范中文例句。',
  en:'我是中文初学者。请像耐心的中文老师一样，中文讲得很慢，英文正常。这次只示范英文例句。',
  mixed:'我是中文初学者。请像耐心的中文老师一样，中文讲得很慢，英文正常。请连续示范中文和英文两句例句。'
};
const naturalQueries={
  zh:'下午我想去公园散步。你有什么建议？请只用一句中文回答。',
  en:'下午我想去公园散步。你有什么建议？请只用一句英文回答。',
  mixed:'下午我想去公园散步。你有什么建议？先用一句中文回答，再用一句英文解释。'
};
const hanScope=Object.fromEntries(['zh','en','mixed'].map(kind=>[kind,'说汉语的时候慢一点，说英语的时候正常。'+({zh:'请读中文例句。',en:'请读英文例句。',mixed:'请连续读两句例句。'}[kind]) ]));
const hanVariants=Object.fromEntries(Object.entries(hanScope).map(([kind,text])=>[kind,[text.replace('汉语','中文'),text.replace('英语','英文'),text.replace('汉语','中文').replace('英语','英文')]]));
const voiceBatch=(voice,label)=>({canonical_input:true,sequence:['zh','en'],conditions:[1,2].flatMap(repeat=>['neutral','identity_short'].map(style=>({id:`bp05_${label}_${style}_r${repeat}`,style,voice,speed:0})))});
const demoText={zh:'下午我们去公园散步',en:'We can walk in the park'};
const demoQueries={zh:'请读中文例句。',en:'请读英文例句。'};
const demoBatch=repeat=>({canonical_input:true,sequence:['zh','en'],conditions:['natural','zh_slow'].map(mode=>({
  id:`bp03_${mode}_r${repeat}`,style:'open_tutor',speed:0,
  queries:Object.fromEntries(Object.entries(demoQueries).map(([kind,text])=>[kind,demoText.zh+'，'+demoText.en+'，'+text])),
  input_specs:Object.fromEntries(Object.entries(demoQueries).map(([kind,text])=>[kind,[
    {text:demoText.zh,voice:'Tingting',rate:mode==='zh_slow'?100:180},
    {text:demoText.en,voice:'Tingting',rate:180},{text,voice:'Tingting',rate:180}
  ]])),
  instructions:'你是 Kai，一位 AI 中文老师。学生的输入前半段是中文和英文的声音节奏示范，结尾才是例句请求。请沿用示范中各语言的发音节奏，用你自己的音色回应。最后请求中文时只说：今天下午，我们一起去公园散步，看看树上的小鸟，再聊聊你喜欢的事情。最后请求英文时只说：This afternoon, let\'s take a walk in the park, watch the birds in the trees, and talk about your favorite things. 不重复前面的示范材料，不添加问候、解释或标题。'
}))});
export const TUTOR_PACE_SUITES={
  bp02retry:{canonical_input:true,sequence:['zh','en'],conditions:[{id:'bp02_uniform_fast_r3_retry',style:'uniform_fast',speed:0}]},
  bp04:{canonical_input:true,sequence:['zh','en','request_slow','zh','en','zh'],conditions:[1,2,3].map(repeat=>({
    id:`bp04_conversation_r${repeat}`,style:'open_tutor',speed:0,control_kind:'request_slow',
    queries:{zh:'请读中文例句。',en:'请读英文例句。',request_slow:'说汉语的时候慢一点，说英语的时候正常。'},
    targets:{request_slow:null},output_kinds:{request_slow:'zh'},
    instructions:'你是 Kai，一位温和耐心的 AI 中文老师。学生提出声音节奏要求时，请自然调整当轮及后续回复的声音，用一句简短中文确认即可，不追加问题。起初用自然正常的节奏。听到“请读中文例句”时只说：今天下午，我们一起去公园散步，看看树上的小鸟，再聊聊你喜欢的事情。听到“请读英文例句”时只说：This afternoon, let\'s take a walk in the park, watch the birds in the trees, and talk about your favorite things. 例句之外不添加解释。切换例句不撤销学生已提出的语速要求。'
  }))},
  bp03a:demoBatch(1),bp03b:demoBatch(2),bp03c:demoBatch(3),
  // Official Tonelist-1 explicitly groups these 2.0 IDs with S2S full-duplex.
  bp05a:voiceBatch('zh_male_taocheng_uranus_bigtts','xiaotian2'),
  bp05b:voiceBatch('zh_female_vv_uranus_bigtts','vivi2'),
  bp01b:{canonical_input:true,sequence:['zh','en','mixed'],conditions:[
    {id:'bp01_han_scope',style:'open_tutor',speed:0,queries:hanScope,asr_variants:hanVariants},
    {id:'bp01_english_scope',style:'open_tutor',speed:0,query_voice:'Samantha',queries:{
      zh:'Please speak Mandarin slowly and English normally. Read the Chinese example.',
      en:'Please speak Mandarin slowly and English normally. Read the English example.',
      mixed:'Please speak Mandarin slowly and English normally. Read both examples.'
    }},
    {id:'bp01_short_diagnosis',style:'open_tutor',speed:0,queries:{
      zh:'中文慢慢说，英文正常说。请读中文例句。',
      en:'中文慢慢说，英文正常说。请读英文例句。',
      mixed:'中文慢慢说，英文正常说。请连续读两句例句。'
    }}
  ]},
  bp02a:{canonical_input:true,sequence:['zh','en'],conditions:[1,2].flatMap(repeat=>['neutral','uniform_slow','uniform_fast'].map(style=>({id:`bp02_${style}_r${repeat}`,style,speed:0})))},
  bp02b:{canonical_input:true,sequence:['zh','en'],conditions:['neutral','uniform_slow','uniform_fast'].map(style=>({id:`bp02_${style}_r3`,style,speed:0}))},
  bp01:{canonical_input:true,sequence:['zh','en','mixed'],conditions:[
    {id:'bp01_short_reference',style:'open_tutor',speed:0},
    {id:'bp01_spoken_scope',style:'open_tutor',speed:0,queries:{
      zh:'中文慢慢说，英文正常说。请读中文例句。',
      en:'中文慢慢说，英文正常说。请读英文例句。',
      mixed:'中文慢慢说，英文正常说。请连续读两句例句。'
    }}
  ]},
  tutor:{sequence:['zh','en','zh','en','mixed'],conditions:[
    {id:'tutor_neutral_0',style:'neutral',speed:0},
    {id:'tutor_identity_zh_0',style:'identity_zh',speed:0},
    {id:'tutor_identity_en_0',style:'identity_en',speed:0},
    {id:'tutor_prosody_0',style:'prosody',speed:0},
    {id:'tutor_uniform_slow_0',style:'uniform_slow',speed:0}
  ]},
  'tutor-controls':{sequence:['zh','en','mixed'],conditions:[
    {id:'tutor_neutral_omitted',style:'neutral',speed:null},
    {id:'tutor_short_omitted',style:'identity_short',speed:null},
    {id:'tutor_short_0',style:'identity_short',speed:0},
    {id:'tutor_spoken_identity_0',style:'neutral',speed:0,queries:spokenQueries}
  ]},
  'tutor-natural':{fixed_targets:false,sequence:['zh','en','zh','en','mixed'],conditions:[
    {id:'natural_neutral_0',style:'neutral',speed:0,queries:naturalQueries},
    {id:'natural_identity_0',style:'identity_short',speed:0,queries:naturalQueries},
    {id:'natural_uniform_slow_0',style:'uniform_slow',speed:0,queries:naturalQueries}
  ]},
  'tutor-spoken-short':{sequence:['zh','en','mixed'],conditions:[
    {id:'tutor_spoken_short_0',style:'open_tutor',speed:0,queries:{
      zh:'中文慢慢说，英文正常说。请读中文例句。',
      en:'中文慢慢说，英文正常说。请读英文例句。',
      mixed:'中文慢慢说，英文正常说。请连续读两句例句。'
    }}
  ]}
};
TUTOR_PACE_SUITES.bp04a={...TUTOR_PACE_SUITES.bp04,conditions:TUTOR_PACE_SUITES.bp04.conditions.slice(0,2)};
TUTOR_PACE_SUITES.bp04b={...TUTOR_PACE_SUITES.bp04,conditions:TUTOR_PACE_SUITES.bp04.conditions.slice(2)};
