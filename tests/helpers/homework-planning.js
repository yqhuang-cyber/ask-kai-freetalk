export class AuthoredHomeworkTransport {
 provider='synthetic';model='authored-test-model';calls=[];
 async completeJSON(request){this.calls.push(request);const input=JSON.parse(request.messages[1].content),{brief}=input;
  if(request.kind==='topic_generation')return {topic:brief.topic,role:brief.kind==='dining'?'餐厅服务员':'一起观察的朋友',opening:brief.kind==='dining'?'欢迎光临，你想吃什么？':'你注意到了什么？',context:'围绕'+brief.topic+'进行一段简短的生活交流。',materials:[{term:brief.kind==='dining'?'面条':'蝴蝶',example:brief.kind==='dining'?'我要一碗面条。':'这只蝴蝶是黄色的。'}],opportunities:[{id:'opp-1',label:'表达选择或观察',prompt:'你想先说什么？'},{id:'opp-2',label:'补充细节',prompt:'能再说一个细节吗？'}]};
  const caps=brief.kind==='dining'?['order_food','taste_preference']:brief.kind==='description'?['describe_appearance','describe_environment']:['narrate_experience'];return {goals:caps.map((capability_id,i)=>({capability_id,label:brief.kind==='dining'?(i?'表达口味要求':'点一种食物'):(i?'交流生活环境':'描述外观特征'),task:brief.kind==='dining'?(i?'说明一种口味要求':'点一种食物'):'围绕'+brief.topic+'说出一个相关细节',criterion:'观察学生是否进行了与目标相关的表达尝试',opportunity_ids:[i?'opp-2':'opp-1']})),support_options:['澄清','短句示范']};
 }
}
