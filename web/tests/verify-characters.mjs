import assert from 'node:assert/strict';
import {Character,characterTypes,RAPIER,MIN_SIZE,MAX_SIZE} from '../src/characters.js';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE,setPaintMode,setWallColor} from '../src/paint.js';

await RAPIER.init();
for(const [paintStyle,style] of Object.entries(PAINT_STYLES))for(let paintVariant=0;paintVariant<style.residents.length;paintVariant++)
for(const type of characterTypes)for(const size of [MIN_SIZE,.5,MAX_SIZE]){
  const character=new Character('size',type,{size,paintStyle,paintVariant});
  for(const vertex of character.vertices)assert(Math.abs(Math.hypot(vertex.x,vertex.y)-size/2)<1e-10,'All shapes use the same size circle');
  const vertices=character.vertices,edges=character.paintedEdges,isLine=character.sides===null;
  assert.equal(edges.length,isLine?2:vertices.length,'Paint covers every body edge, or the two halves of a woman');
  const perimeter=vertices.reduce((sum,a,i)=>sum+Math.hypot(a.x-vertices[(i+1)%vertices.length].x,a.y-vertices[(i+1)%vertices.length].y),0)/(isLine?2:1);
  assert(Math.abs(edges.reduce((sum,{a,b})=>sum+Math.hypot(a.x-b.x,a.y-b.y),0)-perimeter)<1e-10,'Painted segments cover the original boundary exactly once');
  for(let i=0;i<edges.length-1;i++)assert.deepEqual(edges[i].b,edges[i+1].a,'Paint segments join without gaps');
  if(isLine){assert.deepEqual(edges[0].a,character.tail);assert.deepEqual(edges[1].b,character.head);}
  else assert.deepEqual(edges.at(-1).b,edges[0].a,'Polygon paint closes the outline');
  if(style.pattern==='directional'){
    const ordered=[...edges].sort((a,b)=>(a.a.x+a.b.x)-(b.a.x+b.b.x));
    assert.equal(ordered[0].color,'#4D4D4D');assert.equal(ordered.at(-1).color,'#FFFFFF');
  }else assert(edges.every(edge=>edge.color===style.colors[paintVariant]),'Solid theme mode uses one key colour per resident');
  const mirrored=(a,b)=>Math.hypot(a.x-b.x,a.y+b.y)<1e-10;
  for(const edge of edges){
    const opposite=edges.find(other=>(mirrored(edge.a,other.a)&&mirrored(edge.b,other.b))||(mirrored(edge.a,other.b)&&mirrored(edge.b,other.a)));
    assert(opposite&&opposite.color===edge.color,'Matching edges on both sides of the head axis have the same color');
  }
  edges[0].a.x=99;
  assert.deepEqual(character.vertices,vertices,'Rendering data cannot alter canonical collision geometry');
}
const stable=new Character('theme-check',characterTypes[4]);
const solidEdges=stable.paintedEdges,shapeBefore=stable.vertices,variantBefore=stable.paintVariant;
setPaintMode('mixed');stable.setPaintStyle(DEFAULT_PAINT_STYLE);
assert(new Set(stable.paintedEdges.map(e=>e.color)).size>1,'Mixed mode combines the theme keys');
assert(stable.paintedEdges.every(e=>PAINT_STYLES.dufy.colors.includes(e.color)),'Random combinations only use the selected theme colours');
assert.deepEqual(stable.vertices,shapeBefore);assert.equal(stable.paintVariant,variantBefore);
setPaintMode('solid');stable.setPaintStyle(DEFAULT_PAINT_STYLE);
assert.deepEqual(stable.paintedEdges,solidEdges,'Returning from mixed mode restores the same colour without rerandomizing');
setWallColor('#817a89');
assert(Object.values(PAINT_STYLES).every(p=>p.wall==='#817a89'),'Buildings keep one independent colour across every preset');
assert(new Character('monochrome',characterTypes[4],{color:'#cc7733'}).paintedEdges.every(e=>e.color==='#cc7733'),'Explicit single-color overrides still work');
const personal=new Character('resident-0',characterTypes[4]),other=new Character('resident-1',characterTypes[4]);
const personalPaint=personal.paintedEdges,variant=personal.paintVariant;
assert.notDeepEqual(personalPaint,other.paintedEdges,'Different residents can have different colors within one style');
assert.deepEqual(personalPaint,new Character('resident-0',characterTypes[4]).paintedEdges,'An instance ID always gets the same initial paint');
for(const id of Object.keys(PAINT_STYLES))personal.setPaintStyle(id);
personal.setPaintStyle(DEFAULT_PAINT_STYLE);
assert.equal(personal.paintVariant,variant);assert.deepEqual(personal.paintedEdges,personalPaint,'A style round trip restores the same personal paint');
assert.throws(()=>personal.setPaintStyle('missing'),RangeError);
assert.equal(personal.paintStyle,DEFAULT_PAINT_STYLE,'Invalid styles leave current paint intact');
assert.throws(()=>new Character('invalid-variant',characterTypes[0],{paintVariant:-1}),RangeError);
for(const size of [.29,1.01,NaN])assert.throws(()=>new Character('invalid',characterTypes[0],{size}),RangeError);
assert.throws(()=>new Character('invalid-mode',characterTypes[0]).setInteraction('unknown'),RangeError);

