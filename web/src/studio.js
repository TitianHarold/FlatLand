import {defaults,storageKey,GAIN_LIMIT,readPreset,sharedSettings} from './studio-preset.js';
import {bindPromptCopy} from './copy-prompt.js';
import {PAINT_STYLES,setCustomPaintStyle,setPaintMode,setWallColor} from './paint.js';
import {distanceAttenuation,scatterProgress} from './optics.js';
import {LENGTH_UNIT,formatLength} from './measure.js';
import './workspace-chrome.css';
import './studio.css';

const $=id=>document.getElementById(id),frame=$('preview'),controls=document.querySelector('.studio-shell');
const scenes={
  house:{title:'我的家',url:'./world.html?studio=1',kind:'world'},
  neighborhood:{title:'小社区',url:'./world.html?studio=1&scene=neighborhood',kind:'world'},
  parade:{title:'彩色阅兵场',url:'./world.html?studio=1&scene=parade',kind:'world'},
  stars:{title:'星野',url:'./world.html?studio=1&scene=stars',kind:'world'},
  mask:{title:'环形广场',url:'./world.html?studio=1&scene=mask',kind:'world'},
  characters:{title:'角色与碰撞',url:'./character-lab.html?studio=1',kind:'characters'},
};
let state=structuredClone(defaults),api=null,loadTimer,saveTimer;
const requested=new URLSearchParams(location.search).get('scene'),requestedScene=requested==='optics'?'stars':requested;
if(Object.hasOwn(scenes,requestedScene))state.currentScene=requestedScene;

