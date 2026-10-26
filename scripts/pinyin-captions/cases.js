// Authored fixtures, not learner transcripts. Orthographic tones, no tone sandhi.
export const READING_CASES=[
  {id:'greeting',text:'你好，我是Kai。 Nice to meet you!',expected:'nǐ hǎo wǒ shì'},
  {id:'english',text:'Nice to meet you, Alex! 2026 😊',expected:''},
  {id:'numbers',text:'我有2个苹果，价格是¥5。',expected:'wǒ yǒu gè píng guǒ jià gé shì'},
  {id:'music',text:'我喜欢音乐，也很快乐。',expected:'wǒ xǐ huan yīn yuè yě hěn kuài lè'},
  {id:'bank',text:'银行行长说这样很行。',expected:'yín háng háng zhǎng shuō zhè yàng hěn xíng'},
  {id:'repeat',text:'重复一次，然后去重庆。',expected:'chóng fù yī cì rán hòu qù chóng qìng'},
  {id:'return-book',text:'我还没还书。',expected:'wǒ hái méi huán shū'},
  {id:'headteacher',text:'我想长大后当校长。',expected:'wǒ xiǎng zhǎng dà hòu dāng xiào zhǎng'},
  {id:'neutral',text:'妈妈说孩子已经睡着了。',expected:'mā ma shuō hái zi yǐ jīng shuì zháo le'},
  {id:'base-tones',text:'一个，不是，第一。',expected:'yī gè bù shì dì yī'},
  {id:'back',text:'背包放在背上。',expected:'bēi bāo fàng zài bèi shàng'},
  {id:'loan',text:'重庆银行行长重新还款。',expected:'chóng qìng yín háng háng zhǎng chóng xīn huán kuǎn'},
  {id:'mixed',text:'我喜欢 basketball，也喜欢跑步！',expected:'wǒ xǐ huan yě xǐ huan pǎo bù'},
  {id:'security',text:'中文 <img src=x onerror=alert(1)> & English',expected:'zhōng wén'},
  {id:'line-breaks',text:'你好。\n今天怎么样？',expected:'nǐ hǎo jīn tiān zěn me yàng'},
  {id:'traditional',text:'銀行的音樂很好聽。',expected:'yín háng de yīn yuè hěn hǎo tīng'},
];
export const CUSTOM_READINGS={'还书':'huán shū','还款':'huán kuǎn'};
export const NATIVE_CASES=[
  {id:'off',text:'帮我把字幕上的拼音关掉，中文保留。',voice:'Tingting',initial:true,expected:false},
  {id:'on',text:'把字幕上的拼音重新打开。',voice:'Tingting',initial:false,expected:true},
  {id:'keep',text:'不要关掉拼音，继续显示。',voice:'Tingting',initial:true,expected:null},
  {id:'quote',text:'“关闭拼音”用英文怎么说？',voice:'Tingting',initial:true,expected:null},
  {id:'off-en',text:'Please hide the pinyin in the captions but keep the Chinese.',voice:'Samantha',initial:true,expected:false},
  {id:'off-question',text:'关闭拼音，然后告诉我银行是什么意思。',voice:'Tingting',initial:true,expected:false}
];
