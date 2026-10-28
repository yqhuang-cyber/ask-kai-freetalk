export const CAPTURE_PROTOCOL='homework-mic-v1';
export function encodeCaptureFrame(pcm,{sequence,sampleStart,aec=null,playback=null}){
  const bytes=new Uint8Array(24+pcm.byteLength),view=new DataView(bytes.buffer);bytes.set([75,77,73,67,1,aec===true?1:aec===false?0:2,playback===true?1:playback===false?0:2,0]);view.setUint32(8,sequence,true);view.setUint32(12,sampleStart,true);view.setUint32(16,pcm.byteLength,true);bytes.set(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength),24);return bytes;
}
export function decodeCaptureFrame(frame){
  const bytes=new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength);
  if(bytes.length!==664)throw new Error('INVALID_CAPTURE_FRAME');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes[0]!==75||bytes[1]!==77||bytes[2]!==73||bytes[3]!==67||bytes[4]!==1||![0,1,2].includes(bytes[5])||![0,1,2].includes(bytes[6])||bytes[7]!==0||view.getUint32(16,true)!==640||view.getUint32(20,true)!==0)throw new Error('INVALID_CAPTURE_FRAME');
  return {pcm:bytes.subarray(24),metadata:{protocol:CAPTURE_PROTOCOL,sequence:view.getUint32(8,true),sample_start:view.getUint32(12,true),aec:bytes[5]===1,playback:bytes[6]===2?'unknown':bytes[6]===1?'active':'inactive'}};
}
