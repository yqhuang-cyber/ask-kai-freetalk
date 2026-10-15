import { randomUUID } from 'node:crypto';
import { signAssertion } from './identity.js';
import { bridgeEndpoint } from './endpoint.js';
import { requireIdentity,validateLearnerContext,validateCurriculum,validateLearningRecord,isId } from '../contracts/planning.js';
export class HskaiPlanningPort {
  constructor({endpoint,secret,fetcher=fetch,allowLocal=false,learnerDataPort}){Object.assign(this,{endpoint:bridgeEndpoint(endpoint,{allowLocal}),secret,fetcher,learnerDataPort});}
  async request(identity,operation,data={},scope='context:read',signal) {
    requireIdentity(identity,scope);
    const now=Math.floor(Date.now()/1000),token=signAssertion({v:1,iss:'ask-kai',aud:'hskai-planning',owner_id:identity.owner_id,learner_id:identity.learner_id,operation,scopes:[scope],iat:now,exp:now+30,jti:randomUUID()},this.secret);
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000);combined.throwIfAborted();
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({operation,...data})});
    if(!response.ok||!response.body)throw new Error('HSKAI_PLANNING_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>32768)throw new Error('HSKAI_PLANNING_INVALID');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  async read(identity){return this.learnerDataPort?this.learnerDataPort.read(identity):validateLearnerContext(await this.request(identity,'context'),identity);}
  async getResource(identity,entry,{signal}={}) {
    if(entry.mode==='free')return null;
    if(entry.mode==='mission'&&entry.mission_id!==identity.mission?.id)throw new Error('TRUSTED_MISSION_REQUIRED');
    const result=validateCurriculum(await this.request(identity,'resource',{mode:entry.mode,resource_id:entry.mode==='mission'?entry.mission_id:entry.topic_id??'sports'},'curriculum:read',signal));
    if(result.id!==(entry.mode==='mission'?entry.mission_id:entry.topic_id??'sports')||result.kind!==(entry.mode==='mission'?'mission':'topic'))throw new Error('WRONG_CURRICULUM');
    return result;
  }
  async append(identity,record,idempotencyKey,{signal}={}) {
    validateLearningRecord(record);if(!isId(idempotencyKey)||idempotencyKey!==record.session_id)throw new Error('INVALID_RECORD_KEY');
    const receipt=await this.request(identity,'append',{record,idempotency_key:idempotencyKey},'learning:write',signal);
    if(!['accepted','rejected','pending'].includes(receipt.status)||receipt.mocked!==true||receipt.session_id!==record.session_id||!isId(receipt.receipt_id)||!Number.isSafeInteger(receipt.revision))throw new Error('INVALID_RECORD_RECEIPT');
    return receipt;
  }
}
