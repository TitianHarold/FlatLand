import './storyboard.css';
import {parseStory} from './story-script.js';
import {stories} from './story-catalog.js';
import {defaults,storageKey,readPreset,sharedSettings} from './studio-preset.js';
import {bindPromptCopy} from './copy-prompt.js';

const $=id=>document.getElementById(id),theatre=$('theatre');
let controlsTimer,chapterAnimation,hintTimer;
const scenes={house:'一座房子',parade:'色彩检阅场',stars:'星野',mask:'同心圆遮罩'};
const clock=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const storyId=new URLSearchParams(location.search).get('story');
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let cursor={x:.5,y:.5};
let script,scriptText,storyPreset,source,api,frame,loadTimer,time=0,playing=false,previous=0,actIndex=-1,animation=0;
function report(error,target='error'){$(target).textContent=error.message||String(error);$(target).hidden=false;}
function setPlaying(value){
  playing=Boolean(value&&api);previous=performance.now();showControls();
  cancelAnimationFrame(animation);animation=playing?requestAnimationFrame(tick):0;
  $('play-icon').src=`./icons/${playing?'pause':'play'}.svg`;
  $('play').setAttribute('aria-label',playing?'暂停':'播放');$('play').title=playing?'暂停':'播放';
  $('play-status').textContent=playing?'播放中':!api?'未就绪':time===script?.duration?'播放结束':time===0?'待播放':'已暂停';
}
function display(sample){
  time=sample.time;$('timeline').value=time;$('timeline').style.setProperty('--progress',`${time/script.duration*100}%`);
  $('timeline').setAttribute('aria-valuetext',`${clock(time)}，共 ${clock(script.duration)}`);
  $('time').textContent=`${clock(time)} / ${clock(script.duration)}`;
  if(actIndex!==sample.actIndex){
    actIndex=sample.actIndex;const act=script.acts[actIndex];
    $('act-number').textContent=`ACT ${String(actIndex+1).padStart(2,'0')} / ${String(script.acts.length).padStart(2,'0')} · 当前幕`;
    $('act-title').textContent=act.title;$('act-body').textContent=act.text;
    $('transition-index').textContent=String(actIndex+1).padStart(2,'0');$('transition-title').textContent=act.title;
    chapterAnimation?.cancel();
    chapterAnimation=$('chapter-transition').animate([{opacity:0},{opacity:1,offset:.15},{opacity:1,offset:.7},{opacity:0}],{duration:1800,easing:'ease-out'});
    [...$('act-list').querySelectorAll('button')].forEach((button,i)=>{
      if(i===actIndex){button.setAttribute('aria-current','step');button.scrollIntoView({block:'nearest',inline:'center'});}else button.removeAttribute('aria-current');
    });
  }
}
function seek(next){
  if(!api)return;
  display(api.story.seek(next));
  if(time===script.duration)setPlaying(false);
}
function failStage(error){
  clearTimeout(loadTimer);api=null;setPlaying(false);
  $('play').disabled=$('replay').disabled=$('forward').disabled=$('timeline').disabled=true;
  $('view-overview').disabled=$('view-resident').disabled=$('choose-observer').disabled=$('view-angle').disabled=true;
  $('point-picker').hidden=true;
  for(const button of $('act-list').querySelectorAll('button'))button.disabled=true;
  $('stage-loading').hidden=false;$('stage-loading').querySelector('h2').textContent='舞台暂时没有就绪';
  $('loading-text').textContent=error.message||String(error);$('retry').hidden=false;
}
function loadText(text,label){
  const next=parseStory(text); // Preserve the current story if validation fails.
  clearTimeout(loadTimer);setPlaying(false);api=null;
  script=next;scriptText=text;source=label;time=0;actIndex=-1;
  $('story-title').textContent=script.title;$('story-description').textContent=script.description;
  $('source-label').textContent=script.example?`技术示例 · ${label}`:label;
  $('act-count').textContent=`${String(script.acts.length).padStart(2,'0')} 幕`;
  $('act-list').replaceChildren();$('act-empty').hidden=true;
  script.acts.forEach((act,i)=>{
    const item=document.createElement('li'),button=document.createElement('button');button.disabled=true;
    for(const [className,text] of [['act-index',String(i+1).padStart(2,'0')],['act-name',act.title],['act-duration',clock(act.duration)]]){
      const span=document.createElement('span');span.className=className;span.textContent=text;button.append(span);
    }
    button.onclick=()=>{setPlaying(false);seek(act.start);setPlaying(false);};item.append(button);$('act-list').append(item);
  });
  $('play').disabled=$('replay').disabled=$('forward').disabled=$('timeline').disabled=true;
  $('view-overview').disabled=$('view-resident').disabled=$('choose-observer').disabled=$('view-angle').disabled=true;
  $('point-picker').hidden=true;
  $('timeline').max=script.duration;display({time:0,actIndex:0});
  $('error').hidden=true;$('stage-empty').hidden=true;$('stage-loading').hidden=false;$('retry').hidden=true;
  $('stage-loading').querySelector('h2').textContent='正在布置舞台';$('loading-text').textContent='准备角色与场景…';
  $('stage-caption').hidden=true;$('scene-label').textContent=scenes[script.scene];
  frame=document.createElement('iframe');frame.title='平面国故事舞台';frame.tabIndex=-1;
  frame.src=`./world.html?studio=1&storyboard=1&scene=${encodeURIComponent(script.scene)}`;
  $('world-frame').replaceChildren(frame);
  loadTimer=setTimeout(()=>failStage(new Error('场景加载超时，请重试。')),30000);
}
addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
  if(event.data?.type==='flatland-story-interaction'){showControls();return;}
  if(event.data?.type==='flatland-camera-placed'){showCameraHint();return;}
  if(event.data?.type==='flatland-story-toggle-view'){finishPicking();setView(Number($('view-angle').value)>50?90:0);showControls();return;}
  if(event.data?.type==='flatland-camera-error'){report(event.data.message,'view-status');return;}
  if(event.data?.type!=='flatland-studio-ready')return;
  try{
    api=frame.contentWindow.flatlandStudio;
    if(!api?.story)throw new Error('当前世界不支持剧本播放。');
    let preset=structuredClone(defaults);
    try{const saved=localStorage.getItem(storageKey);if(saved)preset=readPreset(JSON.parse(saved));}
    catch{$('view-status').textContent='保存的工作台配置不可用，已使用默认值。';}
    if(storyPreset!==undefined)preset=readPreset(storyPreset,preset);
    api.configure(sharedSettings(preset.shared));
    for(const [id,value] of [['finish','clear'],['contour',true],['coloring',preset.shared.coloring],['paint-style',preset.shared.paintStyle],['field-angle',preset.view.fieldAngle],['projection',preset.view.projection],['resident-window',preset.view.windowHeight],['show-range',preset.view.showRange],['map-lock',preset.view.mapLocked]])api.set(id,value);
    api.configure({display:preset.view.display});
    api.story.load(scriptText);clearTimeout(loadTimer);
    $('stage-loading').hidden=true;$('stage-caption').hidden=false;
    $('play').disabled=$('replay').disabled=$('forward').disabled=$('timeline').disabled=false;
    $('view-overview').disabled=$('view-resident').disabled=$('choose-observer').disabled=false;
    $('view-angle').disabled=false;setView(90-preset.view.dimension*.9);$('upload-story').hidden=!local;
    for(const button of $('act-list').querySelectorAll('button'))button.disabled=false;
    seek(0);setPlaying(false);
  }catch(error){failStage(error);}
});
$('retry').onclick=()=>loadText(scriptText,source);
$('play').onclick=()=>{if(time===script.duration)seek(0);setPlaying(!playing);};
$('replay').onclick=()=>{seek(0);setPlaying(true);};
$('forward').onclick=()=>{seek(Math.min(time+10,script.duration));showControls();};
$('timeline').oninput=()=>{setPlaying(false);seek(Number($('timeline').value));setPlaying(false);};
function setView(angle){
  if(!api)return;
  api.set('perspective',(90-angle)/90*100);
  $('view-angle').value=(90-angle)/90*100;$('view-angle-value').textContent=`${Math.round(angle)}°`;
  $('view-angle').setAttribute('aria-valuetext',`${Math.round(angle)}°${angle===90?'，俯视':angle===0?'，居民视角':''}`);
  $('view-overview').setAttribute('aria-pressed',angle===90);$('view-resident').setAttribute('aria-pressed',angle===0);
  $('view-label').textContent=angle===0?'居民视角':'俯视';
}
function chooseObserver(){
  if(!api)return;
  setPlaying(false);setView(90);api.story.beginViewpoint();
  $('point-picker').hidden=false;$('pick-hint').textContent='点击画面选择观察点';
  $('view-status').textContent='';$('choose-observer').setAttribute('aria-label','取消选点');$('choose-observer').title='取消选点';$('observer-icon').src='./icons/x.svg';
  $('point-picker').focus({preventScroll:true});
}
function finishPicking(){
  $('point-picker').hidden=true;$('choose-observer').setAttribute('aria-label','选择观察点');$('choose-observer').title='选择观察点';$('observer-icon').src='./icons/crosshair.svg';
}
$('choose-observer').onclick=()=>{
  if(!$('point-picker').hidden){finishPicking();$('view-status').textContent='';}
  else chooseObserver();
};
$('view-overview').onclick=()=>{finishPicking();setView(90);};
$('view-resident').onclick=()=>{finishPicking();setView(0);};
$('view-angle').oninput=()=>setView(90-Number($('view-angle').value)*.9);
const picker=$('point-picker');
function showCursor(){ $('point-cursor').style.left=`${cursor.x*100}%`;$('point-cursor').style.top=`${cursor.y*100}%`; }
picker.onpointermove=event=>{const rect=picker.getBoundingClientRect();cursor={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};showCursor();};
picker.onkeydown=event=>{
  const direction={ArrowLeft:[-.03,0],ArrowRight:[.03,0],ArrowUp:[0,-.03],ArrowDown:[0,.03]}[event.key];
  if(direction){event.preventDefault();cursor={x:Math.max(0,Math.min(1,cursor.x+direction[0])),y:Math.max(0,Math.min(1,cursor.y+direction[1]))};showCursor();}
  if(event.key==='Escape'){finishPicking();$('choose-observer').focus();}
};
picker.onclick=event=>{
  const rect=picker.getBoundingClientRect(),point=event.detail?{x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height}:cursor;
  try{
    api.story.observeAt(point.x,point.y);finishPicking();
    $('view-status').textContent='';setView(90);theatre.focus({preventScroll:true});showCameraHint();
  }catch(error){$('pick-hint').textContent=error.message;}
};
const cameraKeys=['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE'];
function releaseCameraKeys(){for(const code of cameraKeys)api?.key(code,false);}
addEventListener('keydown',event=>{
  if(!cameraKeys.includes(event.code)||!api||!picker.hidden||$('upload-dialog').open||event.metaKey||event.ctrlKey||event.altKey||event.target.isContentEditable||['TEXTAREA','SELECT'].includes(event.target.tagName))return;
  event.preventDefault();api.key(event.code,true);showControls();
});
addEventListener('keyup',event=>{if(cameraKeys.includes(event.code))api?.key(event.code,false);});
addEventListener('blur',releaseCameraKeys);
function showCameraHint(){
  try{if(localStorage.getItem('flatland-camera-help-seen-v1'))return;localStorage.setItem('flatland-camera-help-seen-v1','1');}catch{}
  const hint='W/S 前后 · A/D 转向 · Q/E 平移';
  $('view-status').textContent=hint;clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>{if($('view-status').textContent===hint)$('view-status').textContent='';},9000);
}
$('upload-story').onclick=()=>{
  setPlaying(false);releaseCameraKeys();
  $('upload-prompt').value=`请按照 https://github.com/TitianHarold/FlatLand 中的 AGENTS.md 帮我上传当前故事并创建 PR。
故事目录：web/stories/${storyId}/

请先完成以下检查：
1. 核对当前仓库、故事目录、GitHub 登录状态和 Fork。没有 Fork 时请协助我创建；需要登录或授权时，告诉我具体操作。不要另建一份无关仓库。
2. 检查故事文件与本地播放、暂停、重播、字幕和动作，运行项目检查与构建。有问题先帮我修好，未通过时不要上传。
3. 确认完整 PR 只包含这个故事目录的普通数据和素材文件；排除其他故事、平台代码、配置、脚本、密钥和符号链接，保留我已有的其他修改。

检查通过后，按 AGENTS.md 在干净故事分支上提交、推送，并向 TitianHarold/FlatLand 创建 PR。最后读回远端完整文件列表，确认没有越界，再给我 PR 链接。不要自动合并或部署。`;
  $('copy-upload').textContent='复制';$('upload-status').textContent='';$('upload-dialog').showModal();
};
$('close-upload').onclick=()=>$('upload-dialog').close();
bindPromptCopy($('upload-prompt'),$('copy-upload'),$('upload-status'));
function showControls(){
  clearTimeout(controlsTimer);theatre.classList.add('controls-visible');
  if(playing)controlsTimer=setTimeout(()=>theatre.classList.remove('controls-visible'),2500);
}
theatre.addEventListener('pointermove',showControls);
theatre.addEventListener('pointerdown',showControls);
theatre.addEventListener('focusin',showControls);
$('fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await theatre.requestFullscreen();}
  catch{$('view-status').textContent='当前浏览器无法进入全屏。';}
};
document.addEventListener('fullscreenchange',()=>{
  const full=Boolean(document.fullscreenElement);
  $('fullscreen-icon').src=`./icons/${full?'minimize':'maximize'}.svg`;
  $('fullscreen').setAttribute('aria-label',full?'退出全屏':'全屏');$('fullscreen').title=full?'退出全屏':'全屏';showControls();
});
function tick(now){
  if(playing){
    try{seek(Math.min(script.duration,time+(now-previous)/1000));}catch(error){failStage(error);}
  }
  previous=now;animation=playing?requestAnimationFrame(tick):0;
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){setPlaying(false);releaseCameraKeys();}});
addEventListener('pagehide',()=>{releaseCameraKeys();clearTimeout(hintTimer);setPlaying(false);clearTimeout(loadTimer);clearTimeout(controlsTimer);chapterAnimation?.cancel();});

if(storyId!==null){
  const entry=stories.find(story=>story.id===storyId);
  if(!entry)report(new Error('没有找到这个故事，请返回故事列表。'));
  else{
    try{
      const response=await fetch(entry.source);
      if(!response.ok)throw new Error(`故事文件暂时无法读取（${response.status}）。`);
      storyPreset=entry.settings;loadText(await response.text(),'故事');
    }catch(error){report(error);}
  }
}
