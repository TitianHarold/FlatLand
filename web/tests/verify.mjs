import assert from 'node:assert/strict';
import {createSimulation,point,RAPIER} from '../src/world.js';
import {createSight,houseBoundaries,observerFor,sightDirection,setScenePaintStyle} from '../src/sight.js';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE,setCustomPaintStyle,setPaintMode,setWallColor} from '../src/paint.js';
import {Character,characterTypes,MIN_SIZE,MAX_SIZE} from '../src/characters.js';
import {projectScene,exposeRow,OPTICS_RULES,boundaryLighting,surfaceLight,exposeLight} from '../src/optics.js';
import {resident,makeCrowd,makeColorField,STUDY_SHAPES} from '../src/study-scene.js';

const idle={forward:0,side:0,turn:0};
const savedCustom=structuredClone(PAINT_STYLES.custom);
setCustomPaintStyle({wall:'#123456',residents:Array.from({length:3},()=>['#abcdef','#123456','#fedcba'])});
assert.equal(new Character('custom',characterTypes[3],{paintStyle:'custom',paintVariant:0}).paintedEdges[0].color,'#abcdef');
for(const invalid of [null,{wall:'red',residents:savedCustom.residents},{wall:'#123456',residents:[['#abcdef']]}])assert.throws(()=>setCustomPaintStyle(invalid));
setCustomPaintStyle({pattern:'directional',colors:['#eeeeee','#999999','#333333']});
assert.deepEqual(PAINT_STYLES.custom.residents,[['#eeeeee','#999999','#333333']]);
assert(makeColorField({paintStyle:'grayscale'}).every(body=>body.vertices.length>=2),'The standalone colour-field fixture supports the directional gray scheme');
setCustomPaintStyle(savedCustom);
{
const maskScene=await createSimulation({layout:'mask'});
assert.equal(maskScene.walls.length,0,'The mask fixture has no walls');
assert.equal(maskScene.entities.length,997,'996 samples plus the observer');
assert.equal(maskScene.wandering,false);
const samples=maskScene.entities.filter(e=>e!==maskScene.player);
const starts=samples.map(e=>({...e.body.translation()}));
const rings=new Map();
for(const [i,e] of samples.entries()){
  const radius=Math.hypot(starts[i].x,starts[i].y),ring=Math.round(radius/5);
  assert(Math.abs(radius-ring*5)<2e-5&&ring>=1&&ring<=40,'Samples are on five-unit concentric circles');
  rings.set(ring,(rings.get(ring)??0)+1);
  assert.equal(e.typeId,'regular-5');assert.equal(e.size,.65);assert.equal(e.paintVariant,0);
}
assert.equal(rings.size,40);
assert.equal(rings.get(1),6);assert.equal(rings.get(20),24);assert.equal(rings.get(40),48);
assert([...rings.values()].every((count,i,a)=>i===0||count>=a[i-1]),'Counts grow with radius');
assert(2*5*Math.sin(Math.PI/6)-.65>4,'Inner ring leaves gaps wider than four body lengths');
const maskRules={...OPTICS_RULES,fog:0,attenuationDistance:0,glow:false,contour:0};
const nearOnly=createSight({...maskScene,entities:maskScene.entities.filter(e=>e===maskScene.player||Math.hypot(e.body.translation().x,e.body.translation().y)<6)})(1024,maskRules);
const allRings=createSight(maskScene)(1024,maskRules);
assert(allRings.some((value,i)=>i%4!==3&&value>0&&nearOnly[i]===0),'Outer residents are visible through inner-ring gaps');
for(let i=0;i<120;i++)maskScene.step();
for(const [i,e] of samples.entries())assert.deepEqual({...e.body.translation()},starts[i],'Mask samples stay still');
assert(maskScene.relocate({x:250,y:250}),'Black background beyond the ring fixture is navigable');
maskScene.dispose();
}
{
const stars=await createSimulation({layout:'stars'});
assert.equal(stars.entities.length,241);assert.equal(stars.walls.length,0);
const starResidents=stars.entities.filter(e=>e!==stars.player),distances=starResidents.map(e=>Math.hypot(e.body.translation().x,e.body.translation().y));
assert(starResidents.every(e=>e instanceof Character&&e.size===1),'Star fixtures use real shared bodies with standard body-length size');
for(const [min,max] of [[4,24],[24,128],[128,1200],[1200,3000]])assert(distances.some(d=>d>=min&&d<max),'Stars include near, middle and distant neighbours');
for(let i=0;i<starResidents.length;i++)for(let j=0;j<i;j++){
  const a=starResidents[i].body.translation(),b=starResidents[j].body.translation();
  assert(Math.hypot(a.x-b.x,a.y-b.y)>2,'Star fixtures remain separated');
}
for(const layout of ['stars','mask']){
  const world=layout==='stars'?stars:await createSimulation({layout});
  world.population(100);assert.equal(world.entities.length,100,'Common population applies to every open field');
  const e=world.entities[1],start={...e.body.translation()};world.setWandering(true);
  for(let i=0;i<60;i++)world.step();
  assert(Math.hypot(e.body.translation().x-start.x,e.body.translation().y-start.y)>.1,'Common movement applies to sample residents too');
  world.population(0);assert.equal(world.entities.length,layout==='stars'?241:997,'Scene preset restores the fixture population');
  world.dispose();
}
}
const sim=await createSimulation({wandering:false});
assert.equal(sim.entities.length,15);
assert.equal(sim.walls.length,43);
assert(sim.labels.every(({name})=>!/(我的|妻子|孩子|孙子|女儿|警察|听差)/.test(name)),'Map labels identify places, not residents');
for(const e of sim.entities){
  assert(e instanceof Character,'Studio residents must be shared Character instances');
  assert(e.size>=MIN_SIZE&&e.size<=MAX_SIZE,'Studio sizes must stay in the character lab range');
  assert.deepEqual(e.vertices,new Character('reference',characterTypes.find(t=>t.id===e.typeId),{size:e.size}).vertices);
}
const wife=sim.entities.find(e=>e.typeId==='woman');
assert.equal(wife.vertices.length,2,'A woman must remain a zero-thickness segment');
assert.equal(wife.collider.shape.type,RAPIER.ShapeType.Segment);
const aimOrigin={...sim.player.body.translation()};
sim.aimAt({x:aimOrigin.x+3,y:aimOrigin.y});
for(let i=0;i<90;i++)sim.step();
assert(Math.abs(sim.player.body.rotation())<.002,'A resident-view aim target must become the sight centre');
assert.deepEqual({...sim.player.body.translation()},aimOrigin,'Aiming must not relocate the observer');
sim.aimAt({x:aimOrigin.x-3,y:aimOrigin.y});sim.aimAt(null);
const cancelledHeading=sim.player.body.rotation();
for(let i=0;i<30;i++)sim.step();
assert.equal(sim.player.body.rotation(),cancelledHeading,'Cancelling a pending click must stop its aim command');
assert.equal(sim.relocate(point(328,60)),false,'A click on a wall must be rejected');
assert(sim.relocate({x:sim.bounds.x+2,y:0}),'Black space outside the initial room area has no invisible wall');
const walkStart={...sim.player.body.translation()},destination={x:walkStart.x+1,y:walkStart.y+.5};
assert(sim.walkTo(destination));sim.step();
assert(Math.hypot(sim.player.body.translation().x-walkStart.x,sim.player.body.translation().y-walkStart.y)<.02,'Click walking never teleports');
for(let i=0;i<240;i++)sim.step();
assert(Math.hypot(sim.player.body.translation().x-destination.x,sim.player.body.translation().y-destination.y)<.025,'Click walking reaches a free destination');
assert.equal(sim.walkTarget,null,'Arrival clears the walking command');
const arrived={...sim.player.body.translation()};for(let i=0;i<30;i++)sim.step();
assert.deepEqual({...sim.player.body.translation()},arrived,'Arrival stops motion');
sim.walkTo({x:20,y:0});sim.step({...idle,turn:1});assert.equal(sim.walkTarget,null,'Manual input cancels walking');
sim.walkTo({x:20,y:0});sim.aimAt({x:20,y:2});assert.equal(sim.walkTarget,null,'Resident aiming cancels walking');
assert.equal(sim.walkTo({x:NaN,y:0}),false,'Invalid destinations cannot reach physics');

