import {bindPromptCopy} from './copy-prompt.js';
import {PAINT_STYLES} from './paint.js';
import {defaults,storageKey,readPreset} from './studio-preset.js';
import {stories as catalogue} from './story-catalog.js';
import {mountStoryGallery,loadStoryPreview} from './story-gallery.js';
import {createEntranceStrokes,sampleWriter,sampleEntrance,ENTRANCE_DURATION} from './welcome-sequence.js';

const entrance=document.querySelector('#entrance'),stories=document.querySelector('#stories');
const canvas=document.querySelector('#entrance-canvas'),ctx=canvas.getContext('2d');
const replay=document.querySelector('#replay-logo');
const motion=matchMedia('(prefers-reduced-motion: reduce)'),compact=matchMedia('(max-width: 640px)');
let colors=PAINT_STYLES[defaults.shared.paintStyle].colors,background;
function refreshPaint(){
  const appearance=getComputedStyle(entrance);
  background=appearance.backgroundColor;
  let shared=defaults.shared;
  try{const saved=localStorage.getItem(storageKey);if(saved)shared=readPreset(JSON.parse(saved)).shared;}catch{}
  colors=shared.coloring?PAINT_STYLES[shared.paintStyle].colors:[appearance.getPropertyValue('--entrance-ink').trim()];
  document.querySelector('meta[name="theme-color"]').content=background;
  for(const [name,index] of [['blue',1],['gold',0],['pink',4]])stories.style.setProperty(`--resident-${name}`,colors[index%colors.length]);
}
let sequence=createEntranceStrokes(compact.matches),elapsed=0,lastFrame=null,frame=0,active=false,pageAway=false;

const list=document.querySelector('#story-list');
document.querySelector('#story-empty').hidden=catalogue.length>0;

const prompt=document.querySelector('#creation-prompt'),copy=document.querySelector('#copy-prompt'),copyStatus=document.querySelector('#copy-status');
const create=document.querySelector('#create-story'),dialog=document.querySelector('#creation-dialog'),close=document.querySelector('#close-prompt');
const panel=document.querySelector('#creation-panel'),notice=document.querySelector('#draft-notice'),closeDraft=document.querySelector('#close-draft');
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
create.hidden=close.hidden=catalogue.length===0;
if(catalogue.length){list.append(create);dialog.append(panel,notice);closeDraft.hidden=false;}
const gallery=mountStoryGallery(catalogue);
if(catalogue.length)loadStoryPreview(catalogue).then(entries=>{if(entries!==catalogue)gallery.render(entries);});
async function checkDraft(){
  if(!local)return;
  panel.hidden=true;notice.hidden=false;
  document.querySelector('#draft-message').textContent='正在检查本地故事…';
  const resume=document.querySelector('#continue-story');resume.hidden=true;
  try{
    const response=await fetch('./__flatland/draft-status',{cache:'no-store'});
    if(!response.ok)throw new Error('无法检查');
    const {drafts}=await response.json();if(!Array.isArray(drafts))throw new Error('无法检查');
    panel.hidden=drafts.length>0;notice.hidden=drafts.length===0;
    document.querySelector('#draft-message').textContent='检测到尚未保存的本地故事。请先让 Agent 完成当前故事的 Commit 或 PR，再新建故事。';
    const current=catalogue.find(story=>drafts.includes(story.id));
    if(current){resume.href=`./storyboard.html?story=${encodeURIComponent(current.id)}`;resume.hidden=false;}
  }catch{
    document.querySelector('#draft-message').textContent='暂时无法确认本地故事是否已保存。请让 Agent 检查当前仓库并保存改动，再新建故事。';
  }
}
create.addEventListener('click',async()=>{
  copy.textContent='复制';copyStatus.textContent='';dialog.setAttribute('aria-labelledby',local?'draft-title':'prompt-label');dialog.showModal();
  await checkDraft();dialog.setAttribute('aria-labelledby',notice.hidden?'prompt-label':'draft-title');
  if(dialog.open)(notice.hidden?copy:closeDraft).focus({preventScroll:true});
});
close.addEventListener('click',()=>dialog.close());
closeDraft.addEventListener('click',()=>dialog.close());
if(local&&catalogue.length===0)checkDraft();
bindPromptCopy(prompt,copy,copyStatus);

function resize(){
  sequence=createEntranceStrokes(compact.matches);
  const width=canvas.getBoundingClientRect().width;
  if(!width)return;
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*dpr);
  canvas.height=Math.round(width*sequence.height/sequence.width*dpr);
  draw(elapsed);
}

