const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const page=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const bindingKeys=['session_id','viewer_instance_id','generation','deck_id','deck_version'];
export function validateDemoDeck(deck){
  if(!deck||deck.id!=='kai-demo'||!identifier(deck.version)||deck.source!=='authored_demo'||!Array.isArray(deck.slides)||deck.slides.length!==3||
    deck.slides.some((slide,index)=>slide.page!==index+1||typeof slide.title!=='string'||!slide.title.length||slide.title.length>40||typeof slide.body!=='string'||slide.body.length>400))throw new Error('INVALID_DEMO_DECK');
  return structuredClone(deck);
}
export class SlidesViewer {
  constructor(container,deck){
    if(!container?.ownerDocument)throw new Error('INVALID_SLIDES_CONTAINER');
    this.container=container;this.deck=validateDemoDeck(deck);this.doc=container.ownerDocument;
    this.binding=null;this.send=null;this.page=1;this.revision=0;this.lastCommand=null;this.commands=new Map();this.chain=Promise.resolve();this.active=false;
    const element=(tag,className,text)=>{const node=this.doc.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
    container.classList.add('slides-viewer');
    this.badge=element('span','slides-badge','作者演示内容');this.title=element('h3','slides-title');
    this.body=element('p','slides-body');this.counter=element('p','slides-counter');this.counter.setAttribute('aria-live','polite');
    this.hint=element('p','slides-hint','连接后可回看已展示内容');this.hint.setAttribute('role','status');
    this.previous=element('button','slides-previous','回看上一页');this.previous.type='button';this.previous.disabled=true;
    this.select=element('select','slides-pages');this.select.setAttribute('aria-label','回看已展示页');this.select.disabled=true;
    const controls=element('div','slides-controls');controls.append(this.previous,this.select);
    container.replaceChildren(this.badge,this.title,this.body,this.counter,controls,this.hint);this.render(1);this.setOptions([1]);
    this.previous.addEventListener('click',()=>this.intent({action:'previous'}));
    this.select.addEventListener('change',()=>this.intent({action:'goto',page:Number(this.select.value)}));
  }
  render(target){
    const slide=this.deck.slides[target-1];this.title.textContent=slide.title;this.body.textContent=slide.body;
    this.page=target;this.counter.textContent=`第 ${target} / 3 页`;this.container.dataset.page=String(target);this.container.dataset.revision=String(this.revision);
    this.select.value=String(target);
  }
  setOptions(pages){
    this.select.replaceChildren(...pages.map(value=>{const option=this.doc.createElement('option');option.value=String(value);option.textContent=`第 ${value} 页 · ${this.deck.slides[value-1].title}`;return option;}));
    this.select.value=String(this.page);
  }
  bind(binding,send){
    if(!binding||bindingKeys.some(key=>!identifier(binding[key]))||binding.deck_id!==this.deck.id||binding.deck_version!==this.deck.version||typeof send!=='function')throw new Error('INVALID_VIEWER_BINDING');
    this.binding=Object.fromEntries(bindingKeys.map(key=>[key,binding[key]]));this.send=send;this.revision=0;this.lastCommand=null;this.commands.clear();this.active=true;this.chain=Promise.resolve();
    this.render(1);this.setOptions([1]);this.previous.disabled=true;this.select.disabled=true;this.hint.textContent='正在确认展示框…';
    send({type:'slides.ready',...this.binding});
  }
  matches(packet){return this.active&&this.binding&&bindingKeys.every(key=>packet?.[key]===this.binding[key]);}
  intent(intent){
    if(!this.active||this.previous.disabled&&this.select.disabled)return;
    if(intent.action==='goto'&&(!page(intent.page)||intent.page>this.page))return;
    this.previous.disabled=true;this.select.disabled=true;this.hint.textContent='正在切换…';
    this.send({type:'slides.intent',...this.binding,request_id:crypto.randomUUID(),intent});
  }
  receive(packet){
    if(!this.matches(packet))return Promise.resolve(false);
    if(packet.type==='slides.state')return Promise.resolve(this.state(packet));
    if(!['slides.command','slides.sync'].includes(packet.type))return Promise.resolve(false);
    const binding=this.binding;
    const operation=this.chain.then(()=>this.binding!==binding||!this.active?false:packet.type==='slides.command'?this.apply(packet,binding):this.sync(packet));
    this.chain=operation.catch(()=>false);return this.chain;
  }
  async apply(command,binding){
    const keys=[...bindingKeys,'type','command_id','page','base_revision','revision'];
    if(Object.keys(command).some(key=>!keys.includes(key))||!identifier(command.command_id)||!page(command.page)||!Number.isSafeInteger(command.base_revision)||command.revision!==command.base_revision+1)return false;
    const signature=JSON.stringify({page:command.page,base_revision:command.base_revision,revision:command.revision});
    const cached=this.commands.get(command.command_id);
    if(cached){if(cached.signature!==signature)return false;this.send(cached.receipt);return true;}
    if(command.base_revision!==this.revision||this.commands.size>=128)return false;
    if(!this.container.isConnected){this.send({type:'slides.ack',...binding,command_id:command.command_id,status:'not_applied',page:this.page,revision:this.revision});return false;}
    this.previous.disabled=true;this.select.disabled=true;this.hint.textContent='正在切换…';
    this.revision=command.revision;this.render(command.page);this.lastCommand=command.command_id;
    // DOM application plus paint opportunities; this never proves human visibility.
    await frame();await frame();
    if(this.binding!==binding||!this.active)return false;
    const receipt={type:'slides.ack',...binding,command_id:command.command_id,status:'applied',page:this.page,revision:this.revision};
    this.commands.set(command.command_id,{signature,receipt});this.send(receipt);return true;
  }
  sync(packet){
    if(!identifier(packet.sync_id)||!identifier(packet.command_id))return false;
    this.send({type:'slides.snapshot',...this.binding,command_id:packet.command_id,sync_id:packet.sync_id,page:this.page,revision:this.revision,applied_command_id:this.lastCommand});return true;
  }
  state(packet){
    if(!Array.isArray(packet.allowed_review_pages)||packet.allowed_review_pages.length>3||packet.allowed_review_pages.some(value=>!page(value)||value>this.page)||
      typeof packet.confirmed!=='boolean'||typeof packet.available!=='boolean'||!Number.isSafeInteger(packet.revision))return false;
    const matching=packet.confirmed&&packet.page===this.page&&packet.revision===this.revision;
    if(matching)this.setOptions(packet.allowed_review_pages);
    const available=matching&&packet.available&&!packet.pending;
    this.previous.disabled=!available||!packet.allowed_review_pages.includes(this.page-1);
    this.select.disabled=!available||packet.allowed_review_pages.length<2;
    this.hint.textContent=!packet.confirmed?'切页结果待确认…':packet.pending?'正在切换…':available?'可以回看前面的内容；后续页稍后再学。':'展示框暂不可用';
    return true;
  }
  close(){
    this.active=false;this.binding=null;this.previous.disabled=true;this.select.disabled=true;this.hint.textContent=`已断开，当前显示第 ${this.page} 页`;
  }
}
