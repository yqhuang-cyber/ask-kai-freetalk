// The WS generation is owned by web.js; this adds exact session/revision checks.
export class CaptionSettingsView {
  constructor({annotations,preview,toggle,hint,send}){Object.assign(this,{annotations,preview,toggle,hint,send});this.reset();}
  reset(sessionId=null){this.sessionId=sessionId;this.revision=0;this.request=null;this.enabled=true;this.apply(true);}
  apply(value){this.enabled=value;this.toggle.checked=value;this.annotations.setEnabled(value);this.preview?.setEnabled(value);this.hint.textContent=value?'可说“关闭拼音”或“打开拼音”，仅本次对话有效。':'本次已隐藏拼音；可以说“打开拼音”。';}
  async receive(value){
    if(value.session_id!==this.sessionId||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision<this.revision||typeof value.pinyin_enabled!=='boolean'||typeof value.request_id!=='string'||value.request_id.length>128)return false;
    if(value.revision===this.revision&&this.request!==value.request_id)return false;
    this.revision=value.revision;this.request=value.request_id;this.apply(value.pinyin_enabled);
    const session=this.sessionId,revision=this.revision;
    let status='applied';
    if(value.pinyin_enabled){let timer;try{const ready=await Promise.race([this.annotations.ready,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);if(!ready)status='unavailable';}finally{clearTimeout(timer);}}
    if(this.sessionId!==session||this.revision!==revision||this.request!==value.request_id)return false;
    if(status!=='applied')this.hint.textContent='拼音暂不可用，中文字幕会继续显示。';
    this.send({type:'caption.ack',session_id:session,revision,request_id:value.request_id,pinyin_enabled:value.pinyin_enabled,status});return true;
  }
  state(value){if(value.session_id!==this.sessionId)return;if(value.phase==='failed'){this.hint.textContent='拼音设置尚未确认，请再试一次。';return;}if(['cancelled','complete'].includes(value.phase))return;}
}
