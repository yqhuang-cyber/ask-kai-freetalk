// Application contract only. No supplier event names or learner data belong here.
export const COURSEWARE_INTENT='courseware_progress_control';
export const SLIDES_POLICY='review_only';
export const SLIDES_ACTIONS=Object.freeze(['previous','recent','goto']);
export function validateSlidesIntent(value) {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>['action','page','replace_pending'].includes(key))&&
    Object.hasOwn(value,'action')&&SLIDES_ACTIONS.includes(value.action)&&
    (!Object.hasOwn(value,'replace_pending')||typeof value.replace_pending==='boolean')&&
    (value.action==='goto'?Object.hasOwn(value,'page')&&Number.isSafeInteger(value.page)&&value.page>=1&&value.page<=3:!Object.hasOwn(value,'page')));
}
export const SLIDES_TOOL=Object.freeze({type:'function',name:'navigate_slides',
  description:'仅当学习者明确请求回看当前或更早、且已经展示的课件时调用。previous=上一页，recent=刚才那页，goto=明确指定页。下一页、后续页请求用语音说明稍后会学到，不调用工具。只说没听懂时先解释或澄清。必须等真实执行结果再确认完成。',
  parameters:Object.freeze({type:'object',properties:Object.freeze({
    action:Object.freeze({type:'string',enum:SLIDES_ACTIONS}),
    page:Object.freeze({type:'integer',minimum:1,maximum:3,description:'仅 goto 需要，必须是不大于当前页的已展示页'}),
    replace_pending:Object.freeze({type:'boolean',description:'JSON布尔值，只能是true或false，禁止字符串。仅明确改口时为true；替换尚未派发的回看，不撤回已派发命令。普通追加请求省略或false。'})
  }),required:Object.freeze(['action']),additionalProperties:false})});
export function validateSlidesCancellation(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0);}
export const SLIDES_CANCEL_TOOL=Object.freeze({type:'function',name:'cancel_pending_slides',
  description:'仅当学习者明确撤销待执行回看，例如“算了不要翻了”时调用。只取消本会话尚未派发的回看，不撤回已派发命令；不是停止音频。无待执行动作时也可返回无变化。普通否定、引用或普通插话不调用。根据 cancelled_count 和 in_flight 说明实际结果，不能声称已经发出的切页没有发生。',
  parameters:Object.freeze({type:'object',properties:Object.freeze({}),additionalProperties:false})});

// Only this application-owned tool family can be enabled on the reviewed voice adapter.
// Caller supplies a confirmed-state compilation, never an arbitrary function schema.
export function validateSlidesToolSet(tools){
  if(!Array.isArray(tools)||tools.length>2)return false;
  const kinds=new Set();
  return tools.every(tool=>{
    if(!tool||Object.keys(tool).some(key=>!['type','name','description','parameters'].includes(key))||tool.type!=='function'||typeof tool.description!=='string'||tool.description.length>2000)return false;
    const match=/^(navigate_slides|cancel_pending_slides)_([a-z0-9]{8,32})$/.exec(tool.name??'');
    if(!match||kinds.has(match[1]))return false;kinds.add(match[1]);
    const expected=structuredClone(match[1]==='navigate_slides'?SLIDES_TOOL:SLIDES_CANCEL_TOOL);
    if(match[1]==='navigate_slides'){
      const actions=tool.parameters?.properties?.action?.enum,max=tool.parameters?.properties?.page?.maximum;
      if(!Array.isArray(actions)||!actions.length||new Set(actions).size!==actions.length||actions.some(action=>!SLIDES_ACTIONS.includes(action))||!Number.isSafeInteger(max)||max<1||max>3)return false;
      expected.parameters.properties.action.enum=actions;expected.parameters.properties.page.maximum=max;
    }
    return JSON.stringify(tool.parameters)===JSON.stringify(expected.parameters);
  })&&new Set(tools.map(tool=>tool.name.split('_').at(-1))).size<=1;
}

// Compile only currently useful review capabilities from confirmed host state.
// Same-page questions can be answered from the snapshot without an execution tool.
// This narrows proposals; host validation at dispatch is still mandatory.
export function slidesReviewTools(state){
  resolveSlidesTarget({action:'goto',page:state?.page},state);
  const earlier=state.shown.filter(value=>value<state.page).sort((a,b)=>a-b);
  if(!earlier.length)return [];
  const actions=['previous','recent'].filter(action=>resolveSlidesTarget({action},state).status==='ready');
  actions.push('goto');
  const tool=structuredClone(SLIDES_TOOL);
  tool.parameters.properties.action.enum=actions;
  tool.parameters.properties.page.maximum=state.page;
  tool.description+=' 当前只允许页码'+[...earlier,state.page].join('、')+'；目标等于当前页可直接说明已经在这一页。';
  return [tool];
}

// Resolves a proposed action only; this is not evidence of browser execution.
export function resolveSlidesTarget(intent,state,{recentPage}={}) {
  if(!state||!Number.isSafeInteger(state.page)||state.page<1||state.page>3||
    !Array.isArray(state.visits)||state.visits.length>20||state.visits.some(p=>!Number.isSafeInteger(p)||p<1||p>3)||
    !Array.isArray(state.shown)||state.shown.length>3||state.shown.some(p=>!Number.isSafeInteger(p)||p<1||p>3)||
    !state.shown.includes(state.page))throw new Error('INVALID_SLIDES_STATE');
  const result=(status,reason,page=state.page)=>({status,reason,page,total:3,confirmed:true});
  if(intent?.action==='next')return result('rejected','FORWARD_NAVIGATION_DISABLED');
  if(!validateSlidesIntent(intent))return result('rejected','INVALID_SLIDES_ARGUMENTS');
  let target;
  if(intent.action==='goto')target=intent.page;
  else if(intent.action==='previous')target=state.page-1;
  else target=recentPage??[...state.visits].reverse().find(page=>page!==state.page);
  if(target===undefined||target<1)return result('unchanged','NO_REVIEW_HISTORY');
  if(target>state.page)return result('rejected','FORWARD_NAVIGATION_DISABLED');
  if(!state.shown.includes(target))return result('rejected','PAGE_NOT_PREVIOUSLY_SHOWN');
  if(target===state.page)return result('unchanged','ALREADY_ON_PAGE');
  return {status:'ready',reason:'TARGET_RESOLVED',page:state.page,total:3,confirmed:true,target_page:target};
}
