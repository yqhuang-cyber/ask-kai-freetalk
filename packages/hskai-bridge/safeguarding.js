import { randomUUID } from 'node:crypto';
import { signAssertion } from './identity.js';
import { bridgeEndpoint } from './endpoint.js';
export class HskaiSafeguardingPort {
  constructor({endpoint,secret,fetcher=fetch,allowLocal=false}) {
    Object.assign(this,{endpoint:bridgeEndpoint(endpoint,{allowLocal}),secret,fetcher,allowLocal});
  }
  async request({identity,session_id,source_event_id,reason,policy_version}) {
    if(!['self_harm','abuse','adult_content','privacy'].includes(reason))throw new Error('INVALID_RISK_REASON');
    const now=Math.floor(Date.now()/1000),request_id=randomUUID();
    const assertion=signAssertion({v:1,iss:'ask-kai',aud:'hskai-safeguarding',iat:now,exp:now+30,jti:request_id,owner_id:identity.owner_id,learner_id:identity.learner_id},this.secret);
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(1500),headers:{Authorization:`Bearer ${assertion}`,'Content-Type':'application/json','Idempotency-Key':`${session_id}-${source_event_id}`},body:JSON.stringify({request_id,session_id,source_event_id,reason,policy_version})});
    if(!response.ok)throw new Error('HANDOFF_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2048)throw new Error('INVALID_HANDOFF_ACK');chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString());
    if(result.accepted!==true || typeof result.case_id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.case_id) || typeof result.assigned_team!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(result.assigned_team))throw new Error('INVALID_HANDOFF_ACK');
    if(this.allowLocal && result.mocked!==true)throw new Error('INVALID_HANDOFF_ACK');
    return {delivered:result.mocked!==true,case_id:result.case_id,...(result.mocked===true?{mocked:true}:{})};
  }
}
