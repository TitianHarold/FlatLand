import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileStory,parseStory,sampleStory,STORY_LIMITS} from '../src/story-script.js';
import {createSimulation} from '../src/world.js';

const source=await readFile(new URL('../stories/examples/technical-demo.json',import.meta.url),'utf8');
const data=JSON.parse(source),story=parseStory(source),actor=(frame,id)=>frame.actors.find(actor=>actor.id===id);
const first=sampleStory(story,0);
assert.equal(story.example,true);assert.equal(story.duration,18);
assert.equal(first.actIndex,0);assert.equal(actor(first,'pentagon').visible,false);
assert.deepEqual(actor(sampleStory(story,3),'square').position,[-2,0]);
assert.deepEqual(actor(sampleStory(story,6),'square').position,[-1,0],'The next act inherits the previous destination');
assert.equal(sampleStory(story,6).actIndex,1,'An exact act boundary selects the following act');
assert.equal(actor(sampleStory(story,6),'triangle').color,'#8ebe95','Color changes at the action time');
assert.equal(actor(sampleStory(story,7.5),'triangle').angle,135,'Absolute angles interpolate linearly');
assert.equal(actor(sampleStory(story,9),'pentagon').visible,true);
assert.equal(actor(sampleStory(story,14),'pentagon').angle,90,'Explicit degree values can describe a full turn');
assert.equal(actor(sampleStory(story,18),'square').visible,false);
assert.equal(sampleStory(story,18).actIndex,2);assert(sampleStory(story,18).ended);
assert.deepEqual(sampleStory(story,0),first,'Replaying restores position, color, angle and visibility');
assert.deepEqual(sampleStory(story,-10),first);assert(sampleStory(story,999).ended);
assert.throws(()=>sampleStory(story,NaN),/有限数字/);
// Mutating a sampled array cannot corrupt future seeks or the original input.
actor(sampleStory(story,0),'square').position[0]=999;
assert.deepEqual(sampleStory(story,0),first);
assert.deepEqual(data,JSON.parse(source));

