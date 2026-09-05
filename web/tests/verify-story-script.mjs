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
assert.throws(()=>parseStory(' '.repeat(STORY_LIMITS.bytes+1)),/512 KB/);
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
rejects(d=>d.actors=Array.from({length:129},(_,i)=>({...d.actors[0],id:`a${i}`})),/128/);
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
assert.equal(studio.entities.length,14,'Normal studio populations remain unchanged');
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
async function playerSettings(override){
  const values={},events={},timers=new Map();let timerId=0;
  const element=tag=>({tag,hidden:false,disabled:false,children:[],style:{setProperty(k,v){this[k]=v;}},classList:{classes:new Set(),add(c){this.classes.add(c);},remove(c){this.classes.delete(c);}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},focus(){},scrollIntoView(options){this.scrollOptions=options;},addEventListener(){},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    querySelector(){return this.heading??=element('h2');},querySelectorAll(){return this.children.flatMap(child=>child.tag==='button'?[child]:child.querySelectorAll());},
    showModal(){this.open=true;},close(){this.open=false;},animate(){return {cancel(){}};}});
  const elements=new Map([...playerHtml.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element('div')]));
  const keyCalls=[];
  const api={key(code,pressed){keyCalls.push([code,pressed]);},configure(v){Object.assign(values,v);},set(k,v){values[k]=v;},story:{load(){},seek(time){return sampleStory(story,time);}}};
  const document={getElementById:id=>elements.get(id),createElement:tag=>({...element(tag),...(tag==='iframe'?{contentWindow:{flatlandStudio:api}}:{})}),addEventListener(){}};
  const saved=JSON.stringify(preset),helpStorage=new Map();
  const sandbox={document,parseStory,stories:[],defaults,storageKey,readPreset,sharedSettings,bindPromptCopy(){},URLSearchParams,
    location:{search:'',hostname:'localhost',origin:'http://localhost:5173'},localStorage:{getItem(key){return key===storageKey?saved:helpStorage.get(key);},setItem(key,value){helpStorage.set(key,value);}},
    structuredClone,performance:{now:()=>0},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    addEventListener:(name,fn)=>events[name]=fn,fixtureText:source,override};
  await vm.runInNewContext(`(async()=>{${controller}\nstoryPreset=override;loadText(fixtureText,'test');})()`,sandbox);
  const frame=elements.get('world-frame').children[0];
  events.message({origin:sandbox.location.origin,source:frame.contentWindow,data:{type:'flatland-studio-ready'}});
  assert.equal(elements.get('stage-loading').hidden,true);
  const cameraPlaced={origin:sandbox.location.origin,source:frame.contentWindow,data:{type:'flatland-camera-placed'}};
  events.message(cameraPlaced);assert.equal(elements.get('view-status').textContent,'W/S 前后 · A/D 转向 · Q/E 平移');
  [...timers.values()].find(timer=>timer.delay===9000).fn();assert.equal(elements.get('view-status').textContent,'');
  events.message(cameraPlaced);assert.equal(elements.get('view-status').textContent,'','The brief camera hint appears only once');
  assert.equal(elements.get('act-list').querySelectorAll()[0].scrollOptions.inline,'center','Current chapter is centred rather than merely visible');
  assert.equal(elements.get('view-angle').disabled,false,'The default observer allows immediate angle changes');
  events.message({...cameraPlaced,data:{type:'flatland-story-toggle-view'}});assert.equal(values.perspective,100);assert.equal(elements.get('view-angle').value,100,'Keyboard view switching keeps the visible slider in sync');
  elements.get('view-resident').onclick();assert.equal(values.perspective,100);
  assert.equal(values.display,'expanded','Resident view never forces saved display back to line');
  elements.get('view-angle').value=50;elements.get('view-angle').oninput();assert.equal(values.perspective,50);assert.equal(elements.get('view-angle-value').textContent,'45°');
  assert.equal(JSON.stringify(preset),saved,'The player never rewrites the saved preset');
  elements.get('play').onclick();assert.equal(elements.get('play-icon').src,'./icons/pause.svg');
  const autoHide=[...timers.values()].find(timer=>timer.delay===2500);assert(autoHide);autoHide.fn();
  assert(!elements.get('theatre').classList.classes.has('controls-visible'),'Playback hides inactive controls');
  elements.get('play').onclick();assert(elements.get('theatre').classList.classes.has('controls-visible'),'Pausing restores controls');
  elements.get('forward').onclick();assert.equal(elements.get('timeline').value,10,'Fast forward advances ten seconds without changing playback mode');
  events.keydown({code:'KeyW',target:{tagName:'MAIN'},preventDefault(){}});assert.deepEqual(keyCalls.at(-1),['KeyW',true]);
  events.keyup({code:'KeyW'});assert.deepEqual(keyCalls.at(-1),['KeyW',false]);
  events.blur();assert(cameraKeyRelease(keyCalls),'Leaving the player releases every held camera key');
  elements.get('upload-story').onclick();assert(elements.get('upload-prompt').value.includes('Fork'));assert(elements.get('upload-prompt').value.includes('完整 PR'));
  return values;
}
const adopted=await playerSettings();
assert.equal(adopted['field-angle'],160);assert.equal(adopted['resident-window'],61);assert.equal(adopted.projection,'equidistant');assert.equal(adopted['paint-style'],'neon');
const override=structuredClone(preset);override.state.view.fieldAngle=80;override.state.view.windowHeight=23;
const overridden=await playerSettings(override);assert.equal(overridden['field-angle'],80);assert.equal(overridden['resident-window'],23);
console.log('Story workflow: preset export/inheritance/override, palette replay, default observer controls, auto-hide, upload guidance, and dirty-story detection passed.');

const partial={version:1,state:{view:{fieldAngle:80},shared:{coloring:false,exposure:24}}};
const mergedPreset=readPreset(partial,preset.state);
assert.equal(mergedPreset.view.fieldAngle,80);assert.equal(mergedPreset.view.windowHeight,61);assert.equal(mergedPreset.view.projection,'equidistant');
assert.equal(mergedPreset.shared.coloring,false);assert.equal(mergedPreset.shared.paintStyle,'neon');assert.equal(mergedPreset.shared.scatterEnabled,true);
assert.equal(mergedPreset.shared.scatterDistance,128);assert.equal(mergedPreset.shared.exposure,24);
assert.deepEqual(partial,{version:1,state:{view:{fieldAngle:80},shared:{coloring:false,exposure:24}}},'Partial input is not mutated by migration');
assert.throws(()=>readPreset({version:1,state:{view:{fieldAngle:null}}},preset.state),/Invalid type/);
assert.throws(()=>readPreset({version:1,state:{shared:null}},preset.state),/Invalid configuration group/);
const partialValues=await playerSettings(partial);
assert.equal(partialValues['field-angle'],80);assert.equal(partialValues['resident-window'],61);assert.equal(partialValues['paint-style'],'neon');assert.equal(partialValues.coloring,false);
console.log('Partial story settings: explicit fields override; omitted fields, false flags and separate optics settings retain their intended values.');

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
