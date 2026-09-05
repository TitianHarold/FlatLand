import {projectScene,exposeRow,OPTICS_RULES,DEFAULT_FOV} from './optics.js';
import {resident,paintResident,makeColorField,makeCrowd,STUDY_SHAPES} from './study-scene.js';
import './study.css';
import './workspace-chrome.css';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';
import {connectStudio} from './studio-bridge.js';
import {MAX_SIZE,formatLength} from './measure.js';

const $=id=>document.getElementById(id), radians=Math.PI/180;
const starsOnly=new URLSearchParams(location.search).get('scene')==='stars';
document.documentElement.classList.toggle('stars-only',starsOnly);
if(starsOnly)document.querySelector('.crowd-heading p').textContent='240 位居民，距离 1,200—3,000 身长。调大视野范围来查看星点；关闭遮罩可对照全部颜色。右图仅标记分布与朝向。';
const cards=(starsOnly?[]:STUDY_SHAPES).map(({name,label,shape})=>{
  const figure=document.createElement('figure');figure.className='figure';
  figure.innerHTML=`<div class="figure-heading"><span class="side-number">${label}</span><h2>${name}</h2></div><canvas class="plan" aria-label="${name}与它的观察者，按实际距离比例绘制"></canvas><div class="eye-caption">观察者</div><canvas class="projection" aria-label="${name}的一维视野投影"></canvas><figcaption class="figure-stats"><span>投影宽度</span><output></output></figcaption>`;
  $('comparison').append(figure);
  return {shape,plan:figure.querySelector('.plan'),view:figure.querySelector('.projection'),output:figure.querySelector('output')};
});
const crowd=makeCrowd();
let rotation=24, distance=6, heading=-26;
let projection='equidistant';
let paintStyle=DEFAULT_PAINT_STYLE;
// One scene policy shared by all seven eyes and the crowd observer.
const rules={...OPTICS_RULES,finish:'clear',coloring:true,attenuationMode:'wash'};
let spinning=!starsOnly&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
let dirty=true, crowdDirty=true, last=0, lastDraw=0, lastAnnouncement=0;