const field=(path,label,type,extra={})=>({path,label,type,...extra});
const get=path=>path.split('.').reduce((value,key)=>value[key],state);
function put(path,value){const [group,key]=path.split('.');state[group][key]=value;}
const number=(path,label,min,max,step,format=v=>String(v))=>field(path,label,'range',{min,max,step,format});
const select=(path,label,options)=>field(path,label,'select',{options});
const toggle=(path,label)=>field(path,label,'checkbox');
const hint=(def,description)=>({...def,description});
const distance=(path,label,description)=>hint({...number(path,label,1,13,'any',formatLength),editable:true,unit:LENGTH_UNIT,numeric:{min:2,max:8192,step:1},toControl:Math.log2,fromControl:v=>Math.round(2**v)},description);
const worldView=[
  number('view.dimension','观察维度',0,100,1,v=>`${Math.round(90*(1-v/100))}°`),
  select('view.projection','一维镜头',[['perspective','画面未矫正','平面透视：静止物体、匀速转头时，越靠近画面边缘移动越快。左右平移仍受距离影响。'],['equidistant','画面矫正','曲面等角：静止物体、匀速转头时，相同角度对应相同画面距离。左右平移仍受距离影响。']]),
  number('view.fieldAngle','视角 FOV',60,160,5,v=>`${v}°`),
  number('view.windowHeight','一维窗口',1,100,1,v=>`${v}%`),
];
let activeFields=[];
function renderField(def){
  activeFields.push(def);
  const value=get(def.path),id=`control-${def.path.replace('.','-')}`;
  const described=def.description?`title="${def.description}" aria-description="${def.description}"`:'';
  if(def.type==='checkbox')return `<label class="toggle-control" for="${id}" ${described}><span>${def.label}</span><input id="${id}" data-path="${def.path}" type="checkbox" ${value?'checked':''}></label>`;
  if(def.type==='select'&&def.options.length<=3)return `<div class="control choice-control"><span class="control-heading" id="${id}-label">${def.label}</span><div id="${id}" class="choice-buttons" role="group" aria-labelledby="${id}-label">${def.options.map(([val,label,description])=>`<button ${description?`title="${description}" aria-description="${description}"`:''} data-path="${def.path}" value="${val}" aria-pressed="${String(val)===String(value)}">${label}</button>`).join('')}</div></div>`;
  if(def.type==='select')return `<label class="control select-control" for="${id}"><span class="control-heading">${def.label}</span><select id="${id}" data-path="${def.path}">${def.options.map(([val,label])=>`<option value="${val}" ${String(val)===String(value)?'selected':''}>${label}</option>`).join('')}</select></label>`;
  const controlValue=def.toControl?def.toControl(value):value;
  const numericScale=def.numeric??def;
  const numeric=def.editable?`<span class="numeric-input"><input id="${id}-number" type="number" data-path="${def.path}" min="${numericScale.min}" max="${numericScale.max}" step="${numericScale.step}" value="${def.numeric?value:controlValue}" aria-label="${def.label}${def.unit??''}" ${described}>${def.unit?`<span>${def.unit}</span>`:''}</span>`:`<output for="${id}">${def.format(value)}</output>`;
  return `<div class="control"><div class="control-heading"><label for="${id}" ${described}>${def.label}</label>${numeric}</div><input id="${id}" data-path="${def.path}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${controlValue}" ${def.toControl?`aria-valuetext="${def.format(value)}"`:''} ${described}></div>`;
}
function lightSummary(){
  const rules=sharedSettings(state.shared);
  for(const [id,scattering,scale] of [['attenuation-plot',false,state.shared.attenuationDistance],['scatter-plot',true,state.shared.scatterDistance]]){
    const plot=$(id);if(!plot)continue;
    const response=d=>scattering?(state.shared.scatterEnabled?1-scatterProgress(d,scale,state.shared.scatterCurve):1):distanceAttenuation(d,rules);
    plot.innerHTML=`<svg viewBox="0 0 300 85" role="img" aria-label="${scattering?'清晰度':'亮度'}曲线：横轴距离（身长），纵轴${scattering?'保留清晰度':'保留亮度'}"><path class="plot-grid" d="M38 10H282 M38 62H282"/><polyline points="${Array.from({length:61},(_,i)=>`${38+244*i/60},${10+52*(1-response(scale*i/60))}`).join(' ')}"/><text x="0" y="14">100%</text><text x="6" y="66">0%</text>${[0,1,2].map(i=>`<text x="${38+244*i/2}" y="82" text-anchor="middle">${Number((scale*i/2).toFixed(1))}</text>`).join('')}</svg>`;
  }
}
function emissionControl(material){
  const level=v=>Math.max(-GAIN_LIMIT,Math.min(GAIN_LIMIT,Math.round(Math.log2(v))));
  return renderField(hint({...number(`shared.${material}Emission`,`${material==='resident'?'角色':'建筑'}增益`,-GAIN_LIMIT,GAIN_LIMIT,1,v=>{const n=level(v);return n>0?`+${n}`:String(n);}),
    toControl:level,fromControl:v=>2**v},'0 为原值；每加 1 档翻倍，每减 1 档减半。'));
}
function paintControls(){
  const palette=PAINT_STYLES[state.shared.paintStyle],directional=palette.pattern==='directional';
  const color=(key,value,label)=>`<label class="theme-color"><input type="color" data-paint="${key}" value="${value}" aria-label="${label}" title="${label} · ${value}"><span>${label}</span></label>`;
  return `<div class="paint-grid${directional?' directional-paint':''}">${palette.colors.map((value,i)=>color(String(i),value,directional?['头部','中段','尾部'][i]:`主题 ${i+1}`)).join('')}${color('wall',state.shared.wallColor,'建筑')}</div>`+
    (directional?'':renderField(select('shared.paintMode','用色方式',[['solid','每位单色'],['mixed','随机组合']])))+
    `<p class="paint-rule">${directional?'固定随身体转动的配色；与几何明暗增强独立。':'角色按个体固定选色；建筑独立，切换方案不变。点击色块自定义。'}</p>`;
}
function lightControls(){
  return '<p class="panel-description">我们能够看到多远的光；到范围边缘亮度降为 0%。</p><div class="control-grid">'+renderField(toggle('shared.attenuationEnabled','启用衰减'))+
    renderField(toggle('view.showRange','范围虚线'))+'</div>'+
    renderField(distance('shared.attenuationDistance','视野范围','光线衰减到 0% 的距离，也是最大可见边界；不改变散射的远近变化。按倍数调节：2、4、8…8,192 身长。'))+
    renderField(select('shared.attenuationCurve','衰减方式',[['inverse-square','平方反比 · 近强远弱'],['smooth','平滑 · 柔和渐暗'],['linear','线性 · 匀速下降'],['exponential','指数 · 先快后慢'],['quadratic','二次 · 先慢后快']]))+
    '<div class="attenuation-plot" id="attenuation-plot"></div>';
}
function scatterControls(){
  return '<p class="panel-description">多远之外看不清晰；从近处 100% 清晰，逐渐降到范围边缘的 0%。</p>'+renderField(toggle('shared.scatterEnabled','启用散射'))+
    renderField(distance('shared.scatterDistance','散射范围','到这个距离达到最大模糊，之后保持；不改变光线衰减的可见边界。'))+
    renderField(select('shared.scatterCurve','散射方式',[['smooth','平滑 · 柔和过渡'],['linear','线性 · 均匀增加'],['quadratic','二次 · 先慢后快'],['exponential','指数 · 后段加快'],['logarithmic','对数 · 先快后慢']]))+
    '<div class="attenuation-plot" id="scatter-plot"></div>';
}
function renderInspector(){
  activeFields=[];
  if(scenes[state.currentScene].kind!=='world'){$('inspector-content').replaceChildren();return;}
  const stage='<div class="view-presets" role="group" aria-label="切换视角"><button data-dimension="0" aria-pressed="false">俯视</button><button data-dimension="100" aria-pressed="false">居民一维</button></div>'+worldView.map(renderField).join('')+'<button class="stretch-action" id="expand-shapes">上下拉满</button>';
  const behavior=renderField(select('behavior.population','居民数量',[[0,'场景预设'],[14,'14 位'],[100,'100 位'],[300,'300 位'],[1000,'1,000 位'],[2000,'2,000 位']]))+
    renderField(select('behavior.wandering','居民运动',[[true,'自由移动'],[false,'静止']]))+
    renderField(hint(toggle('behavior.pathfinding','自动寻路'),'开启后绕过墙和居民；关闭时直线行走，遇阻停下。'))+
    renderField(select('behavior.interaction','是否击杀',[['kill','是'],['touch','否']]))+
    renderField(select('behavior.residentKilling','居民是否击杀',[[true,'是'],[false,'否']]))+
    renderField(hint(toggle('behavior.deathAnimation','击杀动画'),'被击杀的形状短暂崩解后消失；关闭时直接消失。'));
  const palette=renderField(select('shared.paintStyle','配色方案',Object.entries(PAINT_STYLES).map(([id,p])=>[id,p.name])))+paintControls()+
    '<div class="control-grid visibility-controls">'+renderField(hint(toggle('shared.coloring','显示染色'),'显示物体配色；关闭后显示灰度，不影响区分度增益或视野遮罩。'))+
    renderField(hint(number('shared.detailGain','区分度增益',0,3,1,v=>v>0?`+${v}`:String(v)),'0 关闭增强；正值增大后，角色与建筑近处边界和后退部分的明暗差更明显。染色和灰度均生效，不改变配色或视野范围。'))+
    '</div>'+renderField(select('shared.detailStyle','增强方式',[['soft','柔和','更宽的亮部与平滑的远近过渡。'],['velvet','绒面','压低亮部峰值，保留宽缓的明暗层次。'],['sharp','锐利','原有曲线：亮部集中，远近对比强烈。']]))+
    '<div class="control-grid">'+emissionControl('resident')+emissionControl('house')+'</div>'+
    renderField(hint({...number('shared.exposure','曝光',-3,3,1,v=>{const n=Math.round(Math.log2(v/12));return n>0?`+${n}`:String(n);}),toControl:v=>Math.round(Math.log2(v/12)),fromControl:v=>12*2**v},'共同影响所有类别。'));
  const panel=(id,title,body)=>`<section class="config-panel" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2><div class="config-panel-body">${body}</div></section>`;
  $('inspector-content').innerHTML=panel('palette','发光方式',palette)+panel('light','光线衰减',lightControls())+panel('scatter','散射模糊',scatterControls())+panel('stage','镜头',stage)+panel('behavior','行为',behavior);
  lightSummary();syncViewControls();syncDisabled();
}
function syncDisabled(snapshot=api?.snapshot()){
  if(scenes[state.currentScene].kind!=='world')return;
  controls.querySelectorAll('#inspector-content button,#inspector-content input,#inspector-content select,#scene-controls button,#scene-controls input,#scene-controls select').forEach(el=>{
    const path=el.dataset.path;
    el.disabled=!api||(['shared.attenuationDistance','shared.attenuationCurve','view.showRange'].includes(path)&&!state.shared.attenuationEnabled)||(['shared.scatterDistance','shared.scatterCurve'].includes(path)&&!state.shared.scatterEnabled);
  });
  if($('expand-shapes'))$('expand-shapes').disabled=!api||snapshot.cameraProgress!==1;
  for(const id of ['zoom-out','zoom-fit','zoom-in'])$(id).disabled=!api||snapshot.cameraProgress!==0||(id==='zoom-out'&&snapshot.overviewZoom<=.25)||(id==='zoom-in'&&snapshot.overviewZoom>=16);
}
function applyShared(changedKey){
  if(!api)return;
  const repaint=!changedKey||['paintStyle','paintMode','wallColor'].includes(changedKey),settings=sharedSettings(state.shared);
  if(!repaint)for(const key of ['paintStyle','customPaint','paintMode','wallColor'])delete settings[key];
  api.configure(settings);
  if(!changedKey){api.set('finish','clear');api.set('contour',true);}
  if(!changedKey||changedKey==='coloring')api.set('coloring',state.shared.coloring);
  if(repaint)api.set('paint-style',state.shared.paintStyle);
}
function applyView(){
  for(const [id,value] of [['field-angle',state.view.fieldAngle],['projection',state.view.projection],['resident-window',state.view.windowHeight],['show-range',state.view.showRange],['map-lock',state.view.mapLocked]])api.set(id,value);
  api.set('perspective',state.view.dimension);
  api.configure({display:state.view.display});
  syncViewControls();
}
function applyAll(){
  api.configure({population:state.behavior.population});
  applyShared();
  api.set('wandering',state.behavior.wandering);api.set('interaction',state.behavior.interaction);
  for(const key of ['pathfinding','residentKilling','deathAnimation'])api.configure({[key]:state.behavior[key]});
  applyView();
}
function changed(path,value){
  put(path,value);
  if(path==='view.windowHeight')state.view.display='line';
  const [group,key]=path.split('.');
  if(group==='shared'){if(key==='paintMode')setPaintMode(value);applyShared(key);}
  else if(group==='view')applyView();
  else if(group==='behavior'){
    if(key==='population'){api.configure({population:value});applyShared();}
    else if(['pathfinding','residentKilling','deathAnimation'].includes(key))api.configure({[key]:value});
    else api.set(key,value);
  }
  queueSave();
  if(['shared.paintStyle','shared.paintMode'].includes(path))renderInspector();
  controls.querySelectorAll('.choice-buttons button').forEach(button=>button.setAttribute('aria-pressed',String(button.value===String(get(button.dataset.path)))));
  lightSummary();
  syncDisabled();
}
function syncViewControls(){
  controls.querySelectorAll('[data-dimension]').forEach(button=>button.setAttribute('aria-pressed',String(state.view.dimension===Number(button.dataset.dimension))));
  if($('expand-shapes'))$('expand-shapes').textContent=state.view.display==='expanded'?'收回细线':'上下拉满';
}
function loadScene(id){
  clearTimeout(loadTimer);api=null;state.currentScene=id;
  const config=scenes[id],lab=config.kind!=='world';
  document.querySelector('.studio-shell').classList.toggle('lab-active',lab);
  document.querySelector('.inspector').hidden=lab;
  for(const el of [$('scene-controls'),$('reset-scene'),document.querySelector('.canvas-zoom')])el.hidden=lab;
  document.title=`平面国 · ${config.title} · 游乐场`;
  frame.title=`${config.title}实时预览`;
  $('loading').hidden=false;$('loading').querySelector('strong').textContent='正在准备场景';$('retry').hidden=true;
  document.querySelectorAll('[data-scene]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.scene===id));
  const url=new URL(location.href);url.searchParams.set('scene',id);history.replaceState(null,'',url);
  renderInspector();syncViewControls();frame.src=config.url;queueSave();
  loadTimer=setTimeout(()=>{
    if(api)return;
    $('loading').querySelector('strong').textContent='场景尚未就绪，请重新加载';$('retry').hidden=false;
  },20000);
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='flatland-studio-ready')return;
  if(event.data.kind!==scenes[state.currentScene].kind)return;
  api=frame.contentWindow.flatlandStudio;
  try{
    if(scenes[state.currentScene].kind==='world'){
      applyAll();
      frame.contentDocument.getElementById('map-lock').addEventListener('change',()=>{state.view.mapLocked=api.snapshot().mapLocked;queueSave();});
    }else api.configure({paintStyle:state.shared.paintStyle,customPaint:state.shared.customPaint,paintMode:state.shared.paintMode});
    clearTimeout(loadTimer);$('loading').hidden=true;syncDisabled();updateStatus();
  }catch(error){
    console.error(error);api=null;$('loading').querySelector('strong').textContent='参数接入失败，请重新加载';$('retry').hidden=false;syncDisabled();
  }
});
function updateStatus(){
  if(!api||scenes[state.currentScene].kind!=='world')return;
  const snapshot=api.snapshot();
  $('zoom-value').textContent=`${Math.round(snapshot.overviewZoom*100)}%`;
  const canvasSize=[snapshot.canvasExtent.width,snapshot.canvasExtent.height].map(value=>value.toLocaleString('zh-CN',{maximumFractionDigits:1})).join(' × ');
  const sceneFacts=`<span class="scene-facts" aria-description="俯视时整个可见画布的宽乘高；1 身长等于标准成年个体的直径">${snapshot.population.toLocaleString()} 位 · 俯视画布 ${canvasSize} 身长</span>`;
  if($('scene-controls').innerHTML!==sceneFacts)$('scene-controls').innerHTML=sceneFacts;
  {
    const dimension=Math.round(snapshot.perspective*100);
    state.view.dimension=dimension;if(snapshot.cameraProgress===1)state.view.display=snapshot.lineOnly?'line':'expanded';syncViewControls();syncDisabled(snapshot);
    const control=$('control-view-dimension');
    if(control&&document.activeElement!==control){control.value=dimension;control.closest('.control').querySelector('output').textContent=`${Math.round(90*(1-dimension/100))}°`;}
  }
}
setInterval(updateStatus,500);
document.querySelectorAll('[data-scene]').forEach(button=>button.onclick=()=>{if(button.dataset.scene!==state.currentScene)loadScene(button.dataset.scene);});
controls.addEventListener('input',event=>{
  const path=event.target.dataset.path;if(!path||!['range','number'].includes(event.target.type)||!api)return;
  if(event.target.value===''||!event.target.validity.valid)return;
  const def=activeFields.find(item=>item.path===path),raw=Number(event.target.value);
  const value=def.fromControl&&!(event.target.type==='number'&&def.numeric)?def.fromControl(raw):raw;
  const control=event.target.closest('.control'),output=control.querySelector('output');
  if(output)output.textContent=def.format(value);
  control.querySelectorAll('input').forEach(input=>{
    if(input!==event.target)input.value=input.type==='number'&&def.numeric?value:def.toControl?def.toControl(value):value;
    if(input.type==='range'&&def.toControl)input.setAttribute('aria-valuetext',def.format(value));
  });
  changed(path,value);
});
controls.addEventListener('change',event=>{
  if(event.target.dataset.paint&&api){
    const palette=structuredClone(PAINT_STYLES[state.shared.paintStyle]),key=event.target.dataset.paint;
    if(key==='wall'){state.shared.wallColor=event.target.value;setWallColor(state.shared.wallColor);}
    else{palette.colors[Number(key)]=event.target.value;setCustomPaintStyle(palette);state.shared.customPaint={colors:[...palette.colors],...(palette.pattern?{pattern:palette.pattern}:{})};state.shared.paintStyle='custom';}
    applyShared();queueSave();renderInspector();return;
  }
  const path=event.target.dataset.path;if(!path||event.target.type==='range'||!api)return;
  if(event.target.type==='number'){
    const def=activeFields.find(item=>item.path===path);event.target.value=def.toControl&&!def.numeric?def.toControl(get(path)):get(path);return;
  }
  let value=event.target.type==='checkbox'?event.target.checked:event.target.value;
  if(typeof get(path)==='boolean'&&event.target.type!=='checkbox')value=value==='true';
  if(typeof get(path)==='number')value=Number(value);changed(path,value);
});
controls.addEventListener('click',event=>{
  if(!api)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.path){changed(button.dataset.path,typeof get(button.dataset.path)==='boolean'?button.value==='true':button.value);return;}
  if(button.dataset.dimension!==undefined){if(Number(button.dataset.dimension)<100)state.view.display='line';changed('view.dimension',Number(button.dataset.dimension));updateStatus();}
  if(button.id==='expand-shapes'){api.click('sight-expanded');updateStatus();queueSave();}
});
for(const [id,factor] of [['zoom-out',1/Math.SQRT2],['zoom-in',Math.SQRT2]])$(id).onclick=()=>{api.configure({overviewZoom:api.snapshot().overviewZoom*factor});updateStatus();};
$('zoom-fit').onclick=()=>{api.configure({fitOverview:true});updateStatus();};
$('reset-scene').onclick=() => {loadScene(state.currentScene);};
$('retry').onclick=()=>loadScene(state.currentScene);
function saveConfig(){
  clearTimeout(saveTimer);saveTimer=null;
  try{localStorage.setItem(storageKey,JSON.stringify({version:1,state}));$('save-status').textContent='已自动保存';}
  catch{$('save-status').textContent='浏览器未允许保存配置';}
}
function queueSave(){clearTimeout(saveTimer);$('save-status').textContent='保存中…';saveTimer=setTimeout(saveConfig,250);}
window.addEventListener('pagehide',()=>{if(saveTimer)saveConfig();});
$('export-config').onclick=()=>{
  $('export-json').value=JSON.stringify({version:1,state},null,2);
  $('copy-export').textContent='复制';$('export-status').textContent='';$('export-dialog').showModal();
};
$('close-export').onclick=()=>$('export-dialog').close();
bindPromptCopy($('export-json'),$('copy-export'),$('export-status'));
$('restore').onclick=()=>{const current=state.currentScene;state=structuredClone(defaults);setCustomPaintStyle(state.shared.customPaint);setPaintMode(state.shared.paintMode);setWallColor(state.shared.wallColor);loadScene(current);};
try{const raw=localStorage.getItem(storageKey);if(raw)state=readPreset(JSON.parse(raw));}
catch{$('save-status').textContent='保存的配置不可用，已使用默认值';}
if(Object.hasOwn(scenes,requestedScene))state.currentScene=requestedScene;
setPaintMode(state.shared.paintMode);setWallColor(state.shared.wallColor);
$('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog'))$('about-dialog').close();});
loadScene(state.currentScene);
