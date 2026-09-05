import {Character, characterTypes, RAPIER} from './characters.js';
import {MIN_SIZE,MAX_SIZE,formatLength} from './measure.js';
import './character-lab.css';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';
import {connectStudio} from './studio-bridge.js';

const $=id=>document.getElementById(id), ns='http://www.w3.org/2000/svg';
let paintStyle=DEFAULT_PAINT_STYLE;
function svg(tag, attributes={}) {
  const node=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}
function drawShape(character) {
  const segment=character.shape.kind==='segment';
  const group=svg('g',{'aria-label':segment?'女性，暖色头段，冷色虚线尾段':`${character.name}，沿头部轴线对称，头暖尾冷`});
  character.paintedEdges.forEach(({a,b,color},i)=>{
    group.append(svg('line',{
      x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'character-shape',stroke:color,
      ...(segment?{'data-part':i===0?'tail':'front',...(i===0?{'stroke-dasharray':'4 4','stroke-opacity':.5}:{})}:{}),
    }));
  });
  group.append(svg('line',{x1:character.head.x*.65,y1:0,x2:character.head.x,y2:0,class:'character-shape',stroke:character.color,'data-part':'head'}));
  return group;
}

const previews=characterTypes.map(type=>{
  const character=new Character(`preview-${type.id}`,type);
  const card=document.createElement('figure');card.className='character-card';
  card.innerHTML=`<h3>${character.name}<span>${character.sides===null?'线段':`${character.sides} 条边`}</span></h3>`;
  const image=svg('svg',{viewBox:'-120 -100 240 200',role:'img','aria-label':`${character.name}的形状`});
  const group=svg('g');group.append(svg('circle',{r:character.radius,class:'size-guide'}),drawShape(character));image.append(group);card.append(image);
  const caption=document.createElement('figcaption');
  caption.textContent=`体型 ${formatLength(character.size)}${character.shape.kind==='segment'?' · 暖色头段 / 冷色虚线尾段':' · 两侧同色 · 头暖尾冷'}`;
  card.append(caption);$('gallery').append(card);group.character=character;return group;
});
function updatePreview() {
  const zoom=Number($('shape-zoom').value)/100, angle=Number($('shape-angle').value);
  for(const group of previews)group.setAttribute('transform',`scale(${130*zoom} ${-130*zoom}) rotate(${angle})`);
  $('shape-zoom-value').value=`${Math.round(zoom*100)}%`;$('shape-angle-value').value=`${angle}°`;
}
$('shape-zoom').addEventListener('input',updatePreview);$('shape-angle').addEventListener('input',updatePreview);
$('preview-reset').onclick=()=>{$('shape-zoom').value=100;$('shape-angle').value=0;updatePreview();};updatePreview();
for(const id of ['type-a','type-b'])for(const type of characterTypes)$(id).add(new Option(type.name,type.id));
$('type-b').value='regular-5';

