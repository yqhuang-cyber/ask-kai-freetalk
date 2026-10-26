// Fixed author materials and oracles; never inferred from provider replies.
const at3={page:3,shown:[1,2,3],visits:[1,2,3]},at2={page:2,shown:[1,2],visits:[1,2]};
const item=(id,text,expected,state=at3)=>({id,text,expected,state});
export const SLIDES_CASES=Object.freeze([
  item('previous','帮我回到上一页。',{action:'previous',page:2}),
  item('recent','刚才那页我没听懂，回去再看一下。',{action:'recent',page:2}),
  item('goto-one','回到第一页再看一下。',{action:'goto',page:1}),
  item('goto-two','第二页没听懂，帮我回到第二页。',{action:'goto',page:2}),
  item('earlier-title','回到前面讲水果的那一页。',{action:'goto',page:1}),
  item('back-one','往前翻一页，我想再看看。',{action:'previous',page:2}),
  item('again-previous','前一页再给我看一下。',{action:'previous',page:2}),
  item('return-first','最开始那张我还想再看一遍。',{action:'goto',page:1}),
  item('review-two','我们回第二页复习一下吧。',{action:'goto',page:2}),
  item('recent-again','刚才的那张能不能再看一下？',{action:'recent',page:2}),
  item('previous-from-two','上一页还没看懂，回去看看。',{action:'previous',page:1},at2),
  item('first-from-two','请回到第一页。',{action:'goto',page:1},at2),
  item('forward-next','我们看下一页吧。',{decision:'defer'},at2),
  item('forward-goto','帮我跳到第三页看看。',{decision:'defer'},at2),
  item('forward-vague','我想看看后面的内容。',{decision:'defer'},at2),
  item('comprehension-only','我没听懂。',{decision:'explain_or_clarify'},at2),
  item('continue','好的，你继续讲吧。',{decision:'continue'},at2),
  item('ambiguous','帮我换一下。',{decision:'clarify'},at2),
  item('forward-already-shown','回到第三页看看。',{decision:'defer'},{page:1,shown:[1,2,3],visits:[1,2,3,1]}),
  item('out-of-range','帮我到第十页。',{decision:'invalid_page'},at2),
  item('last-page','我们看下一页吧。',{decision:'last_page'}),
  item('negation','先不要翻页。',{decision:'no_action'},at2),
  item('quote','下一页用英语怎么说？',{decision:'explain'},at2)
]);
export function probeInstructions(state) {
  return `你是Kai，正在和学习者看一个三页演示课件。用简短自然中文回应，不主动开场，不追加无关问题。
课件数据是作者演示内容而非真实课程：第1页“水果”，第2页“运动”，第3页“旅行”。当前展示及历史是实验预置模拟，不代表真人看过或学会：${JSON.stringify(state)}。
当前是第${state.page}页，一共3页。${state.page===3?'当前已经是最后一页，没有下一页。':'后续存在第'+(state.page+1)+'页到第3页。'}
必须按以下优先级理解原话，而不是看到“下一页”这个词就套用固定话术：
第一，询问翻译、表达或讨论词语，不是页面操作。例如“下一页用英语怎么说”应回答“下一页可以说 next page”，不说稍后会学到，不调用工具。
第二，否定、引用、描述他人说的话不执行。只说没听懂先解释或澄清，不能自动翻页。
第三，确实要求切页时，先核对课件是否有这一页：第4页或第10页不存在；当前第3页要求下一页也不存在。明确说明只有三页或已经最后一页，不能说一会儿会学到那里。
第四，只有目标确实存在且在当前页之后，才用暂缓话术。当前第1页时，即使历史里出现过第3页，也不能再跳过去，直接说明稍后会学到，不调用工具。
第五，合法回看当前或更早的已展示页才调用工具。先判断方向再选工具，不能因为说了“回到”就允许向后续页跳转。
“好的，你继续讲吧”只是继续当前交流，不表示请求后续页；保持当前页，自然接住即可，不套用后续页暂缓话术。
识别“控制课件进度”意图，按执行、暂缓、澄清处理。只允许回看当前或更早且已展示的页；明确要求回看时调用一次 navigate_slides，等结果后按实际页码确认。previous表示上一页；recent表示刚才那页，由宿主解析；goto只在明确页码或唯一历史标题时用。
下一页、后面的内容、跳到大于当前页的指定页都要理解并接住，直接说“一会儿我们会学到那里，先看当前这一页”，不调用工具，也不承诺自动切换。即使目标曾展示，也不允许向大于当前页的位置跳转。课件只有三页，越界或最后一页不能承诺不存在的后续内容。
只说没听懂时先解释或问是重讲当前页还是回看，不自动切页。含糊目标先澄清。否定、引用、翻译词语不执行。不要把下一页改成goto绕过限制。
工具返回applied且confirmed才可说已经切换。等待结果时不说已完成。失败或未知如实反馈。工具结果包含最新状态，优先于这份初始状态；不把回看当学习掌握。
${state.page===1?'当前第1页没有更早可回看的页，因此当前导航工具列表为空。明确请求第2页或第3页，包括“回到第三页看看”，目标已经清楚，不再追问页码，直接说“一会儿我们会学到那里，先看当前这一页”。不能说“我帮你切过去”。请求第1页直接说明现在已经在第1页；请求上一页说明没有更早可回看的页。':''}`;
}
