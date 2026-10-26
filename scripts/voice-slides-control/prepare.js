import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
import {SLIDES_CASES} from './cases.js';
import {SLIDES_CONTROL_CASES} from './control-cases.js';
import {SLIDES_BATCH_CASES} from './batch-cases.js';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const INPUT_DIRECTORY='.local/voice-slides-control';
export async function prepareSlidesInputs({only=[]}={}) {
  await mkdir(INPUT_DIRECTORY,{recursive:true,mode:0o700});
  const allCases=[...SLIDES_CASES,...SLIDES_CONTROL_CASES,...SLIDES_BATCH_CASES];
  if(!Array.isArray(only)||only.some(id=>!allCases.some(item=>item.id===id)))throw new Error('INVALID_AUTHORED_CASES');
  const manifest={version:1,source:'local_os_authored_speech',sample_rate:16000,channels:1,format:'pcm_s16le',entries:[]};
  if(only.length){
    let previous;try{previous=JSON.parse(await readFile(INPUT_DIRECTORY+'/manifest.json','utf8'));}catch{}
    if(previous?.source==='local_os_authored_speech'&&Array.isArray(previous.entries))manifest.entries=previous.entries.filter(entry=>{
      const known=allCases.find(item=>item.id===entry.id);return known&&!only.includes(entry.id)&&entry.path===entry.id+'.pcm'&&entry.script_sha256===hash(known.text)&&/^[a-f0-9]{64}$/.test(entry.pcm_sha256??'')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=640&&entry.bytes<=480000;
    });
  }
  for(const item of allCases.filter(item=>!only.length||only.includes(item.id))){
    const base=INPUT_DIRECTORY+'/'+item.id;
    execFileSync('/usr/bin/say',['-v','Tingting','-o',base+'.aiff',item.text]);
    execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',base+'.aiff',base+'.wav']);
    const pcm=wavPCM(await readFile(base+'.wav'));
    await writeFile(base+'.pcm',pcm,{mode:0o600});
    manifest.entries.push({id:item.id,script_sha256:hash(item.text),pcm_sha256:hash(pcm),bytes:pcm.length,path:item.id+'.pcm'});
  }
  await writeFile(INPUT_DIRECTORY+'/manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!arg.startsWith('--only=')))throw new Error('INVALID_ARGUMENTS');const result=await prepareSlidesInputs({only:args[0]?.slice(7).split(',')??[]});console.log(JSON.stringify({source:result.source,cases:result.entries.length,external_tts_calls:0}));}
  catch{console.error('SLIDES_AUTHORED_INPUT_PREPARATION_FAILED');process.exitCode=1;}
}
