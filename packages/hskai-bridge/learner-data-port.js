import { randomUUID } from 'node:crypto';
import { signAssertion } from './identity.js';
import { bridgeEndpoint } from './endpoint.js';
import { requireIdentity } from '../contracts/planning.js';
import { LEARNER_PARTS,validateLearnerPart,assembleLearnerContext } from '../contracts/learner-data.js';

// Three signed business interfaces, one authorized owner/learner identity.
export class HskaiLearnerDataPort {
  constructor({endpoints,secret,fetcher=fetch,allowLocal=false}) {
    this.endpoints=Object.fromEntries(Object.keys(LEARNER_PARTS).map(p=>[p,bridgeEndpoint(endpoints[p],{allowLocal})]));
    Object.assign(this,{secret,fetcher});
  }
  async readPart(identity,part,{signal}={}) {
    if(!Object.hasOwn(LEARNER_PARTS,part))throw new Error('INVALID_LEARNER_PART');
    const scope=LEARNER_PARTS[part].scope;requireIdentity(identity,scope);
    if(!Number.isFinite(identity.authorization_until))throw new Error('PLANNING_AUTHORIZATION_REQUIRED');
    const now=Math.floor(Date.now()/1000),token=signAssertion({v:1,iss:'ask-kai',aud:`hskai-${part}`,owner_id:identity.owner_id,learner_id:identity.learner_id,scopes:[scope],operation:'read',iat:now,exp:now+30,jti:randomUUID()},this.secret);
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000);combined.throwIfAborted();
    const response=await this.fetcher(this.endpoints[part],{method:'POST',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{"operation":"read"}'});
    if(!response.ok||!response.body)throw new Error('HSKAI_LEARNER_DATA_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>524288)throw new Error('HSKAI_LEARNER_DATA_INVALID');chunks.push(chunk);}
    return validateLearnerPart(JSON.parse(Buffer.concat(chunks).toString()),part,identity);
  }
  async read(identity,{signal}={}) {
    requireIdentity(identity,'context:read');
    for(let attempt=0;attempt<2;attempt++) {
      const rows=await Promise.all(Object.keys(LEARNER_PARTS).map(async part=>[part,await this.readPart(identity,part,{signal})]));
      try{return assembleLearnerContext(Object.fromEntries(rows),identity);}catch(error){if(error.message!=='LEARNER_SNAPSHOT_CHANGED'||attempt===1)throw error;}
    }
  }
}
