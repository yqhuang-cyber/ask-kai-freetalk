import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encodeAsr,decodeAsr} from './asr-protocol.js';
import {readAsrConfig} from './asr-config.js';

export class DoubaoThaiAsr {
  constructor({env=process.env,socketFactory=(url,options)=>new WebSocket(url,options),timeoutMs=22000}={}){
    this.config=readAsrConfig(env);if(!this.config.credential)throw Error('ASR_NOT_CONFIGURED');this.socketFactory=socketFactory;this.timeoutMs=timeoutMs;
  }
  start({signal}={}){
    let resolve,reject,settled=false,opened=false,ended=false,total=0,pending=Buffer.alloc(0),pump;
    const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const socket=this.socketFactory(this.config.endpoint,{headers:{'X-Api-Key':this.config.credential,'X-Api-Resource-Id':this.config.resource,'X-Api-Request-Id':randomUUID(),'X-Api-Sequence':'-1'},maxPayload:524288,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
    const finish=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(pump);signal?.removeEventListener('abort',abort);pending=Buffer.alloc(0);socket.terminate();if(error)reject(Error(error));else resolve({text,source:'doubao_asr_final'});};
    const abort=()=>finish('ASR_ABORTED'),timer=setTimeout(()=>finish('ASR_TIMEOUT'),this.timeoutMs);
    const tick=()=>{
      if(settled||!opened)return;
      // Retain a tail packet so the documented final audio packet is nonempty.
      if(!ended&&pending.length<=6400)return;
      if(!pending.length){if(ended&&!total)finish('ASR_NO_TEXT');return;}
      const size=Math.min(6400,pending.length),last=ended&&size===pending.length;
      const chunk=pending.subarray(0,size);pending=pending.subarray(size);
      try{socket.send(encodeAsr('audio',chunk,{last}));if(last){clearInterval(pump);pump=null;}}catch{finish('ASR_SEND_FAILED');}
    };
    signal?.addEventListener('abort',abort,{once:true});
    socket.on('unexpected-response',(_req,res)=>{const status=res.statusCode;res.resume();finish(status===401||status===403?'ASR_PERMISSION_DENIED':'ASR_UNAVAILABLE');});
    socket.on('error',()=>finish('ASR_UNAVAILABLE'));socket.on('close',()=>finish('ASR_INCOMPLETE'));
    socket.on('open',()=>{
      if(settled)return;opened=true;
      try{socket.send(encodeAsr('config',{user:{uid:randomUUID()},audio:{format:'pcm',rate:16000,bits:16,channel:1,language:'th-TH'},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,enable_ddc:false,show_utterances:true}}));pump=setInterval(tick,200);tick();}catch{finish('ASR_SEND_FAILED');}
    });
    socket.on('message',(bytes,binary)=>{
      if(settled)return;
      try{if(!binary)throw Error();const value=decodeAsr(Buffer.from(bytes));if(value.error)return finish('ASR_PROVIDER_ERROR');if(value.final){if(!ended||!value.text.trim()||value.text.length>2000)return finish('ASR_NO_TEXT');finish(null,value.text);}}catch{finish('ASR_INVALID_RESPONSE');}
    });
    if(signal?.aborted)abort();
    return {result,write(bytes){if(settled||ended)return;if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length%2||total+bytes.length>448000){finish('ASR_AUDIO_LIMIT');return;}total+=bytes.length;pending=Buffer.concat([pending,bytes]);},finish(){if(settled)return;ended=true;},abort};
  }
  async recognize(pcm,{signal}={}){
    if(!Buffer.isBuffer(pcm)||pcm.length<640||pcm.length>448000||pcm.length%2)throw Error('INVALID_ASR_AUDIO');
    const stream=this.start({signal});stream.result.catch(()=>{});
    for(let offset=0;offset<pcm.length&&!signal?.aborted;offset+=6400){stream.write(pcm.subarray(offset,Math.min(offset+6400,pcm.length)));if(offset+6400<pcm.length)await delay(200);}
    stream.finish();return stream.result;
  }
}