// The direct segment crosses the bottom wall; click walking must use a doorway.
assert.equal(sim.pathfinding,false,'Automatic routing defaults off');
sim.setPathfinding(true);
assert(sim.relocate(point(430,455)));
const outside=point(430,550);assert(sim.walkTo(outside));let crossedDoorway=false;
for(let i=0;i<2400&&sim.walkTarget;i++){
  sim.step();if(sim.player.body.translation().x<.1)crossedDoorway=true;
  for(const wall of sim.walls){const contact=sim.player.collider.contactCollider(wall.collider,0);assert(!contact||contact.distance>-.002,'Path following cannot cut through a wall');}
}
assert(crossedDoorway&&sim.walkTarget===null&&Math.hypot(sim.player.body.translation().x-outside.x,sim.player.body.translation().y-outside.y)<.025,'Click walking goes around the wall through a doorway and reaches the destination');
assert.equal(sim.walkTo(point(430,487)),false,'A destination occupied by the bottom wall is rejected');
assert(sim.relocate(point(430,455)));

sim.player.body.setRotation(-Math.PI/2,true);
for(let i=0;i<180;i++)sim.step({...idle,forward:1});
assert(sim.player.body.translation().y>-6.0,'Walking must stop at the bottom wall');
assert(sim.touching,'The wall must report a real contact');
// Walk out through the wide left doorway, following its outward normal.
assert(sim.relocate(point(182,393)));
sim.player.body.setRotation(Math.PI,true);
for(let i=0;i<180;i++)sim.step({...idle,forward:1});
assert(sim.player.body.translation().x<point(135,393).x,'The door must remain traversable');
assert(sim.relocate(point(319,302)));
const target=sim.entities.find(e=>e.role==='resident');
target.die('killed');for(let i=0;i<10;i++)sim.step();
assert.equal(target.body.isEnabled(),false,'A dead character leaves physics');
assert(sim.entities.includes(target),'Keep the last pose until the renderer finishes any death animation');
sim.remove(target);
assert(!sim.entities.includes(target),'The studio can remove dead scene fixtures');
assert.equal(sim.population(300),300);
assert.deepEqual(new Set(sim.entities.map(e=>e.typeId)),new Set(characterTypes.map(t=>t.id)),'Crowds must use all and only the six validated character types');
const crowdPositions=sim.entities.filter(e=>e.role==='crowd').map(e=>({...e.body.translation()}));
const started=performance.now();
for(let i=0;i<300;i++)sim.step();
const elapsed=performance.now()-started;
const live=sim.entities.filter(e=>e.state!=='dead');
sim.entities.filter(e=>e.role==='crowd').forEach((e,i)=>{
  const p=e.body.translation(),before=crowdPositions[i];
  assert(Math.hypot(p.x-before.x,p.y-before.y)<.001,'Pausing free movement must keep residents stationary');
});
let worst=0;
for(let i=0;i<live.length;i++){
  const a=live[i].collider;
  for(const w of sim.walls){const c=a.contactCollider(w.collider,0);if(c)worst=Math.max(worst,-c.distance);}
  for(let j=0;j<i;j++){const c=a.contactCollider(live[j].collider,0);if(c)worst=Math.max(worst,-c.distance);}
}
assert(worst<.001,`Penetration exceeded the prototype tolerance: ${worst}`);
const pos=sim.player.body.translation();
const hit=sim.world.castRay(new RAPIER.Ray(pos,{x:0,y:1}),40,true,undefined,undefined,sim.player.collider);
assert(hit&&hit.timeOfImpact>0,'Resident sight must ignore its own body');
assert.equal(sim.population(14),14,'Population switching must remove extra colliders');
console.log(JSON.stringify({checks:'shared Character geometry and sizes, female segment, wall blocking, doorway, Character lifecycle, paused 300 residents, sight ray, population cleanup',physicsSteps:300,physicsMsPerStep:Number((elapsed/300).toFixed(3)),maxPenetrationMetres:Number(worst.toFixed(5))},null,2));
sim.dispose();

