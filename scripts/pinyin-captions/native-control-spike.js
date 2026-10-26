import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import WebSocket from 'ws';
import {validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {preflight} from '../../packages/provider-doubao/probe.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
import {NATIVE_CASES} from './cases.js';
// Native protocol SPIKE only. No product settings, real renderer, microphone,
// learner records, persistent preference, raw provider logs or output audio file.
const TOOL={type:'function',name:'set_caption_pinyin',description:'Set pinyin annotation visibility in captions for this session only. This changes the UI, never spoken content.',parameters:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false}};
const args=process.argv.slice(2),selection=args.find(a=>a.startsWith('--case='))?.slice(7);
if(args.some(a=>a!=='--live'&&!a.startsWith('--case='))||selection&&!NATIVE_CASES.some(c=>c.id===selection))throw Error('INVALID_SPIKE_ARGUMENTS');
const cases=NATIVE_CASES.filter(c=>!selection||c.id===selection);
if(!args.includes('--live')){console.log(JSON.stringify({mode:'dry_run',cases,production_agent_changed:false}));process.exit(0);}
const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
validateSeeduplexProfile(profile);if(!preflight(profile).live_eligible)throw Error('PINYIN_PREFLIGHT_BLOCKED');
const key=process.env[profile.auth.env];if(typeof key!=='string'||!key.length||key.length>8192||/[^\x21-\x7e]/.test(key))throw Error('INVALID_CREDENTIAL_FORMAT');
const directory='.local/pinyin-caption-spike';await mkdir(directory,{recursive:true,mode:0o700});
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}\s]/gu,'').toLowerCase();
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
async function run(c){
 const base=directory+'/'+c.id;execFileSync('/usr/bin/say',['-v',c.voice,'-o',base+'.aiff',c.text]);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',base+'.aiff',base+'.wav']);const pcm=wavPCM(await readFile(base+'.wav'));if(pcm.length>640000||pcm.length<640)throw Error('AUTHORED_PCM_LIMIT');
 const instructions=`你是中文学习伙伴Kai，正常说话、简短自然回应学生，不主动开场。拼音只由应用显示在字幕上，绝对不要在回复中附加拼音、拉丁转写或逐字念拼音。此刻字幕拼音${c.initial?'显示':'隐藏'}。当前是独立作者实验，应用执行器是模拟的。\n学习者明确要求关闭字幕拼音时，调用set_caption_pinyin，参数enabled=false；明确要求开启时enabled=true。只有真实工具结果返回后才能说已经关闭或开启。若同时问其他问题，执行设置后继续回答那个问题。只是讨论拼音、询问怎么翻译一句命令、引用命令、要求不要关闭或保持当前状态时，不调用工具；直接自然回应。字幕中文保持，只有拼音注释开关变化，只影响本场对话。不要重复调用，不要调用任何其他函数。`;
 const request=structuredClone(profile.session_create);request.session.tools=[TOOL];request.session.instructions=instructions;
 const report={id:c.id,real_provider:false,synthetic_caption_renderer:true,browser_tested:false,microphone:false,human_listening:false,production_agent_changed:false,input_source:'local_os_authored_speech',input_sha256:hash(pcm),instruction_sha256:hash(instructions),initial:c.initial,expected:c.expected,final:c.initial,asr_final_count:0,asr_matches_authored:null,tool_calls:[],tool_results:0,output_events_before_result:0,audio_bytes:0,text_done:false,audio_done:false,native_fc_input_identity_verified:false,reply_contains_tone_marked_pinyin:false};
 let socket,pump,deadline,closeTimer,settleTimer,resultTimer,position=0,closing=false,ended=false,reason='unknown',inputId=null,candidateId=null,replyId=null,questionId=null,pending=null,text='',count=0;
 return await new Promise(resolve=>{
  const finish=why=>{if(ended)return;ended=true;clearInterval(pump);for(const timer of [deadline,closeTimer,settleTimer,resultTimer])clearTimeout(timer);socket?.terminate();report.ended=why;report.reply_contains_tone_marked_pinyin=/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/iu.test(text);report.passed=why==='reply_done'&&report.real_provider&&report.asr_final_count===1&&report.text_done&&report.audio_done&&report.audio_bytes>0&&(c.expected===null?report.tool_calls.length===0:report.tool_calls.length===1&&report.tool_results===1&&report.final===c.expected&&report.output_events_before_result===0)&&!report.reply_contains_tone_marked_pinyin;resolve(report);};
  const send=value=>{try{socket.send(JSON.stringify({event_id:randomUUID(),...value}));return true;}catch{finish('send_failed');return false;}};
  const end=why=>{if(ended||closing)return;closing=true;reason=why;clearInterval(pump);send({type:'session.close'});closeTimer=setTimeout(()=>finish(why),1200);};
  const apply=()=>{if(!pending||!inputId||closing||ended)return;const p=pending;pending=null;report.final=p.enabled;report.tool_results++;send({type:'conversation.item.create',items:[{call_id:p.call_id,role:'tool',content:[{type:'input_text',text:JSON.stringify({status:'applied',enabled:p.enabled,scope:'current_session',confirmed:true,execution_source:'synthetic_caption_renderer'})}]}]});};
  socket=new WebSocket(profile.endpoint,{headers:{[profile.auth.header]:profile.auth.prefix+key},maxPayload:262144,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
  socket.on('open',()=>send(request));socket.on('error',()=>finish('transport_error'));socket.on('close',()=>finish(closing?reason:'remote_closed'));socket.on('unexpected-response',(_req,res)=>{report.http_status=res.statusCode;res.resume();finish('handshake_rejected');});
  socket.on('message',(bytes,binary)=>{try{
   if(ended)return;if(binary||bytes.length>262144||++count>2500)return end('frame_limit');const raw=JSON.parse(bytes.toString());
   if(raw.type==='session.closed'){report.session_closed_ack=true;return finish(reason);}if(closing)return;if(raw.type==='error')return end('provider_error');
   if(raw.type==='session.created'){if(report.real_provider||!validId(raw.session?.id))return end('invalid_ready');report.real_provider=true;pump=setInterval(()=>{const part=position<pcm.length?pcm.subarray(position,position+640):Buffer.alloc(640);position+=640;send({type:'input_audio_buffer.append',audio:Buffer.concat([part,Buffer.alloc(640-part.length)]).toString('base64')});},20);return;}
   if(raw.type==='conversation.item.input_audio_transcription.started'){if(!validId(raw.item_id)||candidateId&&candidateId!==raw.item_id||inputId&&inputId!==raw.item_id)return end('multiple_input');candidateId=raw.item_id;return;}
   if(raw.type==='conversation.item.input_audio_transcription.completed'){const t=raw.text??raw.transcript;if(!validId(raw.item_id)||typeof t!=='string'||t.length>2000||candidateId&&candidateId!==raw.item_id||inputId&&inputId!==raw.item_id||raw.text!==undefined&&raw.transcript!==undefined&&raw.text!==raw.transcript)return end('invalid_final');if(inputId)return;inputId=raw.item_id;report.asr_final_count++;report.asr_matches_authored=normalize(t)===normalize(c.text);if(questionId&&questionId!==inputId)return end('reply_owner_mismatch');apply();return;}
   if(raw.type==='response.function_call_arguments.done'){
    if(report.tool_calls.length||!Array.isArray(raw.items)||raw.items.length!==1)return end('unsupported_batch');const call=raw.items[0];let a;try{a=JSON.parse(call.arguments);}catch{return end('invalid_arguments');}
    if(call.name!==TOOL.name||!validId(call.call_id)||!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length!==1||typeof a.enabled!=='boolean')return end('invalid_arguments');report.tool_calls.push({enabled:a.enabled});pending={enabled:a.enabled,call_id:call.call_id};resultTimer=setTimeout(()=>{if(pending)end('missing_final');},3000);apply();return;
   }
   if(!['response.output_text.delta','response.output_text.done','response.output_audio.started','response.output_audio.delta','response.output_audio.done'].includes(raw.type))return;
   if(!report.tool_results)report.output_events_before_result++;
   if(raw.response_id!==undefined){if(!validId(raw.response_id)||replyId&&replyId!==raw.response_id)return end('overlapping_reply');replyId=raw.response_id;}
   if(raw.question_id!==undefined){if(!validId(raw.question_id)||questionId&&questionId!==raw.question_id||inputId&&inputId!==raw.question_id)return end('reply_owner_mismatch');questionId=raw.question_id;}
   if(raw.type==='response.output_text.delta'){if(typeof raw.delta!=='string')return end('invalid_text');text+=raw.delta;}
   if(raw.type==='response.output_text.done'){if(typeof raw.text!=='string'||!raw.text.startsWith(text))return end('invalid_text');text=raw.text;report.text_done=true;}
   if(text.length>4000)return end('text_limit');
   if(raw.type==='response.output_audio.delta'){if(!replyId||!questionId||typeof raw.delta!=='string')return end('unbound_audio');const audio=Buffer.from(raw.delta,'base64');if(audio.toString('base64')!==raw.delta||audio.length%2)return end('invalid_audio');report.audio_bytes+=audio.length;if(report.audio_bytes>1920000)return end('audio_limit');}
   if(raw.type==='response.output_audio.done')report.audio_done=true;
   if(report.text_done&&report.audio_done&&!settleTimer)settleTimer=setTimeout(()=>end('reply_done'),300);
  }catch{end('invalid_frame');}});
  deadline=setTimeout(()=>end('duration_limit'),30000);
 });
}
const results=[];for(const c of cases){const result=await run(c);results.push(result);await writeFile(directory+'/native-'+c.id+'.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));}
if(results.some(r=>!r.passed))process.exitCode=1;
