import { randomUUID } from 'node:crypto';
import { signAssertion } from './identity.js';
import { bridgeEndpoint } from './endpoint.js';
export class HskaiPrivacyPort {
  constructor({endpoint,secret,fetcher=fetch,allowLocal=false}) {
    Object.assign(this,{endpoint:bridgeEndpoint(endpoint,{allowLocal}),secret,fetcher,allowLocal});
  }
  async request(identity,operation,requestId) {
    if(!['export','erase','status'].includes(operation) || (operation==='status' && !/^[A-Za-z0-9_-]{1,128}$/.test(requestId ?? '')))throw new Error('INVALID_PRIVACY_REQUEST');
    const now=Math.floor(Date.now()/1000);
    const assertion=signAssertion({v:1,iss:'ask-kai',aud:'hskai-privacy',iat:now,exp:now+30,jti:randomUUID(),owner_id:identity.owner_id,learner_id:identity.learner_id,operation},this.secret);
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${assertion}`,'Content-Type':'application/json'},body:JSON.stringify({operation,...(requestId?{request_id:requestId}:{})})});
    if(!response.ok)throw new Error('PRIVACY_REQUEST_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2048)throw new Error('INVALID_PRIVACY_ACK');chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString());
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(result.request_id ?? '') || !['pending','processing','completed','failed'].includes(result.status) || (operation!=='status' && result.status!=='pending'))throw new Error('INVALID_PRIVACY_ACK');
    if(this.allowLocal && result.mocked!==true)throw new Error('INVALID_PRIVACY_ACK');
    return {request_id:result.request_id,status:result.status,...(result.mocked===true?{mocked:true,scope:'local_mock_preferences_only'}:{})};
  }
}
