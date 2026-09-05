import assert from 'node:assert/strict';
import {createSimulation,RAPIER} from '../src/world.js';
import {findRoute} from '../src/navigation.js';

const sim=await createSimulation({layout:'stars',wandering:false,pathfinding:true});
const npc=sim.entities[1];
for(const e of [...sim.entities])if(e!==sim.player&&e!==npc)sim.remove(e);
sim.player.setInteraction('touch');sim.player.body.setRotation(0,true);
npc.body.setTranslation({x:2,y:3},true);sim.step();
assert(sim.walkTo({x:4,y:0}));let changed=false,replanned=false,detour=0;
for(let i=0;i<1000&&sim.walkTarget;i++){
  const p=sim.player.body.translation();
  if(!changed&&p.x>.6){npc.body.setTranslation({x:2,y:0},true);changed=true;sim.world.step(sim.events);}
  sim.step();replanned||=changed&&sim.walkStatus==='planning';detour=Math.max(detour,Math.abs(p.y));
  assert(!sim.touching,'A new obstacle is avoided before body contact');
}
assert(replanned&&detour>.7&&sim.walkStatus==='idle'&&sim.player.body.translation().x>3.975,'A resident entering the route triggers a successful detour');
assert.equal(sim.walkTo(npc.body.translation()),false,'Occupied destinations reject walking');
sim.walkTo({x:6,y:0});sim.step({turn:1});assert.equal(sim.walkTarget,null,'Keys cancel the route');
sim.walkTo({x:6,y:0});sim.relocate({x:0,y:0});assert.equal(sim.walkTarget,null,'Teleport cancels the route');
sim.setPathfinding(false);assert(!sim.pathfinding);
assert(sim.walkTo(npc.body.translation()),'Direct walking can approach a resident to touch or kill');
for(let i=0;i<300&&sim.walkTarget;i++)sim.step();
assert(sim.walkStatus==='blocked'&&sim.player.body.translation().x<1.5,'Routing off walks straight and stops at an obstacle');
sim.setPathfinding(true);sim.relocate({x:0,y:0});
sim.walkTo({x:6,y:0});sim.population(0);assert.equal(sim.walkTarget,null,'Changing population cancels a stale route');
for(const e of [...sim.entities])if(e!==sim.player)sim.remove(e);
for(const [x,y,hx,hy] of [[0,2,2,.04],[0,-2,2,.04],[-2,0,.04,2],[2,0,.04,2]])sim.world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy).setTranslation(x,y));
sim.step();assert(sim.walkTo({x:4,y:4}));
for(let i=0;i<150&&sim.walkTarget;i++)sim.step();
assert.equal(sim.walkStatus,'blocked','An unreachable destination ends planning with failure feedback');
assert.equal(sim.walkTarget,null,'Failed routes stop instead of pushing indefinitely');
assert(Math.hypot(sim.player.body.translation().x,sim.player.body.translation().y)<.01,'Search failure never moves or teleports the observer');
sim.dispose();

const world=new RAPIER.World({x:0,y:0}),body=new RAPIER.Ball(.32);
const cast=(a,b)=>world.castShape(a,0,{x:b.x-a.x,y:b.y-a.y},body,0,1,false);
const wall=(x,y,hx,hy)=>world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy).setTranslation(x,y));
let queries=0,batches=0;
function route(start,goal){
  const search=findRoute(start,goal,(a,b)=>{queries++;return cast(a,b);});
  let result;
  do{const before=queries;result=search.next();batches++;assert(queries-before<1500,'Search work is divided into bounded batches');}while(!result.done);
  if(result.value){let previous=start;for(const p of result.value){assert(!cast(previous,p),'Every smoothed segment has full-body clearance');previous=p;}assert.deepEqual(previous,goal);}
  return result.value;
}
// Very large fields must skip empty distance instead of filling a huge grid.
const remote=wall(4000,0,.1,2);world.step();
let before=queries;
assert(route({x:0,y:0},{x:5000,y:0})?.length>1);
assert(queries-before<3000,'Far obstacles do not require rasterizing thousands of empty body lengths');
world.removeCollider(remote,true);
// A 0.8-body-length doorway admits the observer's turning clearance.
const lower=wall(0,-2.2,.04,1.8),upper=wall(0,2.2,.04,1.8);world.step();
assert(route({x:-2,y:1},{x:2,y:1}));
world.removeCollider(lower,true);world.removeCollider(upper,true);
// A sealed destination and corner-touching walls have no traversable diagonal.
for(const [x,y,hx,hy] of [[0,2,2,.04],[0,-2,2,.04],[-2,0,.04,2],[2,0,.04,2]])wall(x,y,hx,hy);
world.step();before=queries;
assert.equal(route({x:0,y:0},{x:4,y:4}),null,'Enclosed routes fail without crossing walls or diagonal corners');
assert(queries-before<12000*11,'Failure is bounded');
world.free();
console.log(JSON.stringify({checks:'dynamic avoidance, doorway clearance, far-field shortcut, unreachable destination, cancellation',queries,batches}));