// Free movement is a studio script, using the same bodies and touch interactions.
const roaming=await createSimulation();
const walkStarts=new Map(roaming.entities.map(e=>[e,{...e.body.translation()}]));
for(let i=0;i<600;i++)roaming.step();
for(const e of roaming.entities.filter(e=>e!==roaming.player)){
  const p=e.body.translation(),before=walkStarts.get(e);
  assert(Math.hypot(p.x-before.x,p.y-before.y)>.1,'Every initial resident must be able to leave its starting position');
  assert.equal(e.interaction,'touch','Wandering must not initiate random killings');
}
assert.deepEqual({...roaming.player.body.translation()},walkStarts.get(roaming.player),'Wandering must not drive the observer');
assert.equal(roaming.population(300),300);
const crowdStarts=roaming.entities.filter(e=>e.role==='crowd').map(e=>({...e.body.translation()}));
const roamingStart=performance.now();
for(let i=0;i<600;i++)roaming.step();
const roamingMs=(performance.now()-roamingStart)/600;
const movedCrowd=roaming.entities.filter(e=>e.role==='crowd').filter((e,i)=>{
  const p=e.body.translation(),before=crowdStarts[i];
  return Math.hypot(p.x-before.x,p.y-before.y)>.1;
}).length;
assert(movedCrowd>270,'The populated crowd must also wander');
assert(roaming.entities.every(e=>e.state==='alive'),'Free movement must keep residents alive');
for(const e of roaming.entities){
  for(const w of roaming.walls){
    const contact=e.collider.contactCollider(w.collider,0);
    assert(!contact||contact.distance>-.001,'Moving residents must remain outside wall interiors');
  }
}
roaming.setWandering(false);
for(let i=0;i<60;i++)roaming.step(); // Let any final collision correction settle.
const paused=roaming.entities.map(e=>({...e.body.translation()}));
for(let i=0;i<120;i++)roaming.step();
roaming.entities.forEach((e,i)=>assert.deepEqual({...e.body.translation()},paused[i],'Pausing must stop every resident'));
const deceased=roaming.entities.find(e=>e.role==='resident');
deceased.die();const lastPose={...deceased.body.translation()};
roaming.setWandering(true);
for(let i=0;i<120;i++)roaming.step();
assert.deepEqual({...deceased.body.translation()},lastPose,'Resuming must not move dead residents');
assert(roaming.entities.some((e,i)=>e!==roaming.player&&Math.hypot(e.body.translation().x-paused[i].x,e.body.translation().y-paused[i].y)>.1),'Resuming must restart live residents');
assert.equal(roaming.population(100),100);
assert.equal(roaming.population(14),14,'Population changes must discard removed wanderers');
for(let i=0;i<60;i++)roaming.step();
console.log(JSON.stringify({checks:'default wandering, observer input only, obstacle clearance, 300 living residents, pause/resume, dead bodies stay still, population cleanup',movedCrowd,physicsMsPerStep:Number(roamingMs.toFixed(3))},null,2));
roaming.dispose();

// Three transformed copies keep independent building-wide lighting and working
// doorways. Population controls must also reach counts below the preset.
{
const block=await createSimulation({layout:'neighborhood',wandering:false});
assert.equal(block.houses.length,3);assert.equal(block.entities.length,43);
const boundaries=houseBoundaries(block),buildings=new Set(boundaries.map(w=>w.object));
assert.equal(buildings.size,3,'Each home has its own optical reference');
assert([...buildings].every(building=>building.boundaries.length===43));
for(const house of block.houses){
  assert(block.relocate(house.transform(point(182,393))),'Every wide entrance is traversable, including rotated homes');
  assert(!block.relocate(house.transform(point(328,60))),'Every home has physical walls');
}
assert(block.relocate(block.home));
for(const count of [14,300,0]){
  const total=count||43;assert.equal(block.population(count),total);assert.equal(block.world.bodies.len(),total);
  for(const e of block.entities){
    block.world.intersectionsWithShape(e.body.translation(),e.body.rotation(),e.collider.shape,()=>{
      assert.fail('Community residents must not start inside a wall or neighbour');
    },undefined,undefined,e.collider);
  }
}
const poses=block.entities.map(e=>({...e.body.translation()}));
for(let i=0;i<60;i++)block.step();
block.entities.forEach((e,i)=>assert.deepEqual({...e.body.translation()},poses[i]));
assert(createSight(block)(640).some((v,i)=>i%4!==3&&v>0),'Community geometry participates in resident vision');
block.dispose();
console.log('Community: three houses, separate optical references, wall/door collisions, population replacement and resident vision passed.');
}