function scene(active=0,reverseCallbacks=false,specs=[{type:characterTypes[0],pose:{x:-1}},{type:characterTypes[4],pose:{x:1,angle:Math.PI}}]){
  const world=new RAPIER.World({x:0,y:0}),events=new RAPIER.EventQueue(true);
  world.timestep=1/60;world.integrationParameters.numSolverIterations=8;world.integrationParameters.maxCcdSubsteps=4;
  const actors=specs.map((spec,i)=>new Character(String(i),spec.type).attach(world,spec.pose));
  const actor=actors[active],target=actors[1-active];
  return {world,actor,target,step(input={}){
    actor.move(input);world.step(events);
    events.drainCollisionEvents((a,b,started)=>{
      let first=actors.find(c=>c.collider.handle===a),second=actors.find(c=>c.collider.handle===b);
      if(reverseCallbacks)[first,second]=[second,first];
      const initiator=input.forward||input.side||input.turn?actor:null;
      first.onCollision(second,started,initiator);second.onCollision(first,started,initiator);
    });
  },dispose(){world.free();events.free();}};
}

const movement=scene(),woman=movement.actor;
for(let i=0;i<60;i++)movement.step();
assert.equal(woman.body.translation().x,-1,'No autonomous movement');
assert.equal(woman.collider.shape.type,RAPIER.ShapeType.Segment);
assert.equal(woman.head.x-woman.tail.x,1);
woman.body.setRotation(Math.PI/2,true);woman.move({forward:1});
assert(Math.abs(woman.body.linvel().x)<1e-6&&woman.body.linvel().y>.7,'Forward follows the head');
woman.move({forward:-1});assert(woman.body.linvel().y<-.7);
woman.move({side:1});assert(woman.body.linvel().x<-.7&&Math.abs(woman.body.linvel().y)<1e-6,'Left strafe follows a north-facing head');
woman.move({side:-1});assert(woman.body.linvel().x>.7,'Right strafe follows a north-facing head');
woman.move({forward:1,side:1});assert(Math.abs(Math.hypot(woman.body.linvel().x,woman.body.linvel().y)-.8)<1e-6,'Diagonal movement must not be faster');
const paintState=()=>({body:woman.body.handle,collider:woman.collider.handle,position:{...woman.body.translation()},angle:woman.body.rotation(),velocity:{...woman.body.linvel()},angular:woman.body.angvel(),state:woman.state,interaction:woman.interaction});
const beforePaint=paintState();
for(const id of Object.keys(PAINT_STYLES))woman.setPaintStyle(id);
assert.deepEqual(paintState(),beforePaint,'Changing styles preserves identity, physics, movement and lifecycle');
const before={...woman.body.translation()};movement.step({turn:1});
assert.deepEqual({...woman.body.translation()},before,'Turning does not translate');
movement.dispose();

