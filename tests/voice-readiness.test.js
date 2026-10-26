import {test} from 'node:test';
import assert from 'node:assert/strict';
import {voiceReadiness} from '../apps/realtime-gateway/public/voice-readiness.js';
test('ordinary Web readiness requires explicit real-provider flags and the matching ready packet',()=>{
  const packet={type:'event',event:{type:'session.ready'},synthetic:false,provider_connected:true},audio={input_rate:16000};
  assert.equal(voiceReadiness(packet,audio).real_provider,true);
  for(const variant of [{...packet,synthetic:true},{...packet,synthetic:undefined},{...packet,provider_connected:false},{...packet,event:{type:'response.started'}},{...packet,type:'session.ready'}])assert.equal(voiceReadiness(variant,audio),null);
  assert.equal(voiceReadiness(packet,null),null);
});