// The larger scene uses real Character bodies, with clear lanes and no stale
// colliders when the population is replaced. A bounding-circle query is stricter
// than the actual polygons at these initial, deliberately separated positions.
const parade=await createSimulation({layout:'parade'});
assert.equal(parade.walls.length,0);
assert.equal(parade.entities.length,1000);
assert.equal(parade.wandering,false,'The initial parade keeps its viewing aisles');
const paradeEye={...parade.player.body.translation()};
for(const count of [1000,2000,1000]){
  assert.equal(parade.population(count),count);
  assert.equal(parade.world.bodies.len(),count,'Replacing a formation must remove old bodies');
  for(const e of parade.entities){
    assert(e instanceof Character);
    const p=e.body.translation();
    if(e!==parade.player){
      assert(Math.abs(p.x)-e.radius>3,'Keep the central avenue clear');
      const dy=p.y-paradeEye.y,radius=Math.hypot(p.x,dy);
      assert(radius>=9.99&&radius<=76.01&&Math.abs(Math.atan2(p.x,dy))<=Math.PI/3+1e-6,'The formation occupies a 120-degree fan around the viewing point');
      const angle=e.body.rotation();
      assert(Math.cos(angle)*(-p.x)+Math.sin(angle)*(-dy)>radius-.001,'Residents face the viewing point');
    }
    assert(Math.abs(p.x)+e.radius<parade.bounds.x&&Math.abs(p.y)+e.radius<parade.bounds.y);
    parade.world.intersectionsWithShape(p,0,new RAPIER.Ball(e.radius+.001),()=>{
      assert.fail('Initial parade residents must not overlap a neighbour or boundary');
    },undefined,undefined,e.collider);
  }
  const before=parade.entities.map(e=>({...e.body.translation()}));
  for(let i=0;i<60;i++)parade.step();
  parade.entities.forEach((e,i)=>assert.deepEqual({...e.body.translation()},before[i]));
  parade.setWandering(true);
  for(let i=0;i<120;i++)parade.step();
  assert(parade.entities.every(e=>e.state==='alive'));
  assert(parade.entities.slice(1).every((e,i)=>Math.hypot(e.body.translation().x-before[i+1].x,e.body.translation().y-before[i+1].y)>.1));
  assert.deepEqual({...parade.player.body.translation()},paradeEye,'Crowd motion must not drive the observer');
  parade.setWandering(false);
}
assert(parade.relocate({x:0,y:0}),'The central viewing avenue must be accessible');
assert(parade.relocate({x:parade.bounds.x+1,y:0}),'Black space outside the parade has no invisible wall');
parade.player.body.setRotation(0,true);
for(let i=0;i<90;i++)parade.step({forward:1});
assert(parade.player.body.translation().x>parade.bounds.x+2,'The observer can also walk through the former invisible boundary');
assert(parade.relocate({x:0,y:0}));parade.player.body.setRotation(Math.PI/2,true);
for(const projection of ['perspective','equidistant']){
  const pixels=createSight(parade)(1280,OPTICS_RULES,observerFor(parade.player,Math.PI*2/3,projection));
  assert.equal(pixels.length,1280*4);
  assert(pixels.some((v,i)=>i%4!==3&&v>0),'Both projection modes must see the larger crowd');
}
parade.dispose();
console.log(JSON.stringify({paradeChecks:'1000/2000/1000 residents, real bodies, separated placement, central aisle, pause/move, observer independence, bounds, both projections'},null,2));

// Style selection uses the same scene operation as the UI and newly added
// meshes. Bodies, individual variants and optical intensity remain unchanged.
const styleSim=await createSimulation({wandering:false}),styleSight=createSight(styleSim);
styleSim.entities[1].injure();styleSim.entities[2].die();
const styleRules={...OPTICS_RULES,finish:'clear',coloring:true};
setScenePaintStyle(styleSim.entities,styleRules,DEFAULT_PAINT_STYLE);
const physicalState=()=>styleSim.entities.map(e=>({id:e.id,body:e.body.handle,collider:e.collider.handle,
  position:{...e.body.translation()},angle:e.body.rotation(),velocity:{...e.body.linvel()},angular:e.body.angvel(),state:e.state,variant:e.paintVariant}));
const originalState=physicalState(),styleGray=styleSight(401,{...styleRules,coloring:false}),styleImages=[];
const lightControls=()=>[styleRules.fog,styleRules.attenuationDistance,styleRules.attenuationFloor,styleRules.contour,
  styleRules.contourFloor,styleRules.exposure,styleRules.glow,styleRules.finish,styleRules.materials.resident.emission,styleRules.materials.house.emission];