function draw(time){
  if(!ctx)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  const scale=canvas.width/sequence.width;
  ctx.setTransform(scale,0,0,scale,0,0);ctx.lineCap='round';ctx.lineJoin='round';
  // Paint every retained path first, then the residents, so no trail covers a body.
  const writers=sequence.strokes.map(stroke=>sampleWriter(stroke,time));
  sequence.strokes.forEach((stroke,i)=>{
    const writer=writers[i];
    if(!writer.ink)return;
    ctx.globalAlpha=.86;ctx.strokeStyle=colors[stroke.id%colors.length];ctx.lineWidth=1.6;
    ctx.beginPath();ctx.moveTo(stroke.points[0].x,stroke.points[0].y);
    for(let j=1;j<=writer.segment;j++)ctx.lineTo(stroke.points[j].x,stroke.points[j].y);
    ctx.lineTo(writer.x,writer.y);ctx.stroke();
  });
  sequence.strokes.forEach((stroke,i)=>{
    const writer=writers[i],settled=writer.ink===1;
    ctx.save();ctx.translate(writer.x,writer.y);ctx.rotate(writer.angle);
    // Character's regular polygon convention: circumradius and a head at local +X.
    // No physics world is needed for this independent title choreography.
    const radius=compact.matches?6.2:5.8;
    ctx.beginPath();
    for(let side=0;side<stroke.sides;side++){
      const angle=side*2*Math.PI/stroke.sides,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
      if(side===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();ctx.fillStyle=background;ctx.globalAlpha=1;ctx.fill();
    ctx.globalAlpha=settled?.78:time<stroke.start?.38:1;ctx.strokeStyle=colors[stroke.id%colors.length];ctx.lineWidth=1.4;ctx.stroke();
    // A small head mark makes the travelling polygon's direction legible.
    ctx.beginPath();ctx.arc(radius,0,1.25,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();ctx.restore();
  });
  ctx.globalAlpha=1;
  entrance.style.opacity=sampleEntrance(time).opacity;
}

function pause(){cancelAnimationFrame(frame);frame=0;lastFrame=null;}
function schedule(){if(active&&!document.hidden&&!pageAway&&!frame)frame=requestAnimationFrame(tick);}
function tick(now){
  frame=0;
  if(!active||document.hidden||pageAway){lastFrame=null;return;}
  if(lastFrame!==null)elapsed=Math.min(ENTRANCE_DURATION,elapsed+now-lastFrame);
  lastFrame=now;draw(elapsed);
  if(sampleEntrance(elapsed).complete)showStories({focus:true});else schedule();
}

function showStories({focus=false,hash=true}={}){
  active=false;pause();entrance.hidden=true;entrance.inert=true;stories.hidden=false;stories.inert=false;
  document.body.classList.remove('is-entering');
  gallery.layout();
  document.querySelector('meta[name="theme-color"]').content=background;
  if(hash&&location.hash!=='#stories')history.replaceState(null,'','#stories');
  if(focus)document.querySelector('#stories-title').focus({preventScroll:true});
}

function startEntrance(){
  if(motion.matches||!ctx){showStories({focus:true});return;}
  pause();elapsed=0;active=true;pageAway=false;
  history.replaceState(null,'',location.pathname+location.search);
  entrance.hidden=false;entrance.inert=false;stories.hidden=true;stories.inert=true;
  document.body.classList.add('is-entering');document.querySelector('meta[name="theme-color"]').content=background;
  resize();document.querySelector('#skip-entrance').focus({preventScroll:true});schedule();
}

document.querySelector('#skip-entrance').addEventListener('click',event=>{event.preventDefault();showStories({focus:true});});
replay.addEventListener('click',event=>{event.preventDefault();startEntrance();});
function updateMotion(){
  replay.title=motion.matches||!ctx?'欢迎页':'重播入场';
  if(motion.matches&&active)showStories({focus:true});
}
motion.addEventListener('change',updateMotion);
window.addEventListener('hashchange',()=>{
  if(location.hash==='#stories')showStories({focus:true,hash:false});
  else if(!active)startEntrance();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else schedule();});
window.addEventListener('pagehide',()=>{pageAway=true;pause();});
window.addEventListener('pageshow',()=>{pageAway=false;refreshPaint();draw(elapsed);schedule();});
window.addEventListener('storage',event=>{if(event.key===storageKey||event.key===null){refreshPaint();draw(elapsed);}});
window.addEventListener('flatland-ui-theme-change',()=>{refreshPaint();draw(elapsed);});
new ResizeObserver(()=>{if(active)resize();}).observe(canvas);
compact.addEventListener('change',()=>{if(active)resize();});
refreshPaint();updateMotion();
if(location.hash==='#stories'||motion.matches||!ctx)showStories();else startEntrance();
