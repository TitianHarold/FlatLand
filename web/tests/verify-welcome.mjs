import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as sequence from '../src/welcome-sequence.js';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from '../src/paint.js';
import {defaults,storageKey,readPreset} from '../src/studio-preset.js';

const {createEntranceStrokes,pointOnStroke,sampleWriter,sampleEntrance,ENTRANCE_DURATION,FADE_START,HOLD_START}=sequence;
assert(ENTRANCE_DURATION>=6000&&ENTRANCE_DURATION<=9000);
for(const compact of [false,true]){
  const {width,height,strokes}=createEntranceStrokes(compact);
  assert.equal(new Set(strokes.map(s=>s.id)).size,21,'Every stroke gets its own resident');
  assert.deepEqual(Array.from({length:8},(_,i)=>strokes.filter(s=>s.letterIndex===i).length),[3,2,3,2,2,3,3,3]);
  assert.equal(strokes.filter(s=>s.strokeIndex===0).map(s=>s.letter).join(''),'FLATLAND');
  for(const s of strokes){
    for(const p of [s.origin,...s.points])assert(p.x>8&&p.x<width-8&&p.y>8&&p.y<height-8,'Bodies and paths fit both layouts');
    const arrives=s.start+s.arrival,ends=arrives+s.duration;
    assert.deepEqual({x:sampleWriter(s,0).x,y:sampleWriter(s,0).y},s.origin);
    const waiting=sampleWriter(s,s.start),approaching=sampleWriter(s,s.start+s.arrival/2);
    assert(Math.hypot(waiting.x-approaching.x,waiting.y-approaching.y)>10,'The resident visibly travels before writing');
    assert.equal(approaching.ink,0,'Arrival does not leave stray ink');
    let previous=0;
    for(let time=0;time<=ENTRANCE_DURATION;time+=41){
      const writer=sampleWriter(s,time);assert(writer.ink>=previous,'Ink never disappears');previous=writer.ink;
      if(writer.ink>0){const tip=pointOnStroke(s,writer.ink);assert.equal(writer.x,tip.x);assert.equal(writer.y,tip.y);}
    }
    const a=sampleWriter(s,arrives+s.duration*.2),b=sampleWriter(s,arrives+s.duration*.8);
    assert(Math.hypot(a.x-b.x,a.y-b.y)>15,'The writing body visibly moves along its own trail');
    const final=sampleWriter(s,ends+1000),last=s.points.at(-1);
    assert.equal(final.ink,1);assert(Math.hypot(final.x-last.x,final.y-last.y)<1e-9);
    assert(ends<HOLD_START,'All residents finish before the completed title hold');
  }
  assert(strokes.filter(s=>s.letter==='D').slice(1).every(s=>s.points.length>10),'D uses actual curved trajectories');
}
assert.equal(sampleEntrance(FADE_START).opacity,1);
assert(FADE_START-HOLD_START>=1000,'The completed title holds for at least one second');
assert.equal(sampleEntrance(ENTRANCE_DURATION-1).complete,false);
assert.equal(sampleEntrance(ENTRANCE_DURATION).complete,true);
assert.equal(sampleEntrance(ENTRANCE_DURATION).opacity,0);