const originalLight=lightControls(),originalPaint=styleSim.entities.map(e=>e.paintedEdges);
assert(new Set(styleSim.entities.map(e=>e.paintedEdges[0].color)).size>=4,'Residents use distinct theme colours, stable per individual');
for(const [id,style] of Object.entries(PAINT_STYLES)){
  setScenePaintStyle(styleSim.entities,styleRules,id);
  assert.deepEqual(physicalState(),originalState,'Style changes must preserve bodies, pose, velocity, life and variant');
  assert.deepEqual(lightControls(),originalLight,'A palette must not alter light intensity or propagation');
  assert.equal(styleRules.materials.house.color,style.wall,'Every wall must share the selected style color');
  assert(styleSim.entities.every(e=>e.paintStyle===id),'Existing residents must adopt the selected style');
  assert.equal(new Set(styleSim.entities.map(e=>e.color)).size,style.pattern==='directional'?1:style.colors.length,'Each style exposes its distinct theme keys');
  assert.deepEqual(styleSight(401,{...styleRules,coloring:false}),styleGray,'Grayscale must be independent of the chosen style');
  styleImages.push(styleSight(401,styleRules));
}
assert.notDeepEqual(styleImages[0],styleImages[1]);assert.notDeepEqual(styleImages[1],styleImages[2]);
setScenePaintStyle(styleSim.entities,styleRules,DEFAULT_PAINT_STYLE);
assert.deepEqual(styleSim.entities.map(e=>e.paintedEdges),originalPaint,'Returning to a style must restore the same individual palettes');
styleRules.coloring=false;
setScenePaintStyle(styleSim.entities,styleRules,'neon');
assert.equal(styleRules.coloring,false,'Choosing a style while grayscale is enabled must not turn color on');
assert.deepEqual(styleSight(401,styleRules),styleGray);
styleRules.coloring=true;
assert.deepEqual(styleSight(401,styleRules),styleImages[1],'Re-enabling color must reveal the style selected while grayscale was on');
const existing=new Set(styleSim.entities);
assert.equal(styleSim.population(100),100);
const afterPopulation=physicalState();
for(const character of styleSim.entities.filter(e=>!existing.has(e)))setScenePaintStyle([character],styleRules,styleRules.paintStyle);
assert.deepEqual(physicalState(),afterPopulation,'Styling a new resident must not change its physical state');
assert(styleSim.entities.every(e=>e.paintStyle==='neon'),'Newly added residents must inherit the current style');
assert(styleSight(1280,styleRules).length===5120,'Style changes must remain valid at full-view resolution');
styleSim.dispose();
console.log(JSON.stringify({styleChecks:'theme and directional-gray palettes, stable individual variants, body and lifecycle preservation, shared wall color, unchanged light rules, grayscale selection and re-enable, new population inheritance'},null,2));

// The studio must deliver the light lab's image from live simulation poses,
// including the different heading convention, removal and output resolution.
const sightWorld=new RAPIER.World({x:0,y:0});
const eye={body:sightWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation(Math.PI/2)),state:'alive'};
const figure={vertices:resident(3,{y:0}).vertices,body:sightWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1.2,6).setRotation(.37)),state:'alive'};
const fixture={walls:[],entities:[eye,figure],player:eye};
const sample=createSight(fixture);
for(const finish of ['clear','matte','original'])for(const width of [152,246,801,1280]) {
  const rules={...OPTICS_RULES,finish};
  const expected=exposeRow(projectScene([resident(3,{x:1.2,y:6,angle:.37})],width,{rules}),rules);
  const actual=sample(width,rules);
  assert(actual.every((v,i)=>Math.abs(v-expected[i])<=1),`Studio ${finish} preview and full view must match the light lab at their display resolution`);
}
eye.body.setRotation(-Math.PI/2,true);
assert(sample(401).every((v,i)=>i%4===3?v===255:v===0),'Turning away must leave a black image without the observer or invisible exploration walls');
eye.body.setRotation(0,true);figure.body.setTranslation({x:6,y:-1.2},true);figure.body.setRotation(.37-Math.PI/2,true);
const facingEast=sample(401);
eye.body.setRotation(Math.PI/2,true);figure.body.setTranslation({x:1.2,y:6},true);figure.body.setRotation(.37,true);
const facingNorth=sample(401);
assert(facingEast.every((v,i)=>Math.abs(v-facingNorth[i])<=1),'A quarter turn of the whole scene must preserve left/right and lighting');
eye.body.setTranslation({x:37,y:-21},true);figure.body.setTranslation({x:38.2,y:-15},true);
assert(sample(401).every((v,i)=>Math.abs(v-facingNorth[i])<=1),'Observer translation must preserve relative appearance');
figure.state='dead';
assert(sample(401).every((v,i)=>i%4===3?v===255:v===0),'Dead residents must stop emitting and occluding');
figure.state='alive';eye.body.setTranslation({x:0,y:0},true);figure.body.setTranslation({x:0,y:3000},true);
assert(sample(401).some((v,i)=>i%4===0&&v>0),'Distant subpixel residents must retain light beyond the old ray distance limit');
figure.body.setTranslation({x:0,y:6},true);
const blockingWall=sightWorld.createCollider(RAPIER.ColliderDesc.cuboid(2,.04).setTranslation(0,3));
const withWall=createSight({...fixture,walls:[{collider:blockingWall}]});
const darkHouse={...OPTICS_RULES,materials:{...OPTICS_RULES.materials,house:{emission:0}}};
assert(withWall(401,darkHouse).every((v,i)=>i%4===3?v===255:v===0),'A wall must hide the resident behind it even when the wall emits no light');
sightWorld.free();