function rejects(change,pattern){const value=structuredClone(data);change(value);assert.throws(()=>compileStory(value),pattern);}
assert.throws(()=>parseStory('{invalid'),/JSON/);
assert.throws(()=>parseStory(' '.repeat(STORY_LIMITS.bytes+1)),/4 MB/);
rejects(d=>d.version=2,/version/);
rejects(d=>d.actors[1].id='square',/唯一/);
rejects(d=>d.actors[0].id='__proto__',/ID/);
rejects(d=>d.actors[0].type='circle',/type/);
rejects(d=>d.actors[0].position=[Infinity,0],/position/);
rejects(d=>d.actors[0].size=.1,/size/);
rejects(d=>d.actors[0].visible='false',/visible/);
rejects(d=>d.actors[0].color='red',/#RRGGBB/);
rejects(d=>d.scene='https://example.com',/scene/);
rejects(d=>d.run='alert(1)',/未知字段/);
rejects(d=>d.actors=[],/actors/);
rejects(d=>d.acts[0].duration=0,/duration/);
rejects(d=>d.acts[0].actions[0].actor='missing',/找不到/);
rejects(d=>d.acts[0].actions[0].duration=6,/duration/);
rejects(d=>d.acts[0].actions[1].at=0,/升序/);
rejects(d=>d.acts[0].actions.push({at:2,actor:'square',move:[0,0]}),/重叠/);
rejects(d=>d.acts[0].actions=[{at:0,actor:'square',color:'#000000',duration:1}],/仅移动/);
rejects(d=>d.acts[0].actions=[{at:0,actor:'square'}],/需要 move/);
rejects(d=>d.acts=Array.from({length:7},()=>({title:'Long',duration:600})),/1 小时/);
rejects(d=>d.actors=Array.from({length:STORY_LIMITS.actors+1},(_,i)=>({...d.actors[0],id:`a${i}`})),/2048/);
const minimal=compileStory({version:1,title:'静态幕',scene:'house',actors:[{id:'a',type:'woman',position:[0,0]}],acts:[{title:'空动作',duration:.1}]});
assert.equal(minimal.actors[0].size,1);assert.equal(sampleStory(minimal,.1).actors[0].visible,true);
const instantaneous=structuredClone(data);
instantaneous.acts=[{title:'瞬时与连续',duration:3,actions:[{at:0,actor:'square',move:[0,0]},{at:0,actor:'square',move:[2,0],duration:2}]}];
assert.deepEqual(actor(sampleStory(compileStory(instantaneous),1),'square').position,[1,0]);

for(const layout of ['house','parade','stars','mask']){
  const sim=await createSimulation({layout,scripted:true});
  assert.equal(sim.entities.length,1,'Theatre startup skips the normal crowd');
  sim.setScriptActors(story.actors,story.observer);
  const byId=id=>sim.entities.find(e=>e.storyId===id);
  sim.applyScriptFrame(first);
  assert.equal(sim.entities.length,4);assert.equal(sim.player.storyVisible,false);
  assert.equal(byId('pentagon').storyVisible,false);
  sim.applyScriptFrame(sampleStory(story,9));
  assert.equal(byId('pentagon').storyVisible,true,'An entrance restores visibility');
  assert.equal(byId('triangle').color,'#8ebe95');
  sim.applyScriptFrame(first);
  assert.equal(byId('pentagon').storyVisible,false,'Backward seek hides a later entrance');
  assert.equal(byId('triangle').color,'#426ab3');
  assert.deepEqual({...byId('square').body.translation()},{x:-3,y:0});
  sim.setWandering(true);sim.walkTo({x:5,y:5});
  for(let i=0;i<120;i++)sim.step({forward:1,turn:1});
  assert.deepEqual({...byId('square').body.translation()},{x:-3,y:0},'Physics cannot change the scripted pose');
  assert.equal(sim.relocate({x:5,y:5}),false);
  assert(sim.entities.every(e=>!e.body.isEnabled()),'Script poses never enter contact or killing rules');
  const count=sim.world.bodies.len();
  sim.setScriptActors(story.actors,story.observer);sim.applyScriptFrame(first);
  assert.equal(sim.world.bodies.len(),count,'Replacing the cast releases old rigid bodies');
  assert.equal(sim.entities.length,4);sim.dispose();
}
const studio=await createSimulation({layout:'house',wandering:false});
assert.equal(studio.entities.length,15,'The studio includes the full household; scripted worlds do not spawn it');
assert(studio.entities.every(e=>e.storyVisible===undefined));
assert.throws(()=>studio.setScriptActors(story.actors),/仅可用于剧场/);studio.dispose();
console.log('Story checks passed: validation, boundaries, interpolation, deterministic replay/backward seek, visibility, bounded scripted worlds, cast cleanup and studio isolation.');

// The exported lens and palette survive the exact controller-to-world calls.
const {defaults,readPreset,sharedSettings,storageKey}=await import('../src/studio-preset.js');
assert.equal(defaults.shared.coloring,false,'Fresh studio and welcome start without colour');
const preset={version:1,state:structuredClone(defaults)};
Object.assign(preset.state.view,{fieldAngle:160,windowHeight:61,projection:'equidistant',display:'expanded'});
preset.state.shared.paintStyle='neon';
assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset.state);
assert.throws(()=>readPreset({...preset,state:{...preset.state,view:{...preset.state.view,fieldAngle:999}}}),/Out of range/);
const {draftIds}=await import('../dev/story-status.js');
assert.deepEqual(draftIds('?? web/stories/new-story/story.json\0 M web/stories/new-story/script.md\0R  web/stories/other-story/renamed.json\0web/stories/old-story/story.json\0 M web/src/main.js\0?? web/stories/examples/a.json\0'),['new-story','other-story','old-story']);
assert.deepEqual(draftIds(''),[],'Saved stories do not block creation');
const inherited=compileStory({version:1,title:'Inherited paint',scene:'parade',actors:[{id:'a',type:'regular-4',position:[0,0]}],acts:[{title:'Color',duration:4,actions:[{at:2,actor:'a',color:'#ff0000'}]}]});
const paintWorld=await createSimulation({layout:'parade',scripted:true});
paintWorld.setScriptActors(inherited.actors,undefined,'neon');
const painted=paintWorld.entities.find(e=>e.storyId==='a'),base=painted.color;
paintWorld.applyScriptFrame(sampleStory(inherited,0));assert.equal(painted.color,base);
paintWorld.applyScriptFrame(sampleStory(inherited,3));assert.equal(painted.color,'#ff0000');
paintWorld.applyScriptFrame(sampleStory(inherited,0));assert.equal(painted.color,base,'Rewind restores the inherited palette');paintWorld.dispose();