// Run the page controller with a deterministic frame clock and a minimal DOM.
// This exercises event ordering, cancellation and resume without a test dependency.
const copySource=(await readFile(new URL('../src/copy-prompt.js',import.meta.url),'utf8')).replace('export function','function');
const source=copySource+'\n'+(await readFile(new URL('../src/welcome.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const html=await readFile(new URL('../welcome.html',import.meta.url),'utf8');
function page({hash='',reduced=false,catalogue=[],canvas=true,clipboard=true,legacyCopy=false,preset}={}){
  const element=()=>({hidden:false,inert:false,style:{setProperty(k,v){this[k]=v;}},children:[],events:{},classList:{add(){},remove(){}},
    append(...children){this.children.push(...children);},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this[name]=value;},focus(){this.focused=true;},select(){this.selected=true;},
    showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {width:920};}});
  const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],element()]));
  ids.set('meta[name="theme-color"]',element());
  ids.get('#creation-prompt').value=html.match(/<textarea id="creation-prompt"[^>]*>([\s\S]*?)<\/textarea>/)[1];
  const context2d=new Proxy({}, {get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  ids.get('#entrance-canvas').getContext=()=>canvas?context2d:null;
  const document={...element(),hidden:false,body:element(),querySelector:s=>ids.get(s),createElement:element,execCommand:()=>legacyCopy};
  const copied=[];
  const navigator={clipboard:clipboard?{async writeText(text){copied.push(text);}}:{async writeText(){throw new Error('Clipboard unavailable');}}};
  const window=element(),motion={...element(),matches:reduced},compact={...element(),matches:false};
  const location={hash,pathname:'/welcome.html',search:''},pending=new Map();let id=0;
  const sandbox={...sequence,PAINT_STYLES,DEFAULT_PAINT_STYLE,defaults,storageKey,readPreset,catalogue,document,window,location,navigator,
    localStorage:{getItem:()=>preset?JSON.stringify(preset):null},
    matchMedia:query=>query.includes('reduced')?motion:compact,devicePixelRatio:1,
    history:{replaceState(_,__,url){location.hash=url.includes('#')?'#'+url.split('#')[1]:'';}},
    ResizeObserver:class{observe(){}},
    requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:id=>pending.delete(id),
  };
  vm.runInNewContext(source,sandbox);
  return {ids,document,window,motion,location,pending,copied,context2d,
    step(time){const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn(time));},
    click(selector){return ids.get(selector).events.click({preventDefault(){}});},
  };
}
const p=page();
assert.equal(p.ids.get('#stories').hidden,true);assert.equal(p.pending.size,1);
p.step(0);p.step(2800);
p.document.hidden=true;p.document.events.visibilitychange();assert.equal(p.pending.size,0,'Backgrounding cancels animation');
p.document.hidden=false;p.document.events.visibilitychange();p.step(12000);
assert.equal(p.ids.get('#stories').hidden,true,'Hidden wall time does not skip the animation');
p.step(15200);assert.equal(p.ids.get('#stories').hidden,true);
p.step(17200);assert.equal(p.ids.get('#stories').hidden,false);assert.equal(p.pending.size,0);
assert.equal(p.location.hash,'#stories');assert(p.ids.get('#stories-title').focused,'Completion moves focus into the story page');
p.click('#replay-entrance');p.step(20000);p.step(21000);
assert.equal(p.ids.get('#entrance').style.opacity,1,'Replay restores the entrance');
p.window.events.pagehide();assert.equal(p.pending.size,0,'Leaving the page cancels its frame');
p.window.events.pageshow();assert.equal(p.pending.size,1,'Back-forward cache restore can resume');
p.click('#skip-entrance');assert.equal(p.pending.size,0);assert.equal(p.ids.get('#stories').hidden,false);
p.click('#replay-entrance');p.motion.matches=true;p.motion.events.change();
assert.equal(p.pending.size,0);assert.equal(p.ids.get('#stories').hidden,false,'Live reduced-motion preference finishes the intro');
for(const options of [{hash:'#stories'},{reduced:true},{canvas:false}]){
  const direct=page(options);assert.equal(direct.pending.size,0);assert.equal(direct.ids.get('#stories').hidden,false);
}
const empty=page({hash:'#stories',catalogue:[]});assert.equal(empty.ids.get('#story-list').hidden,true);assert.equal(empty.ids.get('#story-empty').hidden,false);
const fixture=page({hash:'#stories',catalogue:[{id:'one & 二',title:'<b>A story</b>',description:'A published story',source:'/story.json'}]});
const card=fixture.ids.get('#story-list').children[0];
assert.equal(card.href,'./storyboard.html?story=one%20%26%20%E4%BA%8C');
assert.equal(card.children[0].textContent,'<b>A story</b>','Catalogue text is inserted as text, never markup');
assert.equal(fixture.ids.get('#story-empty').hidden,true);
assert.equal(empty.ids.get('#create-story').hidden,true);
assert.equal(empty.ids.get('#creation-dialog').children.length,0,'Empty catalogue shows the prompt inline');
assert.equal(fixture.ids.get('#create-story').hidden,false);
assert.equal(fixture.ids.get('#creation-dialog').children[0],fixture.ids.get('#creation-panel'),'The same prompt moves into the dialog when stories exist');
fixture.click('#create-story');assert.equal(fixture.ids.get('#creation-dialog').open,true);
fixture.click('#close-prompt');assert.equal(fixture.ids.get('#creation-dialog').open,false);
assert(html.includes('https://github.com/TitianHarold/FlatLand')&&html.includes('AGENTS.md')&&html.includes('故事创作模式'));
assert(html.includes('href="./studio.html"'),'The scene workspace remains available for live visual checks');
const copyPage=page({hash:'#stories'});
await copyPage.click('#copy-prompt');
assert.equal(copyPage.copied[0],copyPage.ids.get('#creation-prompt').value,'Copy includes the repository and the exact displayed prompt');
assert.equal(copyPage.ids.get('#copy-prompt').textContent,'已复制');
for(const legacyCopy of [false,true]){
  const fallback=page({hash:'#stories',clipboard:false,legacyCopy});await fallback.click('#copy-prompt');
  assert.equal(fallback.ids.get('#creation-prompt').selected,true);
  assert.equal(fallback.ids.get('#copy-prompt').textContent,legacyCopy?'已复制':'复制');
  if(!legacyCopy)assert(fallback.ids.get('#copy-status').textContent.includes('手动复制'),'Denied clipboard access is never reported as successful');
}
const catalogueSource=(await readFile(new URL('../src/story-catalog.js',import.meta.url),'utf8')).replaceAll('import.meta.glob','glob').replace('export const stories=','const stories=');
const documents={'../stories/first-story/story.json':{title:'First story',description:'Test only'},'../stories/examples/story.json':{title:'Example'},'../stories/technical-demo/story.json':{title:'Demo',example:true}};
const discovered=vm.runInNewContext(catalogueSource+'\nstories',{
  glob(pattern,options){if(pattern.includes('settings.json')||pattern.includes('assets/cover.'))return {};assert.equal(pattern,'../stories/*/story.json');return options.query==='?url'?Object.fromEntries(Object.keys(documents).map(path=>[path,'/FlatLand/assets/first-story.json'])):documents;},
});
assert.equal(discovered.length,1);assert.equal(discovered[0].id,'first-story');
assert.equal(discovered[0].source,'/FlatLand/assets/first-story.json','Story sources use bundled URLs');
console.log('Welcome: 21 moving writers; retained strokes; 8 s timing and hold; both layouts; skip/replay; hidden/pagehide pause; reduced motion; catalogue and navigation passed.');

const preferred={version:1,state:structuredClone(defaults)};preferred.state.shared.paintStyle='neon';preferred.state.shared.coloring=true;
const palettePage=page({preset:preferred});
assert.equal(palettePage.ids.get('#stories').style['--resident-gold'],PAINT_STYLES.neon.colors[0]);
assert(PAINT_STYLES.neon.colors.includes(palettePage.context2d.strokeStyle),'The entrance uses the saved palette');
preferred.state.shared.coloring=false;palettePage.window.events.storage({key:storageKey});
assert.equal(palettePage.context2d.strokeStyle,'#bcbcbc','Live studio changes remove entrance colour');
assert.equal(palettePage.ids.get('#stories').style['--resident-gold'],'#bcbcbc','Empty-state residents also become colourless');
preferred.state.shared.coloring=true;preferred.state.shared.paintStyle='custom';preferred.state.shared.customPaint={colors:['#112233','#334455','#556677','#778899','#99aabb']};
palettePage.window.events.pageshow();assert.equal(palettePage.ids.get('#stories').style['--resident-blue'],'#334455');
console.log('Welcome palette: saved scheme, live colourless mode, custom palette and page restore passed.');
