import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket,{WebSocketServer} from 'ws';
import { SeeduplexProvider } from '../../packages/provider-doubao/seeduplex.js';
import { sha256 } from '../../apps/eval-runner/src/multiturn-plan.js';

// Authored protocol peer: inputs/outputs are fixtures, not real Doubao results.
export async function protocolPeer(t,{scripts=[['你好','再见']],outputs=[['你好。Hello.','再见。Bye.']],omitReplyTurn,asrOverride,foreignTurn=false,asrFinalField='transcript',contextDelayMs=0}={}) {
  const http=createServer(),wss=new WebSocketServer({server:http}),requests=[],sessions=[];
  http.listen(0,'127.0.0.1');await once(http,'listening');
  t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();http.close();http.closeAllConnections();});
  wss.on('connection',socket=>{
    const index=sessions.length,state={inputs:[],instructions:[],reply:0};sessions.push(state);let sequence=0;
    const wire=raw=>socket.send(JSON.stringify({event_id:`fixture-${++sequence}`,...raw}));
    socket.on('message',bytes=>{
      const raw=JSON.parse(bytes.toString());requests.push(raw);
      if(raw.type==='session.create'){state.instructions.push(raw.session.instructions);wire({type:'session.created',session:{id:'fixture-session'}});}
      if(raw.type==='session.update'){state.instructions.push(raw.session.instructions);setTimeout(()=>wire({type:'session.updated',session:{id:'fixture-session'}}),contextDelayMs);}
      if(raw.type==='session.close')wire({type:'session.closed'});
      if(raw.type==='speech_text_buffer.commit') {
        const ids={response_id:randomUUID(),question_id:randomUUID()};
        wire({type:'response.output_audio.started',...ids});wire({type:'response.output_audio.delta',delta:Buffer.alloc(4800,1).toString('base64')});wire({type:'response.output_audio.done',...ids});
      }
      if(raw.type==='input_audio_buffer.append') {
        const audio=Buffer.from(raw.audio,'base64');if(!audio.some(v=>v!==0))return;
        // Test fixture is one nonzero 20ms frame per turn.
        const n=state.reply++,text=scripts[index][n];state.inputs.push(text);
        const question=`q${n}`,ids={question_id:foreignTurn?'foreign-question':question,response_id:`r${n}`};
        wire({type:'conversation.item.input_audio_transcription.started',item_id:question});
        wire({type:'conversation.item.input_audio_transcription.completed',item_id:question,[asrFinalField]:asrOverride??text});
        if(omitReplyTurn===n+1)return;
        const answer=outputs[index][n];
        wire({type:'response.output_text.delta',...ids,delta:answer});
        wire({type:'response.output_audio.started',...ids});
        wire({type:'response.output_audio.delta',delta:Buffer.alloc(960,1).toString('base64')});
        wire({type:'response.output_text.done',...ids,text:answer});
        wire({type:'response.output_audio.done',...ids});
        wire({type:'response.done',response:{usage:{output_tokens:1}}});
      }
    });
  });
  const socketFactory=()=>new WebSocket(`ws://127.0.0.1:${http.address().port}`);
  return {requests,sessions,socketFactory,providerFactory:(profile,{protocolProbe=false}={})=>ticket=>new SeeduplexProvider({profile,env:{DOUBAO_API_KEY:'fixture-only-key'},socketFactory,speechPace:ticket.speech_pace,protocolProbe})};
}
export function fixtureCases(scripts=[['你好','再见']]) {
  return scripts.map((turns,index)=>({id:`ask-kai-v2-${String(index+1).padStart(3,'0')}`,kind:'original_case',entry:'free',
    initial_profile:{support_language:'auto',chinese_comprehension:'unknown',known_expressions:[]},profile_evidence:[],
    turns:turns.map((text,i)=>({turn:i+1,text,dependency:{type:'none',source_turns:[]}}))}));
}
export function fixtureInputs(cases) {
  return new Map(cases.flatMap(c=>c.turns.map(t=>{const bytes=Buffer.alloc(640,1);return [`${c.id}/${t.turn}`,{bytes,source:'synthetic_fixture',sha256:sha256(bytes),duration_ms:20}];})));
}