// Independent dense Rapier rays check the actual house boundaries, junctions,
// material selection and handedness. Optical integration keeps subpixel edges;
// rays here are only a test reference, with 128 samples per output pixel.
const room=await createSimulation({wandering:false}), roomSight=createSight(room);
const poses=()=>room.entities.map(e=>({position:{...e.body.translation()},angle:e.body.rotation(),state:e.state}));
const beforeColor=poses(),grayBefore=roomSight(401);
const coloredRoom=roomSight(401,{...OPTICS_RULES,coloring:true});
assert(coloredRoom.some((v,i)=>i%4===0&&(v!==coloredRoom[i+1]||v!==coloredRoom[i+2])),'The studio must render painted edges and cold walls');
assert.deepEqual(roomSight(401,{...OPTICS_RULES,coloring:false}),grayBefore,'Switching off color must recover the same grayscale pixels');
assert.deepEqual(poses(),beforeColor,'Color switching must not change positions, orientations or lifecycle');
const groupedWalls=houseBoundaries(room),houseEye=observerFor(room.player);
const housePhotometry=boundaryLighting(groupedWalls[0],houseEye);
for(const wall of groupedWalls)assert.deepEqual(boundaryLighting(wall,houseEye),housePhotometry,'Wall pieces must share one house-wide lighting reference');
const nearWall=exposeLight(surfaceLight(2.474330277052148,housePhotometry));
const farWall=exposeLight(surfaceLight(7.261056314654901,housePhotometry));
assert(nearWall>farWall+50,'A farther wall must not restart at full brightness');
const opticalColliders=new Set([...room.walls,...room.entities].map(e=>e.collider.handle));
const referenceRules={...OPTICS_RULES,contour:0,attenuationDistance:0,fog:.1,exposure:1,glow:false};
const samples=128, columns=240;
let worstSightError=0;
for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2,.77]) {
  room.player.body.setRotation(heading,true);room.step();
  const origin=room.player.body.translation(), c=Math.cos(heading), s=Math.sin(heading);
  const light=new Float64Array(columns);
  for(let column=0;column<columns;column++)for(let sub=0;sub<samples;sub++) {
    const offset=2*(column+(sub+.5)/samples)/columns-1;
    const dx=c+s*offset, dy=s-c*offset, norm=Math.hypot(dx,dy);
    const hit=room.world.castRay(new RAPIER.Ray(origin,{x:dx/norm,y:dy/norm}),100,true,undefined,undefined,room.player.collider,undefined,c=>opticalColliders.has(c.handle));
    if(hit) {
      const owner=room.byCollider.get(hit.collider.handle);
      const power=referenceRules.materials[owner.body?'resident':'house'].emission;
      light[column]+=power*Math.exp(-referenceRules.fog*hit.timeOfImpact)/samples;
    }
  }
  const expected=exposeRow({light},referenceRules), actual=roomSight(columns,referenceRules);
  for(let i=0;i<actual.length;i++)worstSightError=Math.max(worstSightError,Math.abs(actual[i]-expected[i]));
}
assert(worstSightError<=2,`House optics disagrees with dense physical rays: ${worstSightError} gray levels`);
assert.equal(room.population(300),300);
for(let i=0;i<60;i++)room.step();
assert.equal(roomSight(1280).length,1280*4,'Shared room optics must render every validated crowd shape');
assert.equal(room.population(14),14);
assert.equal(roomSight(246).length,246*4,'Removing the crowd must leave a valid preview');
room.dispose();
console.log(JSON.stringify({studioSightChecks:'shared rules, preview/full resolution, heading, translation, removal, subpixel light, wall occlusion, house junctions, population changes',maxGrayErrorAgainstDenseRays:worstSightError},null,2));

// Absolute observer distance must dim separate objects even with the optional
// shape cue disabled. The overview sample and resident image share the result.
const distanceRules={...OPTICS_RULES,contour:0,glow:false};
const distanceEye={x:17,y:-8};
const distanceGrays=[1,3,6,12,24].map(distance=>{
  const boundary={material:'resident',vertices:[
    {x:distanceEye.x-1,y:distanceEye.y+distance},
    {x:distanceEye.x+1,y:distanceEye.y+distance},
  ]};
  const shape=boundaryLighting(boundary,distanceEye,distanceRules);
  assert.equal(shape.emission,OPTICS_RULES.materials.resident.emission,'Distance must not rewrite intrinsic emission');
  const overview=exposeLight(surfaceLight(distance,shape,distanceRules),distanceRules);
  const image=exposeRow(projectScene([boundary],401,{observer:distanceEye,rules:distanceRules}),distanceRules);
  assert(Math.abs(image[200*4]-overview)<=1,'Overview and resident view must receive the same distance attenuation');
  return overview;
});
assert(distanceGrays.every((gray,i)=>i===0||gray<distanceGrays[i-1]),'Equal emitters must become darker with absolute observer distance');
assert(distanceGrays[0]>distanceGrays[3]+40,'Default attenuation must be visible at room scale without contour enhancement');
const fixedEmitter={material:'resident',vertices:[{x:-1,y:10},{x:1,y:10}]};
const approaching=[-14,-2,4,7,9].map(y=>exposeRow(projectScene([fixedEmitter],401,{observer:{y},rules:distanceRules}),distanceRules)[200*4]);
assert.deepEqual(approaching,[...distanceGrays].reverse(),'Moving the observer must move the attenuation centre');
console.log(JSON.stringify({observerDistanceChecks:'intrinsic emission, absolute distance, visible attenuation without shape cues, shared overview/resident brightness, moving observer',distances:[1,3,6,12,24],gray:distanceGrays},null,2));

// The drawn left/centre/right rays must address the same pixels as the light
// image, including when the observer faces east, south or across the angle wrap.
for(const projection of ['perspective','equidistant'])for(const fov of [60,90,120,160])for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,3.1,-3.1]){
  const observer=observerFor({body:{translation:()=>({x:37,y:-21}),rotation:()=>angle}},fov*Math.PI/180,projection);
  for(const screenX of [-.01,0,.25,.5,.75,1,1.01]){
    const d=sightDirection(observer,screenX),p={x:observer.x+d.x*7,y:observer.y+d.y*7};
    const probe={material:'resident',vertices:[{x:p.x-d.y*.001,y:p.y+d.x*.001},{x:p.x+d.y*.001,y:p.y-d.x*.001}]};
    const row=projectScene([probe],401,{observer,rules:{...OPTICS_RULES,contour:0,fog:0}}).light;
    const lit=Array.from(row,(v,i)=>v>0?i:-1).filter(i=>i>=0);
    if(screenX<0||screenX>1)assert.equal(lit.length,0,'A probe outside the marked angle must be outside the preview');
    else{
      assert(lit.length>0,'A probe on or inside the marked angle must enter the preview');
      assert(lit.every(i=>Math.abs(i-Math.min(400,Math.floor(screenX*401)))<=1),'Guide direction must land at the corresponding preview column');
    }
  }
}

