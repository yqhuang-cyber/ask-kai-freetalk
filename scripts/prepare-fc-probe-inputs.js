import { execFileSync } from 'node:child_process';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const FC_INPUT_CASES=Object.freeze({chat:'我喜欢篮球。你喜欢什么运动？',refusal:'我不想练习，只想聊比赛。',switch:'我想练习喜好表达。'});
const hash=v=>createHash('sha256').update(v).digest('hex');
export function wavPCM(wav) {
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('INVALID_AUTHORED_WAV');
  let fmt,pcm;
  for(let i=12;i+8<=wav.length;) {
    const name=wav.toString('ascii',i,i+4),size=wav.readUInt32LE(i+4),end=i+8+size;if(end>wav.length)throw new Error('INVALID_AUTHORED_WAV');
    if(name==='fmt ')fmt=wav.subarray(i+8,end);if(name==='data')pcm=wav.subarray(i+8,end);i=end+(size%2);
  }
  if(!fmt||fmt.length<16||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||fmt.readUInt32LE(4)!==16000||fmt.readUInt16LE(14)!==16||!pcm||pcm.length<640||pcm.length>480000||pcm.length%2)throw new Error('INVALID_AUTHORED_WAV');
  return pcm;
}
export async function prepareFcInputs(directory='.local/fc-probe-inputs') {
  await mkdir(directory,{recursive:true});
  const manifest={version:1,source:'local_os_authored_speech',generator:'macOS say Tingting / afconvert',sample_rate:16000,channels:1,format:'pcm_s16le',entries:[]};
  for(const [id,text] of Object.entries(FC_INPUT_CASES)) {
    execFileSync('/usr/bin/say',['-v','Tingting','-o',directory+'/'+id+'.aiff',text]);
    execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',directory+'/'+id+'.aiff',directory+'/'+id+'.wav']);
    const pcm=wavPCM(await readFile(directory+'/'+id+'.wav'));await writeFile(directory+'/'+id+'.pcm',pcm,{mode:0o600});
    manifest.entries.push({id,path:id+'.pcm',script_sha256:hash(text),pcm_sha256:hash(pcm),bytes:pcm.length});
  }
  await writeFile(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});return manifest;
}
if(import.meta.url===new URL(process.argv[1],'file:').href) {
  try{if(process.argv.length!==2)throw new Error();const m=await prepareFcInputs();console.log(JSON.stringify({source:m.source,cases:m.entries.length,audio_kept_private:true,external_tts_calls:0}));}
  catch{console.error('FC_INPUT_PREPARATION_FAILED');process.exitCode=1;}
}
