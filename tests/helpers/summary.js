import { TeachingSession } from '../../packages/agent-core/teaching.js';
import { MOCK_MISSION } from '../../apps/hskai-mock/src/server.js';
// Authored data, real Task 07 builder, always synthetic voice.
export function summaryFixture({mode='sports',practice=true,empty=false,textOnly=false,unsupported=false,failed=false,suppressed=false,sessionId='fixture-summary'}={}) {
  const teaching=new TeachingSession({sessionId,mode,mission:unsupported?{...MOCK_MISSION,targets:['问路']}:MOCK_MISSION});let seq=0;
  const e=(type,payload={},ids={})=>({version:1,event_id:`fixture-${++seq}`,session_id:sessionId,seq,at_ms:seq,type,payload,...ids});
  if(!empty) {
    if(mode==='free' && (practice || textOnly)) {
      teaching.accept(e('user.final',{text:'How do I say football in Chinese?'},{turn_id:'t1'}));
      const ids={turn_id:'t1',response_id:'r1'};
      for(const event of [e('response.started',{},ids),e('response.text.delta',{text:'可以说：我喜欢足球。 You can say: I like football.'},ids),e('response.done',{},ids)])teaching.forward({type:'event',event});
    }
    if(!textOnly)teaching.accept(e('user.final',{text:practice?'我喜欢足球':'今天很热'},{turn_id:'t2'}));
  }
  return {type:'teaching.summary',session_id:sessionId,summary:teaching.finalize({ready:true,providerKind:'test',businessSource:'mock_hskai',outcome:failed||suppressed?'failed':'ended',endReason:suppressed?'authorization_revoked':failed?'service_failure':'student_end'})};
}