// Splitting one object's geometry must not create new bright fronts or release
// its contrast independently on narrow fragments. The lab's intact polygon is
// the reference, including when the entire object becomes a subpixel point.
for(const distance of [6,60,3000])for(const width of [152,401]){
  const whole=resident(5,{y:distance,angle:.3});
  const boundaries=whole.vertices.map((p,i)=>[p,whole.vertices[(i+1)%whole.vertices.length]]);
  const object={outline:whole.vertices,boundaries};
  const pieces=boundaries.map(vertices=>({material:whole.material,vertices,object}));
  const expected=exposeRow(projectScene([whole],width)),actual=exposeRow(projectScene(pieces,width));
  assert(actual.every((v,i)=>Math.abs(v-expected[i])<=1),'Parts of one object must reproduce its intact optical image');
}
console.log(JSON.stringify({viewGuideChecks:'left/right limits, centre, rotation, outside-FOV rejection',houseLightingChecks:'shared reference, subdivision invariance',nearAndFarWallGray:[nearWall,farWall]},null,2));

// Study 000 integrates visibility before exposure. Distant geometry smaller
// than a pixel must still contribute, while fully occluded geometry must not.
const total=row=>row.reduce((a,b)=>a+b,0);
const flatRules={...OPTICS_RULES,fog:0,contour:0,attenuationDistance:0};
const viewAt=(n,d,angle=0)=>projectScene([resident(n,{y:d,angle})],400,{rules:flatRules});
for(const {shape} of STUDY_SHAPES) {
  const close=viewAt(shape,6,.37), distant=viewAt(shape,60,.37), turned=viewAt(shape,6,.74);
  assert(close.coverage>distant.coverage*8,'All seven shapes must shrink in perspective');
  if(shape==='circle')assert.deepEqual(close,turned,'A circle must retain its projection under rotation');
  else assert.notDeepEqual(Array.from(close.light),Array.from(turned.light),'Rotation must update polygon and segment projections');
}
assert.equal(resident(2).vertices.length,2,'The line must have two endpoints without artificial thickness');
assert(viewAt(2,6).coverage<1e-8&&viewAt(2,6,Math.PI/2).coverage>60,'A segment must narrow end-on and widen when turned across the view');
assert(Math.abs(viewAt('circle',6).coverage-400/Math.sqrt(35))<.01,'The sampled circle must match its analytic projected width');
const farPoint=viewAt(7,3000);
assert(farPoint.coverage<1&&total(farPoint.light)>0,'Subpixel residents must retain their light');
assert(Math.max(...exposeRow(farPoint).filter((_,i)=>i%4===0))>100,'Without distance attenuation, default exposure should retain a visible distant point');
const tipEnhanced=exposeRow(projectScene([resident(3,{y:6})],401,{rules:{fog:0,attenuationDistance:0}}),{glow:false});
assert(tipEnhanced[200*4]>220,'Contour enhancement must preserve the nearest point brightness');
assert(tipEnhanced[200*4]-tipEnhanced[223*4]>110,'Exposure must preserve contrast between near points and receding sides');
assert(tipEnhanced[223*4]>110,'Receding sides must retain visible dark gray instead of fading into black');
const farEnhanced=projectScene([resident(7,{y:3000})],400,{rules:{fog:0,attenuationDistance:0}});
assert.deepEqual(farEnhanced.light,farPoint.light,'Subpixel star energy must be unaffected by contour enhancement');
assert.deepEqual(exposeRow(farEnhanced),exposeRow(farPoint),'Depth cues must not change displayed subpixel stars');

// User regression: a pentagon facing the eye with a broad horizontal front
// edge and two narrow receding sides, at the actual 152px card resolution.
// Isolate the shape cue; absolute-distance dimming is verified separately above.
const pentagonView=angle=>{
  const pixels=exposeRow(projectScene([resident(5,{angle})],152,{rules:{attenuationDistance:0}}));
  return Array.from({length:152},(_,i)=>pixels[i*4]);
};
const front= pentagonView(Math.PI/5),leftTurn=pentagonView(Math.PI/5+.3),rightTurn=pentagonView(Math.PI/5-.3);
assert(front[75]>front[67]+15&&front[67]>front[66]+35&&front[66]>front[65]+20,'The front edge and adjacent narrow sides must retain distinct grayscale after exposure and glow');
assert(front[65]>110,'The narrow far side must remain visible');
assert(new Set(front.slice(68,76)).size>=5,'Even the broad near edge must retain its small continuous distance gradient');
assert(leftTurn.indexOf(Math.max(...leftTurn))<73&&rightTurn.indexOf(Math.max(...rightTurn))>78,'The brightest point must move with the rotating nearest boundary');
assert(leftTurn.every((v,i)=>Math.abs(v-rightTurn[151-i])<=1),'Opposite rotations must produce mirrored gradients');
const pentagonSurface=boundaryLighting(resident(5,{angle:Math.PI/5}));
for(const exposure of [1,12,64]) {
  const values=[0,.05,.2,.5,1].map(offset=>exposeLight(surfaceLight(pentagonSurface.nearest+offset,pentagonSurface),{exposure}));
  assert(values.every((value,i)=>i===0||value<values[i-1]),'Overview and resident rendering must preserve distance differences even at high exposure');
}
console.log(JSON.stringify({pentagonContrastChecks:'front edge, narrow sides, continuous gradient, rotation, high exposure',frontToSideGray:[front[75],front[67],front[66],front[65]]},null,2));
const pixelShape=(left,right,depth=1000,material='resident')=>({material,vertices:[
  {x:(left/50-1)*depth,y:depth},{x:(right/50-1)*depth,y:depth},
  {x:(right/50-1)*(depth+1),y:depth+1},{x:(left/50-1)*(depth+1),y:depth+1}
]});
const starA=pixelShape(50.1,50.2), starB=pixelShape(50.3,50.4);
const first=projectScene([starA],100,{rules:flatRules}).light;
const combined=projectScene([starA,starB],100,{rules:flatRules}).light;
assert(Math.abs(first[50]-.1)<1e-8);
assert(Math.abs(combined[50]-.2)<1e-8,'Two visible lights in disjoint portions of one pixel must add');
const blocked=projectScene([pixelShape(50,51,100,'house'),starA,starB],100,{rules:{...flatRules,materials:{...OPTICS_RULES.materials,house:{emission:0}}}});
assert.equal(total(blocked.light),0,'A dark foreground body must block all background light');
for(const phase of [.01,.2,.49,.8,.99]) {
  const sample=projectScene([pixelShape(49+phase,49.04+phase)],100,{rules:flatRules});
  assert(Math.abs(total(sample.light)-.04)<1e-8,'Subpixel energy must survive motion across pixel boundaries');
}
const empty=exposeRow(projectScene([],100));
assert(empty.every((value,i)=>i%4===3?value===255:value===0),'An empty view must be pure opaque black, even with glow');
assert.equal(total(projectScene([resident(5,{y:6})],100,{observer:{heading:Math.PI}}).light),0,'Turning away must put geometry behind the eye');