for(const active of [0,1])for(const reverse of [false,true]){
  const s=scene(active,reverse);
  s.actor.setInteraction('kill');assert.equal(s.target.state,'alive','Selecting kill alone has no effect');
  for(let i=0;i<200&&s.target.state!=='dead';i++)s.step({forward:1});
  assert.equal(s.actor.state,'alive','The initiator survives, including when the target has kill selected');
  assert.equal(s.target.state,'dead','Only the struck character dies');
  assert.equal(s.target.deathCause,'killed');assert.equal(s.target.body.isEnabled(),false);
  assert.equal(s.actor.contacts.size,0);assert.equal(s.actor.collisionCount,1);assert.equal(s.target.collisionCount,1);
  const deathPosition={...s.target.body.translation()};
  s.target.injure();s.target.move({forward:1,turn:1});
  for(let i=0;i<30;i++)s.step();
  assert.equal(s.target.state,'dead');assert.deepEqual({...s.target.body.translation()},deathPosition);
  s.dispose();
}

for(const active of [0,1]){
  const s=scene(active,true);s.actor.setInteraction('touch');
  for(let i=0;i<200&&s.actor.contacts.size===0;i++)s.step({forward:1});
  assert(s.actor.contacts.has(s.target),'Touch must reach an actual collision');
  const touched={...s.target.body.translation()},stopped={...s.actor.body.translation()};
  for(let i=0;i<180;i++)s.step({forward:1});
  assert.equal(s.actor.state,'alive');assert.equal(s.target.state,'alive');
  assert(Math.hypot(s.target.body.translation().x-touched.x,s.target.body.translation().y-touched.y)<.001,'Holding touch must not keep pushing the target');
  assert(Math.hypot(s.actor.body.translation().x-stopped.x,s.actor.body.translation().y-stopped.y)<.001,'Holding touch must stop at contact');
  if(active===0){
    s.actor.setInteraction('kill');s.step();
    assert.equal(s.target.state,'alive','Changing mode while touching waits for a new movement');
    s.step({forward:1});assert.equal(s.target.state,'dead');assert.equal(s.actor.state,'alive');
  }else{
    for(let i=0;i<60;i++)s.step({forward:-1});
    assert.equal(s.actor.contacts.size,0,'Retreat releases touch');
    assert.equal(s.actor.state,'alive');assert.equal(s.target.state,'alive');
  }
  s.dispose();
}
const boundary=new Character('boundary-check',characterTypes[3]);
boundary.onCollision({},true,boundary);assert.equal(boundary.state,'alive','Boundaries cannot be killed');

const line=characterTypes[0],square=characterTypes[3],pentagon=characterTypes[4];
const cases=[
  {name:'line broadside against a target vertex',specs:[{type:line,pose:{x:0,y:-1}},{type:pentagon,pose:{x:0,y:1,angle:-Math.PI/2}}],input:{side:1},killed:false},
  {name:'polygon side against a target vertex',specs:[{type:square,pose:{x:0,y:-1,angle:Math.PI/4}},{type:pentagon,pose:{x:0,y:1,angle:-Math.PI/2}}],input:{forward:1,side:1},killed:false},
  {name:'two flat edges touching',specs:[{type:square,pose:{x:0,y:-1,angle:Math.PI/4}},{type:square,pose:{x:0,y:1,angle:Math.PI/4}}],input:{forward:1,side:1},killed:false},
  {name:'front endpoint against a flat edge',specs:[{type:line,pose:{x:-1}},{type:square,pose:{x:1,angle:Math.PI/4}}],input:{forward:1},killed:true},
  {name:'rear endpoint against a flat edge',specs:[{type:line,pose:{x:0}},{type:square,pose:{x:-1.5,angle:Math.PI/4}}],input:{forward:-1},killed:true},
  {name:'rotating polygon vertex sweeps into a line',specs:[{type:square,pose:{x:0}},{type:line,pose:{x:.7,y:.45}}],input:{turn:1},killed:true},
];
for(const test of cases){
  const s=scene(0,true,test.specs);
  for(let i=0;i<240&&s.target.state!=='dead';i++)s.step(test.input);
  assert(s.actor.collisionCount>0,`${test.name}: must reach physical contact`);
  assert.equal(s.target.state,test.killed?'dead':'alive',test.name);
  assert.equal(s.actor.state,'alive',`${test.name}: initiator survives`);
  s.dispose();
}
console.log('Character checks passed: sizes, heading/strafe, vertex vs side contact, front/rear endpoint and rotating strikes, initiator-only kill, touch and mode switching.');