const {default:vm}=await import('node:vm');
const controller=(await readFile(new URL('../src/storyboard.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const playerHtml=await readFile(new URL('../storyboard.html',import.meta.url),'utf8');
const cameraKeyRelease=calls=>['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE'].every(code=>calls.some(call=>call[0]===code&&call[1]===false));
async function playerSettings(override,preferredHeight){
  const values={},events={},timers=new Map(),reduced={matches:false};let timerId=0,presetReads=0,presetWrites=0,now=0,raf;
  const element=tag=>({tag,hidden:false,disabled:false,children:[],style:{setProperty(k,v){this[k]=v;}},classList:{classes:new Set(),add(c){this.classes.add(c);},remove(c){this.classes.delete(c);}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},focus(){},scrollIntoView(options){this.scrollOptions=options;},addEventListener(){},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    querySelector(){return this.heading??=element('h2');},querySelectorAll(){return this.children.flatMap(child=>child.tag==='button'?[child]:child.querySelectorAll());},
    showModal(){this.open=true;},close(){this.open=false;},animate(frames,options){return this.animation={frames,options,cancelled:false,cancel(){this.cancelled=true;},updatePlaybackRate(rate){this.playbackRate=rate;}};}});
  const elements=new Map([...playerHtml.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element('div')]));
  const keyCalls=[];
  const api={key(code,pressed){keyCalls.push([code,pressed]);},configure(v){Object.assign(values,v);},set(k,v){values[k]=v;},story:{load(){},seek(time){return sampleStory(story,time);},setColoring(value){values.storyColorVisible=value;}}};
  const document={getElementById:id=>elements.get(id),createElement:tag=>({...element(tag),...(tag==='iframe'?{contentWindow:{flatlandStudio:api}}:{})}),addEventListener(){}};
  const saved=JSON.stringify(preset),helpStorage=new Map();
  if(preferredHeight!==undefined)helpStorage.set('flatland-story-window-height-v1',preferredHeight);
  const sandbox={document,parseStory,stories:[],defaults,storageKey,readPreset,sharedSettings,bindPromptCopy(){},URLSearchParams,
    location:{search:'',hostname:'localhost',origin:'http://localhost:5173'},localStorage:{getItem(key){if(key===storageKey){presetReads++;return saved;}return helpStorage.get(key);},setItem(key,value){if(key===storageKey)presetWrites++;helpStorage.set(key,value);}},
    structuredClone,performance:{now:()=>now},matchMedia:()=>reduced,getComputedStyle:el=>({opacity:el.animation&&!el.animation.cancelled?'.5':el.style.opacity??'1'}),
    setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(fn){raf=fn;return 1;},cancelAnimationFrame(){raf=null;},
    addEventListener:(name,fn)=>events[name]=fn,fixtureText:source,override};
  await vm.runInNewContext(`(async()=>{${controller}\nstoryPreset=override;loadText(fixtureText,'test');})()`,sandbox);
  const frame=elements.get('world-frame').children[0];
  const stage=elements.get('world-frame');
  const finishFade=()=>{for(let i=0;i<2&&stage.animation&&!stage.animation.cancelled;i++)stage.animation.onfinish();};
  events.message({origin:sandbox.location.origin,source:frame.contentWindow,data:{type:'flatland-studio-ready'}});
  assert.equal(elements.get('stage-loading').hidden,true);
  assert.equal(elements.get('play-icon').src,'./icons/pause.svg');
  assert.equal(elements.get('play-status').textContent,'播放中','Entering a loaded story starts playback automatically');
  assert.equal(elements.get('speed').disabled,false,'Speed becomes available when the story is ready');
  const configured={...values};
  elements.get('play').onclick();
  const cameraPlaced={origin:sandbox.location.origin,source:frame.contentWindow,data:{type:'flatland-camera-placed'}};
  events.message(cameraPlaced);assert.equal(elements.get('view-status').textContent,'W/S 前后 · A/D 转向 · Q/E 平移');
  [...timers.values()].find(timer=>timer.delay===9000).fn();assert.equal(elements.get('view-status').textContent,'');
  events.message(cameraPlaced);assert.equal(elements.get('view-status').textContent,'','The brief camera hint appears only once');
  assert.equal(elements.get('act-list').querySelectorAll()[0].scrollOptions.inline,'center','Current chapter is centred rather than merely visible');
  assert.equal(elements.get('view-angle').disabled,false,'The default observer allows immediate angle changes');
  events.message({...cameraPlaced,data:{type:'flatland-story-toggle-view'}});assert.equal(values.perspective,100);assert.equal(elements.get('view-angle').value,100,'Keyboard view switching keeps the visible slider in sync');
  elements.get('view-resident').onclick();assert.equal(values.perspective,100);
  assert.equal(values.display,override?.state.view?.display??defaults.view.display,'Resident view preserves the story display setting');
  elements.get('view-angle').value=50;elements.get('view-angle').oninput();assert.equal(values.perspective,50);assert.equal(elements.get('view-angle-value').textContent,'45°');
  assert.equal(JSON.stringify(preset),saved,'The player never rewrites the saved preset');
  elements.get('play').onclick();assert.equal(elements.get('play-icon').src,'./icons/pause.svg');
  const autoHide=[...timers.values()].find(timer=>timer.delay===2500);assert(autoHide);autoHide.fn();
  assert(!elements.get('theatre').classList.classes.has('controls-visible'),'Playback hides inactive controls');
  elements.get('play').onclick();assert(elements.get('theatre').classList.classes.has('controls-visible'),'Pausing restores controls');
  elements.get('forward').onclick();
  assert.equal(elements.get('timeline').value,0,'Keep the outgoing chapter until it has faded to black');
  finishFade();assert.equal(elements.get('timeline').value,10,'Fast forward advances ten seconds without changing playback mode');
  events.keydown({code:'KeyW',target:{tagName:'MAIN'},preventDefault(){}});assert.deepEqual(keyCalls.at(-1),['KeyW',true]);
  events.keyup({code:'KeyW'});assert.deepEqual(keyCalls.at(-1),['KeyW',false]);
  events.blur();assert(cameraKeyRelease(keyCalls),'Leaving the player releases every held camera key');
  elements.get('upload-story').onclick();assert(elements.get('upload-prompt').value.includes('Fork'));assert(elements.get('upload-prompt').value.includes('完整 PR'));
  elements.get('act-list').children[1].children[0].onclick();
  assert.equal(elements.get('timeline').value,6,'A chapter click seeks to its start');
  assert.equal(elements.get('play').title,'播放','A chapter click preserves the paused state');
  const chapters=elements.get('act-list').children.map(item=>item.children[0]);
  chapters[2].onclick();finishFade();
  assert.equal(elements.get('timeline').value,12);assert.equal(raf,null,'A cross-chapter seek stays paused after its fade');
  assert.equal(elements.get('play-status').textContent,'已暂停');
  chapters[1].onclick();finishFade();elements.get('play').onclick();
  // A queued animation frame can predate a click or an animation's finish event.
  now+=20;raf(now-30);finishFade();
  assert.equal(elements.get('timeline').value,6.02,'A queued frame cannot rewind a freshly selected chapter');
  chapters[2].onclick();elements.get('play').onclick();finishFade();
  assert.equal(elements.get('timeline').value,12);assert.equal(elements.get('play-status').textContent,'已暂停','Pausing during a fade keeps the incoming chapter paused');
  chapters[0].onclick();const superseded=stage.animation;chapters[1].onclick();
  assert(superseded.cancelled&&superseded.onfinish===null,'A rapid chapter selection cannot apply a stale seek');
  finishFade();assert.equal(elements.get('timeline').value,6);assert.equal(stage.style.opacity,'1');
  assert.equal(raf,null,'Rapid chapter selections also preserve pause');elements.get('play').onclick();
  now+=20;raf(now-30);finishFade();
  assert.equal(elements.get('timeline').value,6.02,'Playback uses elapsed wall time after the fade, never an older frame timestamp');
  elements.get('timeline').value=7;elements.get('timeline').oninput();
  assert(stage.animation.cancelled,'Seeking inside the same chapter does not add a transition');
  elements.get('timeline').value=5.9;elements.get('timeline').oninput();finishFade();elements.get('play').onclick();
  now+=200;raf(now);assert.equal(elements.get('timeline').value,5.9,'Automatic chapter boundaries fade the outgoing picture first');
  now+=500;raf(now);assert.equal(elements.get('timeline').value,5.9,'The story clock holds throughout the transition');
  finishFade();assert(Math.abs(elements.get('timeline').value-6.1)<1e-9,'Fade time does not skip incoming story actions');
  elements.get('replay').onclick();finishFade();assert.equal(elements.get('timeline').value,0,'Replay fades back to the opening');
  const speed=elements.get('speed');speed.onclick();
  assert.equal(speed.textContent,'3×');assert.match(speed['aria-label'],/播放速度 3 倍/);
  assert.equal(elements.get('timeline').value,0,'Changing speed does not seek');
  now+=1000;raf(now-10);assert.equal(elements.get('timeline').value,3,'One wall second advances three story seconds');
  chapters[1].onclick();const outgoing=stage.animation;
  assert.equal(outgoing.playbackRate,3,'New fades use the current speed');
  speed.onclick();assert.equal(speed.textContent,'1×');
  assert.equal(stage.animation,outgoing);assert(!outgoing.cancelled,'Changing speed keeps the active fade continuous');
  assert.equal(outgoing.playbackRate,1,'An active fade immediately follows a speed change');
  outgoing.onfinish();const incoming=stage.animation,title=elements.get('chapter-transition').animation;
  assert.equal(incoming.playbackRate,1);assert.equal(title.playbackRate,1);
  speed.onclick();assert.equal(stage.animation,incoming);
  assert.equal(incoming.playbackRate,3);assert.equal(title.playbackRate,3,'The chapter title follows the same speed');
  finishFade();now+=1000;raf(now-10);assert.equal(elements.get('timeline').value,9);
  speed.onclick();now+=1000;raf(now);assert.equal(elements.get('timeline').value,10,'Returning to 1x restores normal playback');
  elements.get('play').onclick();speed.onclick();
  assert.equal(elements.get('play-status').textContent,'已暂停');assert.equal(raf,null,'Changing speed while paused stays paused');
  assert.equal(elements.get('timeline').value,10);
  elements.get('replay').onclick();finishFade();assert.equal(elements.get('timeline').value,0,'Replay works at 3x');
  now+=1000;raf(now);assert.equal(elements.get('timeline').value,3,'Replay preserves the chosen speed');
  reduced.matches=true;chapters[2].onclick();assert.equal(elements.get('timeline').value,12,'Reduced motion switches chapters immediately');
  now+=3000;raf(now);assert.equal(elements.get('timeline').value,18,'Accelerated playback clamps to the story end');
  assert.equal(elements.get('play-status').textContent,'播放结束');assert.equal(raf,null);
  chapters[0].onclick();assert.equal(elements.get('timeline').value,0);assert.equal(raf,null,'Selecting a chapter after ending does not start playback');
  const pausedTime=elements.get('timeline').value;
  elements.get('stretch-height').onclick();assert.equal(values.perspective,100);assert.equal(values.display,'line');
  assert.equal(elements.get('height-panel').hidden,false);
  elements.get('story-window-height').value=37;elements.get('story-window-height').oninput();
  assert.equal(values['resident-window'],37);assert.equal(elements.get('stretch-height').textContent,'37%');
  assert.equal(helpStorage.get('flatland-story-window-height-v1'),'37','Height is stored separately from playground settings');
  elements.get('stretch-full').onclick();assert.equal(values.display,'expanded');assert.equal(values['resident-window'],37,'Full height preserves the saved percentage');
  elements.get('stretch-height').onclick();assert.equal(values.display,'line');assert.equal(values['resident-window'],37,'The percentage button restores the saved height');
  elements.get('show-color').onclick();assert.equal(values.storyColorVisible,false);assert.equal(elements.get('show-color')['aria-pressed'],false);
  assert.equal(elements.get('timeline').value,pausedTime);assert.equal(raf,null,'Display controls do not change time or resume playback');
  chapters[1].onclick();assert.equal(values.storyColorVisible,false,'Colour visibility survives chapter changes');
  assert.equal(values['resident-window'],37);
  elements.get('play').onclick();elements.get('stretch-full').onclick();elements.get('show-color').onclick();
  assert.equal(values.storyColorVisible,true);assert.equal(elements.get('play-status').textContent,'播放中','Display controls preserve playback too');
  elements.get('play').onclick();
  reduced.matches=false;chapters[0].onclick();events.pagehide();
  assert(stage.animation.cancelled&&stage.animation.onfinish===null);assert.equal(stage.style.opacity,'1','Leaving the player clears the fade');
  assert.equal(presetReads,0,'Stories never read the playground preset');
  assert.equal(presetWrites,0,'Stories never write the playground preset');
  return configured;
}
const adopted=await playerSettings();
assert.equal(adopted['field-angle'],defaults.view.fieldAngle);assert.equal(adopted['resident-window'],defaults.view.windowHeight);assert.equal(adopted.projection,defaults.view.projection);assert.equal(adopted['paint-style'],defaults.shared.paintStyle);
const override=structuredClone(preset);override.state.view.fieldAngle=80;override.state.view.windowHeight=23;
const overridden=await playerSettings(override);assert.equal(overridden['field-angle'],80);assert.equal(overridden['resident-window'],23);
assert.equal((await playerSettings(undefined,'37'))['resident-window'],37,'A fresh player restores the saved percentage');
assert.equal((await playerSettings(undefined,'invalid'))['resident-window'],defaults.view.windowHeight,'Invalid saved height falls back to the story setting');
console.log('Story workflow: independent settings, monotonic chapter playback, 1x/3x speed and fades, pause/rapid seek/replay/reduced motion, observer controls, upload guidance and dirty-story detection passed.');

const partial={version:1,state:{view:{fieldAngle:80},shared:{coloring:false,exposure:24}}};
const mergedPreset=readPreset(partial);
assert.equal(mergedPreset.view.fieldAngle,80);assert.equal(mergedPreset.view.windowHeight,defaults.view.windowHeight);assert.equal(mergedPreset.view.projection,defaults.view.projection);
assert.equal(mergedPreset.shared.coloring,false);assert.equal(mergedPreset.shared.paintStyle,defaults.shared.paintStyle);assert.equal(mergedPreset.shared.scatterEnabled,true);
assert.equal(mergedPreset.shared.scatterDistance,128);assert.equal(mergedPreset.shared.exposure,24);
assert.deepEqual(partial,{version:1,state:{view:{fieldAngle:80},shared:{coloring:false,exposure:24}}},'Partial input is not mutated by migration');
assert.throws(()=>readPreset({version:1,state:{view:{fieldAngle:null}}}),/Invalid type/);
assert.throws(()=>readPreset({version:1,state:{shared:null}}),/Invalid configuration group/);
const partialValues=await playerSettings(partial);
assert.equal(partialValues['field-angle'],80);assert.equal(partialValues['resident-window'],defaults.view.windowHeight);assert.equal(partialValues['paint-style'],defaults.shared.paintStyle);assert.equal(partialValues.coloring,false);
const colourSettings=JSON.parse(await readFile(new URL('../stories/story-fba5ed6e-6a79-44cd-88f4-918faab57dd7/settings.json',import.meta.url),'utf8'));
for(const group of ['shared','view'])for(const key of Object.keys(defaults[group]))assert(Object.hasOwn(colourSettings.state[group],key),`The Colour Revolution freezes its own ${group}.${key}`);
const fixedValues=await playerSettings(colourSettings);
assert.equal(fixedValues['paint-style'],'dufy');assert.equal(fixedValues['field-angle'],160);assert.equal(fixedValues['resident-window'],1);assert.equal(fixedValues.exposure,24);assert.equal(fixedValues.scatterDistance,128);
console.log('Story settings: partial values use built-in defaults; the Colour Revolution freezes every visual setting and ignores the playground.');

const cameraWorld=await createSimulation({layout:'parade',scripted:true});cameraWorld.setScriptActors(story.actors,story.observer);cameraWorld.applyScriptFrame(first);
const castBefore=cameraWorld.entities.filter(e=>e.storyId).map(e=>({...e.body.translation()})),eyeBefore={...cameraWorld.player.body.translation()};
for(let i=0;i<60;i++)cameraWorld.step({forward:1});
assert(Math.hypot(cameraWorld.player.body.translation().x-eyeBefore.x,cameraWorld.player.body.translation().y-eyeBefore.y)>.9,'W/S moves the observer while the story is paused');
const angleBefore=cameraWorld.player.body.rotation();for(let i=0;i<60;i++)cameraWorld.step({turn:1});
assert(Math.abs(cameraWorld.player.body.rotation()-angleBefore)>1,'A/D turns the camera');
const beforeStrafe={...cameraWorld.player.body.translation()};for(let i=0;i<60;i++)cameraWorld.step({side:1});
assert(Math.hypot(cameraWorld.player.body.translation().x-beforeStrafe.x,cameraWorld.player.body.translation().y-beforeStrafe.y)>.9,'Q/E strafes');
assert.deepEqual(cameraWorld.entities.filter(e=>e.storyId).map(e=>({...e.body.translation()})),castBefore,'Camera navigation never moves the cast');
const stopped={...cameraWorld.player.body.translation()};for(let i=0;i<30;i++)cameraWorld.step({});assert.deepEqual({...cameraWorld.player.body.translation()},stopped,'Releasing the keys stops immediately');cameraWorld.dispose();
console.log('Story camera: keyboard forwarding/release, free position and heading, stationary cast, and immediate stop passed.');

// Colour periods and authored cameras share the same Character instances.
const periods=compileStory({version:1,title:'Period controls',scene:'parade',actors:[
  {id:'soldier',type:'regular-12',position:[0,0],coloring:false},
  {id:'priest',type:'regular-32',position:[3,0],coloring:false},
],acts:[
  {title:'Before',duration:2,coloring:false,observer:{position:[0,-2],angle:90}},
  {title:'Colour',duration:4,coloring:true,observer:{follow:'soldier',offset:[0,-1],angle:90},actions:[
    {at:0,actor:'soldier',coloring:true,move:[4,0],duration:4},
    {at:2,actor:'priest',coloring:true},{at:3,actor:'priest',coloring:false}]},
  {title:'After',duration:2,coloring:false},
  {title:'Inherit',duration:2},
]});
rejects(d=>d.actors[0].type='regular-129',/type/);
rejects(d=>d.actors[0].type='regular-2',/type/);
rejects(d=>d.actors[0].coloring='true',/coloring/);
rejects(d=>d.acts[0].coloring=1,/coloring/);
rejects(d=>d.acts[0].observer={follow:'missing'},/找不到/);
rejects(d=>d.acts[0].observer={follow:'square',position:[0,0]},/只能选择/);
rejects(d=>d.acts[0].observer={position:[0,0],offset:[1,0]},/偏移/);
assert.equal(sampleStory(periods,0).coloring,false);
assert.equal(sampleStory(periods,2).coloring,true);
assert.equal(sampleStory(periods,6).coloring,false);
assert.equal(sampleStory(periods,8).coloring,undefined,'An unspecified act uses the story base colouring');
assert.deepEqual(sampleStory(periods,4).observer,{position:[2,-1],angle:90},'The observer follows the sampled actor');
const periodWorld=await createSimulation({layout:'parade',scripted:true});periodWorld.setScriptActors(periods.actors,undefined,'neon');
const soldier=periodWorld.entities.find(e=>e.storyId==='soldier'),priest=periodWorld.entities.find(e=>e.storyId==='priest');
assert.equal(soldier.vertices.length,12);assert.equal(priest.vertices.length,32);
const originalPaint=[...soldier.storyBasePaint.edgeColors];
periodWorld.applyScriptFrame(sampleStory(periods,0));assert.deepEqual(soldier.edgeColors,['#ffffff']);
periodWorld.applyScriptFrame(sampleStory(periods,3));assert.deepEqual(soldier.edgeColors,originalPaint);assert.deepEqual(priest.edgeColors,['#ffffff']);
periodWorld.applyScriptFrame(sampleStory(periods,4.5));assert.deepEqual(priest.edgeColors,priest.storyBasePaint.edgeColors);
periodWorld.applyScriptFrame(sampleStory(periods,5.5));assert.deepEqual(priest.edgeColors,['#ffffff']);
periodWorld.applyScriptFrame(sampleStory(periods,0));assert.deepEqual(soldier.edgeColors,['#ffffff']);
periodWorld.applyScriptFrame(sampleStory(periods,3));assert.deepEqual(soldier.edgeColors,originalPaint);periodWorld.dispose();
console.log('Story periods: polygon reuse, palette restoration, actor exceptions, act overrides, following camera, rewind and validation passed.');

// Nonlinear trajectories remain exact data; contacts are resolved by Character.
const curved=compileStory({version:1,title:'Curve',scene:'parade',actors:[{id:'a',type:'regular-4',position:[0,0]}],acts:[{title:'Walk',duration:4,actions:[{at:0,actor:'a',move:[4,0],via:[2,2],duration:4,easing:'smooth'}]}]});
assert.deepEqual(actor(sampleStory(curved,2),'a').position,[2,1]);
assert(actor(sampleStory(curved,1),'a').position[0]<1,'A smooth walk accelerates from rest');
rejects(d=>d.acts[0].collision='yes',/collision/);
rejects(d=>d.acts[0].actions=[{at:0,actor:'square',interaction:'explode'}],/interaction/);
rejects(d=>d.acts[0].actions=[{at:0,actor:'square',move:[1,0],duration:1,easing:'code'}],/easing/);
rejects(d=>d.acts[0].actions=[{at:0,actor:'square',turn:90,duration:1,via:[0,0]}],/需要 move/);
for(const interaction of ['touch','kill']){
  const physical=compileStory({version:1,title:'Contact',scene:'parade',actors:[
    {id:'attacker',type:'regular-5',position:[-2,0],angle:0},
    {id:'target',type:'regular-5',position:[0,0],angle:180},
  ],acts:[{title:'Approach',duration:4,collision:true,observer:{follow:'attacker',offset:[0,-1]},actions:[
    {at:0,actor:'attacker',interaction,move:[2,0],duration:4,easing:'smooth'},
  ]}]});
  const sim=await createSimulation({layout:'parade',scripted:true});sim.setScriptActors(physical.actors);
  let frame;for(let tick=0;tick<=240;tick++)frame=sim.seekScript(physical,tick/60);
  const a=actor(frame,'attacker'),b=actor(frame,'target');
  assert(a.collisions>0,'Moving story characters produce real collision events');
  assert.equal(b.state,interaction==='kill'?'dead':'alive');
  if(interaction==='touch')assert(a.position[0]<b.position[0],'Characters cannot pass through one another');
  else assert(b.deathAt>0&&b.deathAt<4,'Death is timed by actual contact');
  assert.deepEqual(frame.observer.position,[a.position[0],a.position[1]-1],'Camera follows the resolved body');
  const paused=structuredClone(frame);for(let i=0;i<60;i++)sim.step({});
  assert.deepEqual(sim.seekScript(physical,4),paused,'Pausing never advances physics or death time');
  sim.seekScript(physical,0);assert.equal(sim.entities.find(e=>e.storyId==='target').state,'alive');
  assert.deepEqual(sim.seekScript(physical,4),paused,'Direct seeking and replay produce identical contacts and poses');
  sim.dispose();
}
console.log('Story motion: curved easing, physical blocking, corner kills, pause, direct seek and deterministic replay passed.');

const patterns={version:1,title:'Generated cast',scene:'parade',seed:71,
  actors:[{id:'leader',type:'regular-5',position:[0,0],visible:false}],
  groups:[{id:'crowd',type:'regular-3',count:12,size:.7}],
  acts:[{title:'Walking',duration:6,cast:['leader','crowd'],collision:true,actions:[
    {at:0,actors:'crowd',scatter:{bounds:[-4,4,-4,4],gap:1}},
    {at:0,actors:'crowd',duration:6,wander:{radius:1,bounds:[-5,5,-5,5]}},
    {at:0,actor:'leader',move:[1,0],duration:6},
    {at:0,actors:'crowd',face:'leader',duration:6},
  ]},{title:'Sway',duration:4,cast:[{group:'crowd',count:2}],actions:[
    {at:0,actors:{group:'crowd',count:2},turn:0},
    {at:0,actors:{group:'crowd',count:2},duration:4,sway:{angle:12,period:2}},
  ]},{title:'Review',duration:4,cast:['crowd'],actions:[
    {at:0,actors:'crowd',fan:{rings:3,radius:10,gap:2,angles:[210,330]}},
    {at:0,actors:'crowd',turnBy:180,duration:1,stagger:{interval:.5,batch:4}},
  ]}]};
const generated=compileStory(patterns),same=compileStory(structuredClone(patterns));
assert.equal(generated.actors.length,13);
assert.deepEqual(sampleStory(generated,3),sampleStory(same,3),'A seed reproduces both layout and wandering');
assert.notDeepEqual(sampleStory(generated,3),sampleStory(compileStory({...patterns,seed:72}),3),'A different seed changes the generated routes');
const beginning=sampleStory(generated,0).actors.filter(a=>a.visible);
for(let i=0;i<beginning.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(...beginning[i].position.map((v,k)=>v-beginning[j].position[k]))>=1,'Scatter preserves spacing and excludes the named lead');
const swaying=sampleStory(generated,6.5);
assert.equal(swaying.actors.filter(a=>a.visible).length,2,'An act cast replaces the previous visible crowd');
assert.equal(actor(swaying,'crowd_1').angle,12);
assert.equal(actor(sampleStory(generated,7.5),'crowd_1').angle,-12);
assert.deepEqual(actor(swaying,'crowd_1').position,actor(sampleStory(generated,6),'crowd_1').position,'Sway never translates a body');
assert(Math.abs(Math.hypot(...actor(sampleStory(generated,10),'crowd_9').position)-14)<1e-8);
assert.equal(actor(sampleStory(generated,10.5),'crowd_1').angle,300);
assert.equal(actor(sampleStory(generated,10.5),'crowd_5').angle,210,'Turn waves start by row, rather than all at once');
const focused=await createSimulation({layout:'parade',scripted:true});focused.setScriptActors(generated.actors);
const focusFrame=focused.seekScript(generated,4),lead=actor(focusFrame,'leader');
for(const follower of focusFrame.actors.filter(a=>a.visible&&a.face)){
  const direction=Math.atan2(lead.position[1]-follower.position[1],lead.position[0]-follower.position[0]);
  assert(Math.cos(follower.angle*Math.PI/180-direction)>.96,'Residents turn toward the leader’s actual body while walking');
}
focused.dispose();
const swayTurn=compileStory({version:1,title:'Turn after sway',scene:'parade',actors:[{id:'a',type:'regular-3',position:[0,0]}],acts:[{title:'Turn',duration:2,actions:[
  {at:0,actor:'a',sway:{angle:12,period:4},duration:1},
  {at:1,actor:'a',turnBy:90,duration:1},
]}]});
assert.equal(actor(sampleStory(swayTurn,2),'a').angle,102,'Relative turns start at the previous sway endpoint');
function rejectPattern(change,pattern){const value=structuredClone(patterns);change(value);assert.throws(()=>compileStory(value),pattern);}
rejectPattern(d=>d.actors=[null],/需要对象/);
rejectPattern(d=>d.acts=null,/acts/);
rejectPattern(d=>d.acts[0].actions=[null],/需要对象/);
rejectPattern(d=>d.groups[0].count=2049,/2048/);
rejectPattern(d=>d.groups[0].count=1.5,/整数/);
rejectPattern(d=>d.seed=-1,/seed/);
rejectPattern(d=>d.acts[0].cast=['crowd','crowd_1'],/重复/);
rejectPattern(d=>d.acts[0].cast=[{group:'crowd',count:20}],/12/);
rejectPattern(d=>d.acts[0].actions[0].scatter.run='code',/未知字段/);
rejectPattern(d=>d.acts[0].actions[0].scatter.bounds=[0,.1,0,.1],/放不下/);
rejectPattern(d=>d.acts[0].actions[1].coloring=true,/未知字段/);
rejectPattern(d=>d.acts[0].actions[3].face='missing',/face/);
rejectPattern(d=>d.acts[0].actions[2]={at:0,actor:'leader',face:'leader',duration:1},/face/);
rejectPattern(d=>d.acts[1].actions[1].sway.period=0,/period/);
rejectPattern(d=>d.acts[2].actions[0].fan.rings=5,/每圈/);
rejectPattern(d=>{d.groups[0].count=24;d.acts=[{title:'Too many',duration:600,cast:'crowd',actions:[{at:0,actors:'crowd',duration:600,wander:{step:[.3,.3],pause:[0,0]}}]}];},/20000/);
console.log('Story rules: generated groups, seeded scatter/wandering, bounded expansion, row turns, moving focus and stationary sway passed.');