function setSpinning(value) {
  spinning=value;$('spin').setAttribute('aria-pressed',value);
  $('spin').textContent=value?'暂停旋转':'自动旋转';
}
setSpinning(spinning);
function changed() {dirty=true;crowdDirty=true;}
function updateRotation() {
  $('rotation').value=rotation;$('rotation-value').value=`${Math.round(rotation)}°`;
}
function updateDistance() {
  $('distance').value=1000*Math.log(distance/3)/Math.log(1000);
  $('distance-value').value=formatLength(distance);
  for(const button of document.querySelectorAll('[data-distance]'))button.classList.toggle('active',Math.abs(distance-Number(button.dataset.distance))<.1);
  dirty=true;
}
function setHeading(value) {
  heading=((value+180)%360+360)%360-180;
  $('heading').value=heading;$('heading-value').value=`${Math.round(heading)}°`;
  $('dense').classList.toggle('active',Math.abs(heading+26)<.1);
  $('sparse').classList.toggle('active',Math.abs(heading+135)<.1);
  crowdDirty=true;
}
$('rotation').addEventListener('input',e=>{rotation=Number(e.target.value);setSpinning(false);updateRotation();changed();});
$('spin').onclick=()=>setSpinning(!spinning);
$('distance').addEventListener('input',e=>{distance=3*1000**(Number(e.target.value)/1000);updateDistance();});
for(const button of document.querySelectorAll('[data-distance]'))button.onclick=()=>{distance=Number(button.dataset.distance);updateDistance();};
$('emission').value=Math.log2(rules.exposure)*10;
$('emission-value').value=`${rules.exposure}×`;
$('emission').addEventListener('input',e=>{rules.exposure=2**(Number(e.target.value)/10);$('emission-value').value=`${rules.exposure.toFixed(rules.exposure<10?1:0)}×`;changed();});
const fogLabel=value=>value===0?'透明':value<.0003?'极淡':value<.003?'薄雾':value<.03?'有雾':'浓雾';
$('fog').value=100*Math.log(1+rules.fog/.00001)/Math.log(20001);
$('fog-value').value=fogLabel(rules.fog);
$('fog').addEventListener('input',e=>{rules.fog=.00001*(20001**(Number(e.target.value)/100)-1);$('fog-value').value=fogLabel(rules.fog);changed();});
$('attenuation').value=rules.attenuationDistance;
$('attenuation-enabled').checked=rules.attenuationDistance>0;
function updateAttenuation() {
  const enabled=$('attenuation-enabled').checked;
  rules.attenuationDistance=enabled?Number($('attenuation').value):0;
  $('attenuation').disabled=!enabled;
  $('attenuation-value').value=enabled?formatLength(rules.attenuationDistance):'关闭';
  changed();
}
$('attenuation').addEventListener('input',updateAttenuation);
$('attenuation-enabled').addEventListener('change',updateAttenuation);
updateAttenuation();
$('heading').addEventListener('input',e=>setHeading(Number(e.target.value)));
$('dense').onclick=()=>setHeading(-26);$('sparse').onclick=()=>setHeading(-135);
$('glow').checked=rules.glow;
$('contour').checked=rules.contour>0;
const finishDescriptions={
  clear:'清透色域保留明亮的固有色，用柔和明暗提示距离；这是杜菲方向的艺术成像实验。',
  matte:'哑光柔化亮部，收住轮廓光晕；暗部仍然可见。',
  original:'原始成像使用初始亮度曲线与光晕，可对照两种柔光效果。',
};
$('finish').value=rules.finish;
function updateFinish(){
  rules.finish=$('finish').value;
  $('finish-description').textContent=finishDescriptions[rules.finish];
  changed();
}
$('finish').addEventListener('change',updateFinish);
updateFinish();
$('coloring').checked=rules.coloring;
$('coloring').addEventListener('change',e=>{rules.coloring=e.target.checked;changed();});
$('attenuation-mode').value=rules.attenuationMode;
$('attenuation-mode').addEventListener('change',e=>{rules.attenuationMode=e.target.value;changed();});
$('field-details').addEventListener('change',changed);
$('projection').value=projection;
function updateProjection(){
  projection=$('projection').value;
  const arc=projection==='equidistant';
  $('projection-description').textContent=arc
    ?'圆弧接收 → 按角度展开：每一格对应相同视角。短弧仅示意接收方向。'
    :'直线接收 → 透视成像：每一格对应相同接收面宽度，边缘每格的视角更小。';
  for(const caption of document.querySelectorAll('.eye-caption'))caption.textContent=arc?'观察者 · 圆弧接收':'观察者 · 直线接收';
  changed();
}
$('projection').addEventListener('change',updateProjection);
updateProjection();
$('glow').addEventListener('change',e=>{rules.glow=e.target.checked;changed();});
$('contour').addEventListener('change',e=>{rules.contour=e.target.checked?OPTICS_RULES.contour:0;changed();});
$('show-crowd').addEventListener('change',()=>{crowdDirty=true;});
updateRotation();updateDistance();setHeading(heading);

