let loading;
async function loadPinyin(){
  if(!loading)loading=(async()=>{
    await import('/vendor/pinyin-pro.js');
    const lib=globalThis.pinyinPro;if(!lib?.pinyin)throw new Error('PINYIN_UNAVAILABLE');
    const {default:traditional}=await import('/vendor/pinyin-traditional.js');
    lib.addTraditionalDict(traditional);lib.customPinyin({'还书':'huán shū','还款':'huán kuǎn'});return lib.pinyin;
  })();
  return loading;
}
// Pure derived DOM. Source text, reply clocks and playback evidence remain plain.
export class CaptionAnnotations {
  constructor(root,{load=loadPinyin,onReady=()=>{}}={}){
    this.root=root;this.enabled=true;this.frame={text:'',parts:{previous:'',current:'',complete:false},id:null};
    this.ready=load().then(convert=>{this.convert=convert;this.paint();onReady(true);return true;},()=>{this.unavailable=true;this.paint();onReady(false);return false;});
  }
  render(text,parts,id=null){this.frame={text,parts:parts??{previous:text,current:'',complete:true},id};this.paint();}
  setEnabled(value){this.enabled=value;this.paint();}
  paint(){
    const {text,parts}=this.frame,doc=this.root.ownerDocument;
    const previous=doc.createElement('span'),current=doc.createElement('strong');
    previous.className=parts.complete?'caption-complete':'caption-previous';current.className='caption-current';
    this.root.dataset.pinyin=this.enabled?'on':'off';
    let rows;
    if(this.enabled&&this.convert&&text){try{rows=this.convert(text,{type:'all',toneType:'symbol',toneSandhi:false,traditional:true});if(!Array.isArray(rows)||rows.map(row=>row.origin).join('')!==text)rows=null;}catch{rows=null;}}
    if(rows){
      let offset=0;const boundary=(parts.previous??text).length;
      for(const row of rows){const target=offset<boundary?previous:current;offset+=row.origin.length;
        if(!row.isZh||!row.pinyin){target.append(doc.createTextNode(row.origin));continue;}
        const ruby=doc.createElement('ruby'),base=doc.createElement('span'),rt=doc.createElement('rt');
        base.textContent=row.origin;rt.textContent=row.pinyin;rt.setAttribute('aria-hidden','true');ruby.append(base,rt);target.append(ruby);
      }
    }else{previous.textContent=parts.previous??text;current.textContent=parts.current??'';}
    this.root.replaceChildren(previous,current);
  }
}
