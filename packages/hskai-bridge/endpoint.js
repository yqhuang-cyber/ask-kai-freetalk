// Explicit loopback allowance for the standalone POC; external ports remain HTTPS-only.
export function bridgeEndpoint(endpoint,{allowLocal=false}={}) {
  const url=new URL(endpoint);
  const local=allowLocal && url.protocol==='http:' && ['127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:' && !local) || url.username || url.password || url.search || url.hash)throw new Error('INVALID_HSKAI_ENDPOINT');
  if(allowLocal && !local)throw new Error('POC_LOOPBACK_REQUIRED');
  return url.href;
}