// The same material policy applies to any outline and role. Moving the whole
// scene with its observer must preserve the image without rewriting entities.
const outline=Object.freeze({material:'resident',vertices:Object.freeze([
  {x:-1.2,y:5.7},{x:.2,y:4.9},{x:1.4,y:6.1},{x:.4,y:7.4},{x:-.8,y:6.9},
].map(Object.freeze))});
const baselineProjection=projectScene([outline],401),baseline=baselineProjection.light;
const segment={material:'resident',vertices:[{x:-1,y:6},{x:1,y:6}]};
assert(total(projectScene([segment],401).light)>0,'Line-shaped residents must use the same material and observer rules');
assert.deepEqual(projectScene([{...outline,role:'soldier',behavior:'walking',emission:99,radius:100}],401),baselineProjection,'Role and instance attributes cannot override optical rules');
const houseLight=projectScene([{...outline,material:'house'}],401).light;
assert(houseLight.every((v,i)=>Math.abs(v-baseline[i]*OPTICS_RULES.materials.house.emission/OPTICS_RULES.materials.resident.emission)<1e-10),'Material alone must select the shared emission rule');
assert.throws(()=>projectScene([{...outline,material:'unknown'}],401),/material rule/,'New materials need an explicit global rule');
const observer=Object.freeze({x:37,y:-21,heading:.72});
const c=Math.cos(observer.heading),s=Math.sin(observer.heading);
const shifted={...outline,vertices:outline.vertices.map(p=>({x:observer.x+c*p.x+s*p.y,y:observer.y-s*p.x+c*p.y}))};
const shiftedProjection=projectScene([shifted],401,{observer}),shiftedLight=shiftedProjection.light;
assert(shiftedLight.every((v,i)=>Math.abs(v-baseline[i])<1e-9),'Observer translation and rotation must preserve relative appearance');
assert(shiftedProjection.contrast.every((v,i)=>Math.abs(v-baselineProjection.contrast[i])<1e-9),'Observer movement must preserve the geometry-based contrast');
const [a,b,...rest]=outline.vertices;
const subdivided={...outline,vertices:[a,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},b,...rest]};
// Midpoint integration can change slightly when an interval is split, but the
// same outline must retain the same displayed contrast to one gray level.
const subdividedPixels=exposeRow(projectScene([subdivided],401)),baselinePixels=exposeRow(baselineProjection);
assert(subdividedPixels.every((v,i)=>Math.abs(v-baselinePixels[i])<=1),'Adding a point along an unchanged edge must preserve its displayed lighting');
const pair=[resident(3,{x:-2}),resident(8,{x:2})];
const pairLight=projectScene(pair,401).light;
const brighter=projectScene(pair,401,{rules:{materials:{...OPTICS_RULES.materials,resident:{emission:2}}}}).light;
assert(brighter.every((v,i)=>Math.abs(v-2*pairLight[i])<1e-10),'One resident rule change must affect different shapes equally');
const crowded=makeCrowd();
for(let i=0;i<crowded.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(crowded[i].x-crowded[j].x,crowded[i].y-crowded[j].y)>2,'The crowd must not overlap');
const crowdBodies=crowded.map(p=>resident(p.sides,p));
const denseView=projectScene(crowdBodies,900,{observer:{heading:-26*Math.PI/180}});
const sparseView=projectScene(crowdBodies,900,{observer:{heading:-135*Math.PI/180}});
assert(denseView.visibleCount>sparseView.visibleCount*3,'Turning should reveal a substantially denser population');
assert(total(denseView.light)>total(sparseView.light)*3,'Dense visible crowds should deliver more light');
const benchmark=performance.now();
for(let i=0;i<30;i++)projectScene(crowdBodies,900,{observer:{heading:i*.02}});
console.log(JSON.stringify({study000Checks:'seven synchronized shapes, perspective, rotation, subpixel coverage, additive visible light, occlusion, empty black, crowd separation, shared materials, role independence, observer transform, outline subdivision',distantPixelCoverage:farPoint.coverage,denseVisible:denseView.visibleCount,sparseVisible:sparseView.visibleCount,crowdProjectionMs:Number(((performance.now()-benchmark)/30).toFixed(2))},null,2));
