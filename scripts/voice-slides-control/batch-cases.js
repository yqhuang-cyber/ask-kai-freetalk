// Protocol capability diagnostic, separate from the 23 natural-intent cases.
export const SLIDES_BATCH_CASES=Object.freeze([
  {id:'two-previous-batch',text:'先上一页，再上一页，帮我连续回看两次。',
    expected:{action:'previous',page:1,call_count:2},state:{page:3,shown:[1,2,3],visits:[1,2,3]}},
  {id:'inspect-slide-batch',text:'现在是第几页？我能回看哪些页？',
    expected:{tools:['inspect_current_slide','inspect_review_history'],page:3,call_count:2},state:{page:3,shown:[1,2,3],visits:[1,2,3]}}
]);
export const INSPECTION_TOOLS=Object.freeze([
  {type:'function',name:'inspect_current_slide',description:'只读查询宿主当前课件页，不执行翻页；当前页问题必须查询此工具，初始上下文可能过期。',parameters:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'inspect_review_history',description:'只读查询宿主允许回看的历史页，不执行翻页；询问能回看哪些页时必须查询。',parameters:{type:'object',properties:{},additionalProperties:false}}
]);
