export function readConfig(env = process.env) {
  const host = env.ASK_KAI_HOST ?? '127.0.0.1';
  const rawPort = env.ASK_KAI_PORT ?? '4310';
  const provider = env.ASK_KAI_PROVIDER ?? 'replay';
  const backend=env.ASK_KAI_BACKEND ?? 'mock';
  if(!['mock','external'].includes(backend))throw new Error('INVALID_BACKEND');
  if((env.ASK_KAI_RELEASE_MODE ?? 'internal')!=='internal')throw new Error('PUBLIC_RELEASE_NOT_ENABLED');
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('STEP1_REQUIRES_LOOPBACK_HOST');
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('INVALID_PORT');
  if (provider !== 'replay' && provider !== 'doubao') throw new Error('INVALID_PROVIDER');
  if (provider === 'doubao' && !env.DOUBAO_REALTIME_PROFILE) throw new Error('DOUBAO_PROTOCOL_NOT_VERIFIED');
  for(const key of ['ASK_KAI_SLIDES_CONTROL','ASK_KAI_SLIDES_DEMO_HISTORY'])if(env[key]!==undefined&&!['true','false'].includes(env[key]))throw new Error('INVALID_SLIDES_CONFIG');
  const slidesControls=env.ASK_KAI_SLIDES_CONTROL==='true',slidesDemoHistory=env.ASK_KAI_SLIDES_DEMO_HISTORY==='true';
  if(slidesDemoHistory&&(!slidesControls||backend!=='mock'))throw new Error('SLIDES_DEMO_REQUIRES_MOCK');
  return { host, port: Number(rawPort), provider, backend, profilePath:env.DOUBAO_REALTIME_PROFILE,slidesControls,slidesDemoHistory };
}