let world, events, characters=[], meshes=[], active=0, byCollider;
const keys=new Set();
function reset() {
  keys.clear();events?.free();world?.free();
  world=new RAPIER.World({x:0,y:0});world.timestep=1/60;
  world.integrationParameters.numSolverIterations=8;world.integrationParameters.maxCcdSubsteps=4;
  events=new RAPIER.EventQueue(true);byCollider=new Map();
  for(const [x,y,hx,hy] of [[-2.61,0,.01,1.32],[2.61,0,.01,1.32],[0,1.31,2.6,.01],[0,-1.31,2.6,.01]]){
    const boundary=world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy).setTranslation(x,y));byCollider.set(boundary.handle,boundary);
  }
  characters=['type-a','type-b'].map((id,i)=>{
    const type=characterTypes.find(t=>t.id===$(id).value);
    const size=Number($(i===0?'size-a':'size-b').value);
    const character=new Character(`actor-${i}`,type,{size,paintStyle}).attach(world,{x:i===0?-1:1,y:0,angle:i===0?0:Math.PI});
    byCollider.set(character.collider.handle,character);return character;
  });
  meshes=characters.map((character,i)=>{
    const group=svg('g',{class:'actor','data-character-id':character.id});group.append(drawShape(character));
    const label=svg('text',{class:'actor-label',x:0,y:-.7,transform:'scale(1 -1)'});label.textContent=i===0?'A':'B';group.append(label);return group;
  });
  $('actors').replaceChildren(...meshes);world.step(events);render();
}
function render() {
  characters.forEach((character,i)=>{
    const p=character.body.translation(),angle=character.body.rotation()*180/Math.PI;
    meshes[i].setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${angle})`);
    meshes[i].querySelector('text').setAttribute('transform',`rotate(${-angle}) scale(1 -1)`);
    meshes[i].dataset.state=character.state;
  });
  const current=characters[active];
  const status=characters.map((character,i)=>{
    const state=character.deathCause==='killed'?'被击杀':{alive:'存活',injured:'受伤',dead:'死亡'}[character.state];
    return `角色 ${i===0?'A':'B'} · ${character.name} · ${state}`;
  }).join('\n');
  if($('status').textContent!==status)$('status').textContent=status;
  for(const button of document.querySelectorAll('[data-interaction]')){
    button.disabled=current.state==='dead';button.setAttribute('aria-pressed',button.dataset.interaction===current.interaction);
  }
  $('interaction-hint').textContent=current.interaction==='kill'
    ?'击杀：用自己的尖角或线段端点撞向对方才会击杀；侧边接触只停住。'
    :'触摸：尖角、端点和侧边接触都不会伤人。碰到时停住，可反向移开。';
  for(const button of document.querySelectorAll('[data-key]'))button.disabled=current.state==='dead';
}
function updateSceneZoom() {
  const zoom=Number($('scene-zoom').value)/100;
  $('stage-world').setAttribute('transform',`scale(${130*zoom} ${-130*zoom})`);$('scene-zoom-value').value=`${Math.round(zoom*100)}%`;
}
$('scene-zoom').oninput=updateSceneZoom;updateSceneZoom();

try {await RAPIER.init();reset();}
catch(error){$('status').textContent='角色物理加载失败，请刷新页面。';throw error;}
$('reset').onclick=reset;$('type-a').onchange=reset;$('type-b').onchange=reset;
for(const id of ['size-a','size-b']){
  $(id).min=MIN_SIZE;$(id).max=MAX_SIZE;
  $(id).oninput=()=>{$(`${id}-value`).value=formatLength(Number($(id).value));reset();};
}
document.querySelectorAll('[name=active]').forEach(input=>input.onchange=()=>{characters[active].move();keys.clear();active=Number(input.value);render();});
document.querySelectorAll('[data-interaction]').forEach(button=>button.onclick=()=>{
  keys.clear();characters[active].stop();characters[active].setInteraction(button.dataset.interaction);render();
});
const moveKeys=['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
document.addEventListener('keydown',event=>{
  if(!moveKeys.includes(event.code)||event.target.matches('input,select'))return;
  event.preventDefault();keys.add(event.code);
});
document.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>keys.clear());
document.querySelectorAll('[data-key]').forEach(button=>{
  button.onpointerdown=event=>{event.preventDefault();button.setPointerCapture(event.pointerId);keys.add(button.dataset.key);};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>keys.delete(button.dataset.key));
  button.onkeydown=event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();keys.add(button.dataset.key);}};
  button.onkeyup=()=>keys.delete(button.dataset.key);button.onblur=()=>keys.delete(button.dataset.key);
});
let previous=performance.now(), accumulator=0;
function animate(now) {
  accumulator+=Math.min((now-previous)/1000,.08);previous=now;
  const held=(...codes)=>codes.some(code=>keys.has(code))?1:0;
  while(accumulator>=1/60){
    const input={forward:held('KeyW','ArrowUp')-held('KeyS','ArrowDown'),side:held('KeyQ')-held('KeyE'),turn:held('KeyA','ArrowLeft')-held('KeyD','ArrowRight')};
    const initiator=input.forward||input.side||input.turn?characters[active]:null;
    characters[active].move(input);
    world.step(events);
    events.drainCollisionEvents((a,b,started)=>{
      const first=byCollider.get(a),second=byCollider.get(b);
      if(first instanceof Character)first.onCollision(second,started,initiator);
      if(second instanceof Character)second.onCollision(first,started,initiator);
    });
    accumulator-=1/60;
  }
  render();requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
connectStudio('characters',{
  configure(values){
    if(values.paintStyle&&Object.hasOwn(PAINT_STYLES,values.paintStyle)){
      paintStyle=values.paintStyle;
      for(const group of previews){group.character.setPaintStyle(paintStyle);group.lastElementChild.replaceWith(drawShape(group.character));}
      characters.forEach((character,i)=>{character.setPaintStyle(paintStyle);meshes[i].firstElementChild.replaceWith(drawShape(character));});
    }
    if(values.active!==undefined){
      const input=document.querySelector(`[name=active][value="${Number(values.active)}"]`);
      if(input){input.checked=true;input.dispatchEvent(new Event('change'));}
    }
    if(values.interaction)document.querySelector(`[data-interaction="${values.interaction==='touch'?'touch':'kill'}"]`).click();
  },
  snapshot:()=>({status:$('status').textContent,interaction:characters[active].interaction,active,sizes:characters.map(c=>c.size),paint:PAINT_STYLES[paintStyle],playerState:characters[active].state}),
});
