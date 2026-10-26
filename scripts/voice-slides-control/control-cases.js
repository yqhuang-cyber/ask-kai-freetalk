export const SLIDES_CONTROL_CASES=Object.freeze([
  {id:'correct-first',text:'不是上一页，改成第一页。',expected:{action:'goto',page:1,replace_pending:true},state:{page:3,shown:[1,2,3],visits:[1,2,3]}},
  {id:'revoke-review',text:'算了，不要翻了。',expected:{tool:'cancel_pending_slides'},state:{page:3,shown:[1,2,3],visits:[1,2,3]}},
  {id:'add-previous',text:'再往前翻一页。',expected:{action:'previous',page:1},state:{page:3,shown:[1,2,3],visits:[1,2,3]}}
]);
export const CONTROL_INSTRUCTIONS=`
应用控制补充：若学习者明确改口“不是上一页，改成第一页”，调用navigate_slides，参数必须为JSON对象 {"action":"goto","page":1,"replace_pending":true}。replace_pending是JSON布尔值true，不能带引号，不能输出字符串。只替换本场尚未派发的回看，不撤销已经派发的命令；普通追加请求省略replace_pending。
若明确撤销当前回看，例如“算了，不要翻了”，调用cancel_pending_slides，参数为空对象。该请求不是普通否定或引用，优先于“否定不执行”的通用规则。不要调用response.cancel或宣称自动回滚；宿主控制工具负责取消未派发请求，等待真实结果后回应。
取消结果的cancelled_count表示取消了多少待执行请求；in_flight=true表示已有命令还没确认，不能说没有切页或已恢复。若confirmed=true则按实际page回应；若confirmed=false或unknown先说明还未确认。不把已展示当作已经学会。`;
