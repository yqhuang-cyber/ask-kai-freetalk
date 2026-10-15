import { randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createMockHskai,MOCK_IDENTITY } from './server.js';
import { HskaiBridge,signAssertion } from '../../../packages/hskai-bridge/identity.js';
import { HskaiMemoryPort } from '../../../packages/hskai-bridge/memory.js';
import { HskaiPrivacyPort } from '../../../packages/hskai-bridge/privacy.js';
import { HskaiSafeguardingPort } from '../../../packages/hskai-bridge/safeguarding.js';
import { bridgeEndpoint } from '../../../packages/hskai-bridge/endpoint.js';
import { HskaiPlanningPort } from '../../../packages/hskai-bridge/planning-port.js';
import { HskaiLearnerDataPort } from '../../../packages/hskai-bridge/learner-data-port.js';
import { LEARNER_PARTS } from '../../../packages/contracts/learner-data.js';
import { mockLearner } from './learner-accounts.js';

export class MockLaunchPort {
  constructor({endpoint,secret,fetcher=fetch}){Object.assign(this,{endpoint:bridgeEndpoint(endpoint,{allowLocal:true}),secret,fetcher});}
  has(uid){return !!mockLearner(uid);}
  async request(operation,uid=MOCK_IDENTITY.learner_id) {
    if(!this.has(uid))throw new Error('UNKNOWN_MOCK_LEARNER');
    const now=Math.floor(Date.now()/1000);
    const token=signAssertion({v:1,iss:'ask-kai',aud:'hskai-launch',...MOCK_IDENTITY,learner_id:uid,jti:randomUUID(),iat:now,exp:now+30,operation},this.secret);
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
    if(!response.ok || !response.body)throw new Error('MOCK_HSKAI_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>12288)throw new Error('INVALID_MOCK_LAUNCH');chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString());
    if(result.source!=='mock_hskai')throw new Error('INVALID_MOCK_LAUNCH');
    return result;
  }
  async issue(uid){const result=await this.request('issue',uid);if(typeof result.assertion!=='string')throw new Error('INVALID_MOCK_LAUNCH');return result.assertion;}
  async list(){return this.request('list');}
}

export async function startMockBackend({fetcher=fetch,initialMemory,mission,fixtureVariant,fixtureIdentities,topicResources}={}) {
  const secret=randomBytes(48).toString('base64url'),server=createMockHskai({secret,initialMemory,mission,fixtureVariant,fixtureIdentities,topicResources});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/internal/ask-kai/`;
  const options={secret,fetcher,allowLocal:true};
  const learnerDataPort=new HskaiLearnerDataPort({...options,endpoints:Object.fromEntries(Object.keys(LEARNER_PARTS).map(p=>[p,base+p]))});
  const planningPort=new HskaiPlanningPort({...options,endpoint:base+'planning',learnerDataPort});
  return {bridge:new HskaiBridge({secret,markets:['SG']}),memoryPort:new HskaiMemoryPort({...options,endpoint:base+'memory'}),privacyPort:new HskaiPrivacyPort({...options,endpoint:base+'privacy'}),safeguardingPort:new HskaiSafeguardingPort({...options,endpoint:base+'safeguarding'}),pocPort:new MockLaunchPort({...options,endpoint:base+'launch'}),
    planningPort,learnerDataPort,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
