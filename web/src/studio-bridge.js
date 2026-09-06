import './studio-embed.css';
import './ui-appearance.js';
import {setCustomPaintStyle,setPaintMode,setWallColor} from './paint.js';

// The studio owns the surrounding controls; each lab still owns its renderer,
// input handlers and simulation. Standalone lab pages keep their original UI.
const embedded=new URLSearchParams(location.search).has('studio');
if(embedded)document.documentElement.classList.add('studio-embedded');
if(new URLSearchParams(location.search).has('storyboard'))document.documentElement.classList.add('story-playing');

export function connectStudio(kind,{configure=()=>{},snapshot=()=>({}),story}={}) {
  if(!embedded)return;
  document.body.dataset.lab=kind;
  window.flatlandStudio={
    set(id,value){
      const input=document.getElementById(id);
      if(!input)throw new Error(`Unknown ${kind} control: ${id}`);
      if(input.type==='checkbox'||input.type==='radio')input.checked=Boolean(value);
      else input.value=String(value);
      input.dispatchEvent(new Event(input.type==='range'?'input':'change',{bubbles:true}));
    },
    click(id){
      const button=document.getElementById(id);
      if(!button)throw new Error(`Unknown ${kind} action: ${id}`);
      button.click();
    },
    configure(values){
      if(values.customPaint)setCustomPaintStyle(values.customPaint);
      if(values.paintMode)setPaintMode(values.paintMode);
      if(values.wallColor)setWallColor(values.wallColor);
      configure(values);
    },
    snapshot,
    ...(story?{story}:{}),
    key(code,pressed){document.dispatchEvent(new KeyboardEvent(pressed?'keydown':'keyup',{code,bubbles:true}));},
  };
  parent.postMessage({type:'flatland-studio-ready',kind},location.origin);
}
