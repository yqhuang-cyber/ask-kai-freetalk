import {gzipSync,gunzipSync} from 'node:zlib';
const LIMIT=512*1024;
export function encodeAsr(kind,payload,{last=false}={}) {
  if(!['config','audio'].includes(kind)||last&&kind!=='audio')throw Error('INVALID_ASR_PACKET');
  const bytes=kind==='config'?Buffer.from(JSON.stringify(payload)):payload;
  if(!Buffer.isBuffer(bytes)||bytes.length>LIMIT)throw Error('ASR_PACKET_LIMIT');
  const body=gzipSync(bytes),size=Buffer.alloc(4);size.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from([0x11,kind==='config'?0x10:last?0x22:0x20,kind==='config'?0x11:0x01,0]),size,body]);
}
export function decodeAsr(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>LIMIT||bytes[0]>>4!==1)throw Error('INVALID_ASR_FRAME');
  const type=bytes[1]>>4,flags=bytes[1]&15,serialization=bytes[2]>>4,compression=bytes[2]&15;
  let offset=(bytes[0]&15)*4,sequence=null,code=null;
  if(offset<4||offset+4>bytes.length||![9,15].includes(type)||![0,1].includes(compression)||serialization>1)throw Error('INVALID_ASR_FRAME');
  if(type===15){code=bytes.readUInt32BE(offset);offset+=4;}
  else if(flags&1){sequence=bytes.readInt32BE(offset);offset+=4;}
  if(offset+4>bytes.length)throw Error('INVALID_ASR_FRAME');
  const size=bytes.readUInt32BE(offset);offset+=4;
  if(size!==bytes.length-offset)throw Error('INVALID_ASR_FRAME');
  let payload=bytes.subarray(offset);
  if(compression)payload=gunzipSync(payload,{maxOutputLength:LIMIT});
  let data;
  try{data=serialization===1?JSON.parse(payload.toString('utf8')):null;}catch{throw Error('INVALID_ASR_JSON');}
  if(type===15)return {error:true,code,final:false,text:''}; // Error content is deliberately discarded.
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_ASR_RESULT');
  if(data.code!==undefined&&![0,1000,20000000].includes(data.code))return {error:true,code:Number.isSafeInteger(data.code)?data.code:null,final:false,text:''};
  const result=Array.isArray(data.result)?data.result[0]:data.result;
  const text=result?.text??'';
  if(typeof text!=='string'||text.length>4000)throw Error('INVALID_ASR_TEXT');
  return {error:false,code:null,final:!!(flags&2)||sequence!==null&&sequence<0,text};
}