// A schematic receiver, not a physical object. Ticks represent equal output
// intervals: equal arc lengths in angular mode, equal chord lengths in perspective.
function drawReceiver(ctx,eye,radius,heading=0){
  const half=DEFAULT_FOV/2,arc=projection==='equidistant',depth=radius*Math.cos(half);
  ctx.save();ctx.translate(eye.x,eye.y);ctx.rotate(heading);
  ctx.strokeStyle='#6c855b';ctx.lineWidth=1.2;ctx.beginPath();
  if(arc)ctx.arc(0,0,radius,-Math.PI/2-half,-Math.PI/2+half);
  else{ctx.moveTo(-radius*Math.sin(half),-depth);ctx.lineTo(radius*Math.sin(half),-depth);}
  ctx.stroke();
  for(let i=0;i<=4;i++){
    const u=i/4,angle=(2*u-1)*half;
    const x=arc?radius*Math.sin(angle):(2*u-1)*radius*Math.sin(half);
    const y=arc?-radius*Math.cos(angle):-depth;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.lineTo(x+(arc?3*Math.sin(angle):0),y-(arc?3*Math.cos(angle):3));ctx.stroke();
  }
  ctx.restore();
}
function diagram(canvas,body) {
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const eye={x:w/2,y:h-24}, scale=Math.min((w-24)/2.6,(h-58)/(distance+1.3));
  const pos=p=>({x:eye.x+p.x*scale,y:eye.y-p.y*scale});
  ctx.strokeStyle='#e1e5d8';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(eye.x,18);ctx.lineTo(eye.x,eye.y);ctx.stroke();
  const sorted=[...body.vertices].sort((a,b)=>a.x/a.y-b.x/b.y);
  const left=pos(sorted[0]),right=pos(sorted.at(-1));
  ctx.fillStyle='#829a7310';ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#91a680';ctx.lineWidth=.7;
  for(const p of [left,right]){ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
  ctx.beginPath();body.vertices.forEach((p,i)=>{const q=pos(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});
  if(body.vertices.length>2){ctx.closePath();ctx.fillStyle='#eef0e5';ctx.fill();}
  ctx.strokeStyle='#404b39';ctx.lineWidth=1.5;ctx.stroke();
  if(rules.coloring)for(const {a,b,color} of body.paintedEdges){
    const p=pos(a),q=pos(b);ctx.strokeStyle=color;ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  }
  drawReceiver(ctx,eye,Math.min(32,w*.3));
  ctx.fillStyle='#6c855b';ctx.beginPath();ctx.arc(eye.x,eye.y,3.2,0,Math.PI*2);ctx.fill();
}
function sight(canvas,bodies,angle=0,settings=rules) {
  // One sample cell per CSS pixel keeps the optical spread consistent across
  // display densities. Each cell integrates all its visible subpixel intervals.
  const width=Math.max(1,Math.round(canvas.clientWidth));
  if(canvas.width!==width||canvas.height!==1){canvas.width=width;canvas.height=1;}
  const result=projectScene(bodies,width,{observer:{heading:angle,projection},rules:settings});
  const pixels=exposeRow(result,settings);
  canvas.getContext('2d').putImageData(new ImageData(pixels,width,1),0,0);
  return result;
}
function drawFieldPlan(bodies){
  const canvas=$('field-plan'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const scale=Math.min((w-16)/24,(h-28)/(distance*1.5)),eye={x:w/2,y:h-14};
  const pos=p=>({x:eye.x+p.x*scale,y:eye.y-p.y*scale});
  ctx.strokeStyle='#ccd3c1';ctx.lineWidth=.7;
  for(const x of [-distance*1.5,distance*1.5]){
    const p=pos({x,y:distance*1.5});ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(p.x,p.y);ctx.stroke();
  }
  for(const body of bodies)for(const {a,b,color} of body.paintedEdges){
    const p=pos(a),q=pos(b);ctx.strokeStyle=rules.coloring?color:'#555c50';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  }
  drawReceiver(ctx,eye,18);
  ctx.fillStyle='#667d56';ctx.beginPath();ctx.arc(eye.x,eye.y,3,0,2*Math.PI);ctx.fill();
}
function drawMap() {
  const ctx=$('crowd-map').getContext('2d'),centre=80,radius=65;
  ctx.clearRect(0,0,160,160);
  ctx.strokeStyle='#d8decd';ctx.lineWidth=1;ctx.beginPath();ctx.arc(centre,centre,radius,0,Math.PI*2);ctx.stroke();
  const angle=heading*radians;
  ctx.beginPath();ctx.moveTo(centre,centre);ctx.arc(centre,centre,radius,-Math.PI/2+angle-DEFAULT_FOV/2,-Math.PI/2+angle+DEFAULT_FOV/2);ctx.closePath();ctx.fillStyle='#829b721b';ctx.fill();
  if($('show-crowd').checked)for(const p of crowd) {
    const diff=Math.atan2(p.x,p.y)-angle, inView=Math.cos(diff)>Math.cos(DEFAULT_FOV/2);
    ctx.fillStyle=inView?'#738b5d':'#c4cdb8';ctx.beginPath();ctx.arc(centre+p.x/3000*radius,centre-p.y/3000*radius,1.05,0,Math.PI*2);ctx.fill();
  }
  drawReceiver(ctx,{x:centre,y:centre},24,angle);
  ctx.fillStyle='#5c754c';ctx.beginPath();ctx.arc(centre,centre,3,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#6c855b';ctx.beginPath();ctx.moveTo(centre,centre);ctx.lineTo(centre+Math.sin(angle)*24,centre-Math.cos(angle)*24);ctx.stroke();
}
let drag=null;
const starView=$('crowd-view');
starView.addEventListener('pointerdown',e=>{starView.setPointerCapture(e.pointerId);starView.focus({preventScroll:true});drag=e.clientX;});
starView.addEventListener('pointermove',e=>{if(drag!==null){setHeading(heading-(e.clientX-drag)*90/starView.clientWidth);drag=e.clientX;}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])starView.addEventListener(event,()=>{drag=null;});
starView.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setHeading(heading+(e.key==='ArrowLeft'?-2:2));}});
if(!starsOnly){
  new ResizeObserver(changed).observe($('comparison'));
  new ResizeObserver(changed).observe($('field-view'));
}
new ResizeObserver(()=>{crowdDirty=true;}).observe(starView);
document.addEventListener('visibilitychange',()=>{last=0;});
function animate(now) {
  const delta=last?Math.min((now-last)/1000,.1):0;last=now;
  if(!document.hidden&&spinning){rotation=(rotation+delta*12)%360;changed();}
  if(!document.hidden&&now-lastDraw>=1000/30) {
    if(spinning)updateRotation();
    if(dirty&&!starsOnly) {
      for(const [index,card] of cards.entries()) {
        const body=paintResident(resident(card.shape,{y:distance,radius:MAX_SIZE/2,angle:rotation*radians}),index,paintStyle);
        diagram(card.plan,body);const result=sight(card.view,[body]);
        card.output.value=`${result.coverage.toFixed(result.coverage<1?2:1)} px`;
      }
      const field=makeColorField({angle:rotation*radians,distance,details:$('field-details').checked,paintStyle});
      sight($('field-before'),field,0,{...rules,finish:'original',attenuationMode:'brightness'});
      sight($('field-view'),field);drawFieldPlan(field);
      dirty=false;
    }
    if(crowdDirty) {
      const bodies=$('show-crowd').checked?crowd.map((p,i)=>paintResident(resident(p.sides,{...p,radius:MAX_SIZE/2,angle:p.angle+rotation*radians}),i,paintStyle)):[];
      const result=sight(starView,bodies,heading*radians);drawMap();
      // Avoid repeated screen-reader announcements during continuous rotation.
      if(now-lastAnnouncement>350||!spinning){$('crowd-status').textContent=`${result.visibleCount} 位居民可见 / 240 位 · 空处纯黑`;lastAnnouncement=now;}
      crowdDirty=false;
    }
    lastDraw=now;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
connectStudio('optics',{
  configure(values){
    if(values.paintStyle&&Object.hasOwn(PAINT_STYLES,values.paintStyle))paintStyle=values.paintStyle;
    for(const name of ['exposure','fog','attenuationDistance','attenuationMode','attenuationCurve','attenuationFloor','glow'])if(Object.hasOwn(values,name))rules[name]=values[name];
    for(const [material,key] of [['resident','residentEmission'],['house','houseEmission']])if(Object.hasOwn(values,key))rules.materials={...rules.materials,[material]:{...rules.materials[material],emission:values[key]}};
    if(values.spinning!==undefined)setSpinning(values.spinning);
    if(values.distance!==undefined){distance=values.distance;updateDistance();}
    changed();
  },
  snapshot:()=>({status:$('crowd-status').textContent,rotation,distance,spinning,paintStyle,paint:PAINT_STYLES[paintStyle],projection,starsOnly,comparisonCount:cards.length,sampleSize:MAX_SIZE,
    optics:{exposure:rules.exposure,fog:rules.fog,attenuationMode:rules.attenuationMode,attenuationCurve:rules.attenuationCurve,attenuationDistance:rules.attenuationDistance,attenuationFloor:rules.attenuationFloor,residentEmission:rules.materials.resident.emission,houseEmission:rules.materials.house.emission}}),
});
