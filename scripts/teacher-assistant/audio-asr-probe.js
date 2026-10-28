import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TencentRecordingASR} from '../../packages/provider-tencent-asr/recording.js';
if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,requires:'--live; sends authored OS TTS only, never learner recordings'}));
else{
  const dir=await mkdtemp(join(tmpdir(),'kai-asr-probe-')),result={provider:'tencent_asr',input:'authored_os_tts',real_human_audio:false,raw_trace_saved:false};
  try{
    const asr=new TencentRecordingASR({secretId:process.env.TENCENT_ASR_SECRET_ID??process.env.TENCENT_SOE_SECRET_ID,secretKey:process.env.TENCENT_ASR_SECRET_KEY??process.env.TENCENT_SOE_SECRET_KEY});
    execFileSync('/usr/bin/say',['-v','Tingting','-r','130','-o',join(dir,'input.aiff'),'我要一碗面条，不要辣。']);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',join(dir,'input.aiff'),join(dir,'input.wav')]);
    const wav=await readFile(join(dir,'input.wav'));let offset=12,pcm;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+size%2;}
    const started=Date.now(),task=await asr.submit(pcm);result.accepted=true;let response;
    while(Date.now()-started<90000){response=await asr.poll(task.task_id,{durationMs:pcm.length/32});if(response.state==='complete')break;await new Promise(resolve=>setTimeout(resolve,2000));}
    result.status=response?.state??'unknown';result.elapsed_ms=Date.now()-started;result.sentences=response?.result?.sentences.length??0;result.word_timestamps=response?.result?.sentences.reduce((n,s)=>n+s.words.length,0)??0;result.distinct_speakers=new Set(response?.result?.sentences.map(s=>s.speaker_id)??[]).size;if(result.status!=='complete')process.exitCode=1;
  }catch(error){result.status='failed';result.provider_code=error.provider_code??null;result.reason=/^[A-Z_]+$/.test(error.message)?error.message:'ASR_PROBE_FAILED';process.exitCode=1;}
  finally{await rm(dir,{recursive:true,force:true});await mkdir('.local/audio-auto-checks',{recursive:true});await writeFile('.local/audio-auto-checks/asr-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
}
