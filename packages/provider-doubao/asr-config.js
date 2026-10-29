// Server-side ASR configuration. No credentials are exposed in preflight.
export const ASR_ENDPOINT='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream';
export const ASR_DEFAULT_RESOURCE='volc.seedasr.sauc.duration';
const resources=new Set(['volc.seedasr.sauc.duration','volc.seedasr.sauc.concurrent','volc.bigasr.sauc.duration','volc.bigasr.sauc.concurrent']);
export function readAsrConfig(env={},override={}) {
  const credentialVariable=env.DOUBAO_ASR_API_KEY!==undefined?'DOUBAO_ASR_API_KEY':'DOUBAO_API_KEY';
  const credential=env[credentialVariable];
  const resource=override.resource??env.DOUBAO_ASR_RESOURCE_ID??ASR_DEFAULT_RESOURCE;
  if(!resources.has(resource))throw Error('INVALID_ASR_RESOURCE');
  if(credential!==undefined&&(typeof credential!=='string'||!credential.length||credential.length>8192||/[^\x21-\x7e]/.test(credential)))throw Error('INVALID_ASR_CREDENTIAL');
  return {endpoint:ASR_ENDPOINT,resource,credentialVariable,credential};
}
// Never serialize the credential-bearing internal config.
export function asrPreflight(env={}) {
  try{
    const config=readAsrConfig(env);
    return {configured:!!config.credential,credential_present:!!config.credential,credential_variable:config.credentialVariable,resource_id:config.resource,endpoint:config.endpoint,authentication:'X-Api-Key',permission_verified:false,network_called:false,product_changed:false};
  }catch(error){
    return {configured:false,error_code:['INVALID_ASR_RESOURCE','INVALID_ASR_CREDENTIAL'].includes(error.message)?error.message:'ASR_CONFIG_FAILED',permission_verified:false,network_called:false,product_changed:false};
  }
}
