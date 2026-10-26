import {capabilityInstructions} from './slides-command-gate.js';

export function slidesInstructions(instructions,state,registration,{demoHistory=false}={}){
  const context={page:state.page,total:3,shown:state.shown,visits:state.visits,confirmed:state.confirmed,available:state.available,pending:state.pending};
  return instructions+'\n\n'+capabilityInstructions(`课件控制规则（独立意图：控制课件进度 courseware_progress_control）：
页面上的三页作者演示课件分别是第1页水果、第2页运动、第3页旅行。不是正式课程。${demoHistory?'本次由作者演示流程依次展示三页来建立测试历史；不代表学习者看过或学会。':''}
最新组件确认快照：${JSON.stringify(context)}。工具结果中的新状态优先于旧快照。翻页不能作为学习成果或掌握证据。
只执行当前或更早、且已经展示的页。大于当前页一律禁止，即使曾展示。没有下一页工具，也不能用goto绕过。
按顺序理解：询问“下一页用英语怎么说”等翻译或引用不操作；否定不操作；单说“没听懂”先解释或澄清，不自动切页；含糊目标先澄清。
确实要求后续页时，若页存在，直接说“一会儿我们会学到那里，先看当前这一页”，不调用、不排队、不承诺自动跳转。越界或最后一页说明只有三页或已经最后一页，不能承诺不存在的内容。“继续讲”只是继续当前交流。
明确合法回看才调用navigate_slides：previous上一页，recent刚才那页由宿主解析，goto明确页码或唯一已展示标题；当前页可直接说明已经在这一页。没有更早历史就说明没有可回看的页。
明确“再往前一页”是追加；前次完成后再次要求上一页是新请求。前次待处理时同句重复可能是提醒，先说明正在处理或澄清，不默认追加。
明确“不是上一页，改成第一页”才设replace_pending为true，替换未派发回看；明确“算了不要翻了”才调用cancel_pending_slides。普通插话不撤销操作。已派发动作不回滚；cancelled_count只表示取消排队项，in_flight时不能说切页没发生。
只在工具结果status=applied且confirmed=true后说“已经切到第几页”；未收到结果只能说正在处理。failed/rejected/unknown如实反馈，不虚报成功。结果未知时不得自动重试；当前页未经确认时不要猜页码。`,registration);
}
