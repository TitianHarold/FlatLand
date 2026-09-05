import {Character, characterTypes, getCharacterType, RAPIER} from './characters.js';
import {MASK_FIELD,makeCrowd} from './study-scene.js';
import {findRoute} from './navigation.js';
import {sampleStory} from './story-script.js';
import {createRandom} from './random.js';

// The supplied plan maps 35 drawing pixels to one body length in world XY.
export const point = (x, y) => ({ x: (x - 335) / 35, y: (270 - y) / 35 });
export const outline = [[90,240],[328,25],[590,207],[505,484],[201,497]].map(p => point(...p));
export const palette = { outer: '#939c83', west: '#b3ac91', study: '#92a092', bedroom: '#b49f8d', service: '#a5a681', lower: '#a5a58e', player: '#678953' };
const wallData = [
  [90,240,328,25,'outer'],[328,25,590,207,'outer'],[590,207,572,267,'outer'],
  [563,294,505,484,'outer'],[505,484,201,497,'outer'],[201,497,163,431,'outer'],[137,365,90,240,'outer'],
  [232,112,278,167,'west'],[278,167,264,181,'west'],[170,168,223,225,'west'],[223,225,209,240,'west'],
  [90,240,171,268,'west'],[171,268,178,255,'west'],[171,268,177,282,'west'],[128,342,187,316,'west'],[187,316,181,303,'west'],
  [328,25,335,166,'study'],[335,166,375,183,'study'],[329,125,316,139,'study'],[408,195,455,214,'study'],
  [463,120,457,143,'bedroom'],[452,187,440,223,'bedroom'],[439,212,465,223,'bedroom'],[497,236,572,267,'bedroom'],
  [422,240,403,305,'service'],[399,325,392,346,'service'],[387,368,380,394,'service'],
  [418,255,563,294,'service'],[409,285,549,331,'service'],[411,272,528,314,'service'],[380,385,522,424,'service'],
  [368,418,350,437,'lower'],[350,437,355,492,'lower'],[178,452,202,445,'lower'],
  [242,444,281,442,'lower'],[307,439,329,439,'lower'],[329,439,334,491,'lower'],[254,443,258,493,'lower']
];
export const labels = [
  ['客厅',320,269,'main-label','DRAWING ROOM'],['我的书房',379,106,'',''],['我的卧室',506,189,'',''],
  ['孩子们的房间',223,252,'small-label',''],['妻子的房间',489,286,'small-label',''],['仆役房',490,397,'small-label',''],
  ['地窖',427,454,'',''],['孙子们的房间',256,421,'small-label',''],['入口',124,401,'small-label',''],['入口',584,284,'small-label',''],['我的妻子',285,373,'small-label','']
];
let initialized;
export async function createSimulation({layout='house',wandering=layout==='house',pathfinding=false,residentKilling=false,scripted=false}={}) {
  initialized ??= RAPIER.init();
  await initialized;
  let world = new RAPIER.World({x:0,y:0});
  world.timestep = 1/60;
  world.integrationParameters.numSolverIterations = 8;
  world.integrationParameters.maxCcdSubsteps = 4;
  world.integrationParameters.normalizedAllowedLinearError = .0001;
  const events = new RAPIER.EventQueue(true);
  const entities = [], walls = [], byCollider = new Map();
  // Initial layout extents only: empty space has no invisible collision fence.
  const parade=layout==='parade',maskTest=layout==='mask',stars=layout==='stars',fieldRadius=MASK_FIELD.rings*MASK_FIELD.spacing;
  const bounds=stars?{x:3000,y:3000}:parade?{x:58,y:38}:maskTest?{x:fieldRadius,y:fieldRadius}:{x:12,y:10};
  const home=parade?{x:0,y:-35}:(maskTest||stars)?{x:0,y:0}:point(319,302);
  const walkers=new Map();
  const walkRandom=createRandom(731);
  let nextId=0, aim=null, walkTarget=null, blockedTime=0;
  let route=[],routeSearch=null,routeCheck=0,walkStatus='idle';
  for (const [x1,y1,x2,y2,kind] of layout==='house'?wallData:[]) {
    const a=point(x1,y1), b=point(x2,y2), length=Math.hypot(b.x-a.x,b.y-a.y), angle=Math.atan2(b.y-a.y,b.x-a.x);
    const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(length/2,.04).setTranslation((a.x+b.x)/2,(a.y+b.y)/2).setRotation(angle).setContactSkin(.003).setFriction(.2).setRestitution(0));
    const item={a,b,length,angle,kind,color:palette[kind],collider};
    walls.push(item); byCollider.set(collider.handle,item);
  }
  // The studio chooses instances and poses. Character owns shape, mass,
  // movement, interactions and lifecycle; no parallel character definitions.
  function addEntity({x,y,type='regular-5',size=1,angle=0,name,role='resident',shape}) {
    const e=new Character(nextId++,getCharacterType(type),{size,name,...(shape?{shape}:{})}).attach(world,{x,y,angle});
    e.role=role;entities.push(e);byCollider.set(e.collider.handle,e);
    if(['resident','crowd','sample'].includes(role)){
      e.setInteraction(residentKilling?'kill':'touch');
      walkers.set(e,{heading:angle,time:2+walkRandom()*3,escape:null,nearby:new RAPIER.Ball(e.radius+.06)});
    }
    return e;
  }
  const player=addEntity({...home,type:'regular-4',size:.56,angle:Math.PI/2,name:'你 · 正方形',role:'player'});
  // Circumcircle leaves room to turn at corners, with a small steering margin.
  const walkingShape=new RAPIER.Ball(player.radius+.04);
  const castWalk=(a,b)=>world.castShape(a,0,{x:b.x-a.x,y:b.y-a.y},walkingShape,0,1,false,undefined,undefined,player.collider);
  if(layout==='house'&&!scripted){
  for (const [x,y,n,size] of [[280,120,5,.78],[221,175,5,.78],[162,226,5,.72],[144,300,5,.60],[217,470,6,.5],[292,464,6,.62]]) addEntity({...point(x,y),type:`regular-${n}`,size,angle:.25});
  for (const [x,y] of [[480,339],[472,362],[465,385]]) addEntity({...point(x,y),type:'narrow-triangle',angle:2.9,name:'仆役'});
  addEntity({...point(283,360),type:'woman',angle:.3,name:'妻子'});
  addEntity({...point(354,137),type:'regular-3',size:.53,angle:2.7,name:'访客'});
  addEntity({...point(202,534),type:'narrow-triangle',angle:-.16,name:'门外警卫'});
  addEntity({...point(511,528),type:'narrow-triangle',angle:3.45,name:'门外警卫'});
  }
  function fieldPopulation(total){
    if(stars){
      for(const p of makeCrowd(total,{nearby:true}))addEntity({...p,type:'regular-5',shape:{kind:'regular',sides:p.sides},role:'sample'});
      return;
    }
    const original=Array.from({length:MASK_FIELD.rings},(_,i)=>MASK_FIELD.count(i+1));
    const sum=original.reduce((a,b)=>a+b,0);let weight=0,placed=0;
    for(let ring=1;ring<=MASK_FIELD.rings;ring++){
      weight+=original[ring-1];const end=Math.round(total*weight/sum),count=end-placed;placed=end;
      for(let slot=0;slot<count;slot++){
        const angle=slot*2*Math.PI/count+ring*Math.PI*(3-Math.sqrt(5)),radius=ring*MASK_FIELD.spacing;
        const e=addEntity({x:Math.sin(angle)*radius,y:Math.cos(angle)*radius,type:'regular-5',size:.65,angle:-Math.PI/2-angle,role:'sample'});
        e.paintVariant=0;e.setPaintStyle(e.paintStyle);
      }
    }
  }
  if(!scripted&&(maskTest||stars))fieldPopulation(stars?240:996);
  const scriptActors=new Map();
  let scriptBaseline,scriptAct=-1,scriptTick=0,scriptTarget;
  function setScriptActors(actors,observer,paintStyle){
    if(!scripted)throw new Error('脚本角色仅可用于剧场世界');
    aimAt(null);setWandering(false);
    for(const e of [...entities])if(e!==player)remove(e);
    scriptActors.clear();player.stop();player.body.setEnabled(false);player.storyVisible=false;
    const [x,y]=observer?.position??[home.x,home.y];
    player.body.setTranslation({x,y},true);player.body.setRotation((observer?.angle??90)*Math.PI/180,true);
    for(const actor of actors){
      const [x,y]=actor.position;
      const e=addEntity({x,y,type:actor.type,size:actor.size,angle:actor.angle*Math.PI/180,name:actor.name,role:'script'});
      if(paintStyle)e.setPaintStyle(paintStyle);
      e.storyBasePaint={color:e.color,edgeColors:[...e.edgeColors]};
      e.storyId=actor.id;e.setInteraction('touch');e.body.setEnabled(false);scriptActors.set(actor.id,e);
    }
    world.step(events);events.clear();
    scriptBaseline=world.takeSnapshot();scriptAct=-1;scriptTarget=null;
  }
  function applyScriptFrame(frame,{poses=true}={}){
    if(!scripted)throw new Error('脚本帧仅可用于剧场世界');
    for(const actor of frame.actors){
      const e=scriptActors.get(actor.id);
      if(!e)throw new Error(`未知脚本角色：${actor.id}`);
      if(poses){
        e.body.setTranslation({x:actor.position[0],y:actor.position[1]},true);
        e.body.setRotation(actor.angle*Math.PI/180,true);e.body.setEnabled(false);
        e.state='alive';e.deathCause=null;e.storyDeathAt=undefined;
      }
      e.storyVisible=actor.visible;e.color=actor.color??e.storyBasePaint.color;
      e.edgeColors=actor.color===undefined?[...e.storyBasePaint.edgeColors]:[actor.color];
      // Neutral tint uses the existing optical brightness unchanged. Keep the
      // inherited pigments so backward seeks and recolouring restore them.
      if(actor.coloring===false){e.color='#ffffff';e.edgeColors=['#ffffff'];}
    }
  }
  // Fixed story-time steps use the same bodies, corner strikes and contact rules
  // as the studio. A clean Rapier snapshot makes chapter jumps and rewinds repeatable.
  function seekScript(story,time){
    const frame=sampleStory(story,time),act=story.acts[frame.actIndex];
    if(!frame.collision){scriptAct=-1;applyScriptFrame(frame);return frame;}
    const tick=Math.floor((frame.actTime+1e-8)*60);
    if(scriptAct!==frame.actIndex||tick<scriptTick){
      const handles=entities.map(e=>[e,e.body.handle,e.collider.handle]);
      world.free();world=RAPIER.World.restoreSnapshot(scriptBaseline);events.clear();
      for(const [e,body,collider] of handles){
        e.world=world;e.body=world.getRigidBody(body);e.collider=world.getCollider(collider);
        e.contacts.clear();e.collisionCount=0;e.state='alive';e.deathCause=null;e.storyDeathAt=undefined;e.stop();
      }
      for(const wall of walls)wall.collider=world.getCollider(wall.collider.handle);
      scriptTarget=sampleStory(story,act.start);applyScriptFrame(scriptTarget);
      for(const actor of scriptTarget.actors)scriptActors.get(actor.id).body.setEnabled(actor.visible);
      scriptAct=frame.actIndex;scriptTick=0;
    }
    while(scriptTick<tick){
      const nextTime=act.start+(scriptTick+1)/60;
      // The last step belongs to this act, even at its exact end.
      const next=sampleStory(story,Math.min(nextTime,act.start+act.duration-1e-8)),initiators=new Set();
      for(let i=0;i<next.actors.length;i++){
        const target=next.actors[i],previous=scriptTarget.actors[i],e=scriptActors.get(target.id);
        e.storyVisible=target.visible;
        if(!target.visible||e.state==='dead'){e.body.setEnabled(false);continue;}
        if(!previous.visible){
          e.body.setTranslation({x:target.position[0],y:target.position[1]},true);
          e.body.setRotation(target.angle*Math.PI/180,true);e.body.setEnabled(true);
        }
        e.setInteraction(target.interaction);
        const p=e.body.translation(),angle=e.body.rotation(),c=Math.cos(angle),s=Math.sin(angle);
        const vx=(target.position[0]-previous.position[0])*60+(target.position[0]-p.x)*8;
        const vy=(target.position[1]-previous.position[1])*60+(target.position[1]-p.y)*8;
        const focus=target.face?scriptActors.get(target.face).body.translation():null;
        const desired=focus?Math.atan2(focus.y-p.y,focus.x-p.x):target.angle*Math.PI/180;
        const error=Math.atan2(Math.sin(desired-angle),Math.cos(desired-angle));
        const angular=Math.max(-8,Math.min(8,(focus?0:(target.angle-previous.angle)*Math.PI/3)+error*8));
        const speed=Math.hypot(vx,vy),scale=speed||1;
        e.move({forward:(c*vx+s*vy)/scale,side:(-s*vx+c*vy)/scale,speed:Math.min(6,speed),turn:angular/1.5});
        if(e.drive.x||e.drive.y||e.drive.angular)initiators.add(e);
      }
      world.step(events);dispatchContacts(initiators);
      for(const e of scriptActors.values())if(e.state==='dead'&&e.storyDeathAt===undefined)e.storyDeathAt=nextTime;
      scriptTarget=next;scriptTick++;
    }
    for(const actor of frame.actors){
      const e=scriptActors.get(actor.id),p=e.body.translation();
      actor.position=[p.x,p.y];actor.angle=e.body.rotation()*180/Math.PI;
      actor.state=e.state;actor.deathAt=e.storyDeathAt;actor.collisions=e.collisionCount;
    }
    if(act.observer?.follow){
      const actor=frame.actors.find(actor=>actor.id===act.observer.follow);
      frame.observer={position:actor.position.map((v,i)=>v+act.observer.offset[i]),angle:act.observer.angle??actor.angle};
    }
    if(frame.observer){
      const [x,y]=frame.observer.position;
      if(occupied({x,y},.12)){
        // A neighbour can enter a followed camera's offset. Keep the same view
        // direction and choose the nearest clear point around the intended eye.
        search:for(let r=.2;r<=1.6;r+=.2)for(let i=0;i<16;i++){
          const p={x:x+Math.cos(i*Math.PI/8)*r,y:y+Math.sin(i*Math.PI/8)*r};
          if(!occupied(p,.12)){frame.observer.position=[p.x,p.y];break search;}
        }
      }
    }
    applyScriptFrame(frame,{poses:false});return frame;
  }
  function occupied(pos, radius=.33, exclude=null) {
    let hit=false;
    world.intersectionsWithShape(pos,0,new RAPIER.Ball(radius),()=>{hit=true;return false;},undefined,undefined,exclude?.collider);
    return hit;
  }
  function relocate(pos) {
    if(scripted)return false;
    if(player.state==='dead'||!Number.isFinite(pos.x)||!Number.isFinite(pos.y))return false;
    let blocked=false;
    world.intersectionsWithShape(pos,player.body.rotation(),player.collider.shape,()=>{blocked=true;return false;},undefined,undefined,player.collider);
    if(blocked)return false;
    aimAt(null);player.stop();player.body.setTranslation(pos,true);world.step(events);dispatchContacts();return true;
  }
  function aimAt(pos) {
    aim=null;walkTarget=null;blockedTime=0;route=[];routeSearch=null;routeCheck=0;walkStatus='idle';
    if(!pos||player.state==='dead')return;
    const p=player.body.translation();
    if(Math.hypot(pos.x-p.x,pos.y-p.y)>1e-6)aim=Math.atan2(pos.y-p.y,pos.x-p.x);
  }
  function walkTo(pos) {
    aimAt(null);
    if(!pos||player.state==='dead'||!Number.isFinite(pos.x)||!Number.isFinite(pos.y))return false;
    if(pathfinding&&occupied(pos,walkingShape.radius,player))return false;
    walkTarget={x:pos.x,y:pos.y};
    if(pathfinding)planWalk();else{route=[walkTarget];walkStatus='walking';}
    return true;
  }
  function planWalk(){
    aim=null;route=[];blockedTime=0;walkStatus='planning';player.stop();
    routeSearch=findRoute({...player.body.translation()},walkTarget,castWalk);
  }
  function remove(e) {
    const index=entities.indexOf(e);if(index<0)return;
    walkers.delete(e);
    for(const other of entities)other.contacts.delete(e);
    e.contacts.clear();byCollider.delete(e.collider.handle);world.removeRigidBody(e.body);
    e.body=null;e.collider=null;entities.splice(index,1);
  }
  const defaultPopulation=parade?1000:entities.length;
  function population(count) {
    if(scripted)return entities.length;
    aimAt(null);
    count=count||defaultPopulation;
    // Placement advances physics to refresh queries, so pause existing motion first.
    for(const e of entities)e.stop();
    for(const e of [...entities])if(e.role==='crowd'||(maskTest||stars)&&e!==player)remove(e);
    if(maskTest||stars){fieldPopulation(count-1);world.step(events);events.clear();return entities.length;}
    if(parade){
      // A fixed 50 × 40 arrangement leaves a central avenue and cross aisles.
      // Spaced slots need no rejection search or physics step per new resident.
      const total=Math.min(2000,Math.max(1,count))-1;
      for(let i=0;i<total;i++){
        const slot=Math.floor(i*2000/total),row=Math.floor(slot/50),column=slot%50;
        const side=column<25?-1:1,k=column%25;
        const x=side*(3+(k+.5)*1.5+Math.floor(k/5)*1.5+(row%2)*.35);
        const y=(row-19.5)*1.5+(Math.floor(row/10)-1.5)*2;
        addEntity({x,y,type:characterTypes[(row+column)%characterTypes.length].id,size:.65,
          angle:((row+column)%6)*Math.PI/3,role:'crowd'});
      }
      world.step(events);dispatchContacts();
      return entities.filter(e=>e.state!=='dead').length;
    }
    // Reproducible rejection placement: no resident is born intersecting a neighbour.
    const random=createRandom(173);
    world.step(events);events.clear();
    let remaining=count-entities.filter(e=>e.state!=='dead').length;
    for(let attempts=0;remaining>0&&attempts<20000;attempts++) {
      const spread=Math.max(1,Math.sqrt(count/300));
      const p={x:(random()-.5)*20*spread,y:(random()-.5)*16*spread};
      if(occupied(p,.26))continue;
      addEntity({...p,type:characterTypes[Math.floor(random()*characterTypes.length)].id,size:.5,angle:random()*Math.PI*2,role:'crowd'});
      remaining--;world.step(events);dispatchContacts();
    }
    return entities.filter(e=>e.state!=='dead').length;
  }
  let touching=false;
  function setWandering(enabled) {
    wandering=enabled;
    if(!enabled)for(const e of walkers.keys())e.stop();
  }
  function setPathfinding(enabled){
    pathfinding=Boolean(enabled);
    const target=walkTarget;aimAt(null);player.stop();
    if(target)walkTo(target);
  }
  function setResidentKilling(enabled){
    residentKilling=Boolean(enabled);
    for(const e of walkers.keys())e.setInteraction(residentKilling?'kill':'touch');
  }
  // The studio supplies intentions; Character.move and Rapier still own all motion.
  function wander(dt,initiators) {
    if(!wandering)return;
    for(const [e,walk] of walkers){
      if(e.state==='dead')continue;
      const angle=e.body.rotation(),c=Math.cos(angle),s=Math.sin(angle);
      if(!walk.escape){
        let x=0,y=0;
        world.intersectionsWithShape(e.body.translation(),0,walk.nearby,other=>{
          // Killing residents may approach each other; walls still repel them.
          const target=byCollider.get(other.handle);
          if(residentKilling&&target instanceof Character&&target!==player)return true;
          const contact=e.collider.contactCollider(other,.06);
          if(contact){x-=contact.normal1.x;y-=contact.normal1.y;}
          return true;
        },undefined,undefined,e.collider);
        const length=Math.hypot(x,y);
        if(length>.01){
          // Leave room before turning, so a long, thin body can clear the obstacle.
          walk.escape={x:x/length,y:y/length,time:.45};
          walk.heading=Math.atan2(y,x)+(walkRandom()-.5)*.8;
          walk.time=2+walkRandom()*3;
        }
      }
      if(walk.escape){
        const {x,y}=walk.escape;
        e.move({forward:.6*(c*x+s*y),side:.6*(-s*x+c*y)});
        walk.escape.time-=dt;if(walk.escape.time<=0)walk.escape=null;
      }else{
        walk.time-=dt;
        if(walk.time<=0){walk.heading+=(walkRandom()-.5)*2.4;walk.time=2+walkRandom()*3;}
        const delta=Math.atan2(Math.sin(walk.heading-angle),Math.cos(walk.heading-angle));
        e.move({forward:.65*Math.max(0,Math.cos(delta)),turn:Math.max(-1,Math.min(1,delta*2.5))});
      }
      initiators.add(e);
    }
  }
  function dispatchContacts(initiators=new Set()) {
    events.drainCollisionEvents((a,b,started)=>{
      const first=byCollider.get(a),second=byCollider.get(b);
      if(!first||!second)return;
      // Each scripted/input-driven actor owns its own intent. Collider order
      // never selects who attacks, and stationary targets cannot retaliate.
      if(first instanceof Character)first.onCollision(second,started,initiators.has(first)?first:null);
      if(second instanceof Character)second.onCollision(first,started,initiators.has(second)?second:null);
    });
  }
  function step(input={forward:0,side:0,turn:0},dt=1/60) {
    if(scripted){
      // Keep the cast deterministic while the viewer moves the camera freely.
      player.move({...input,speed:1});
      const p=player.body.translation(),drive=player.drive;
      const next={x:p.x+drive.x*dt,y:p.y+drive.y*dt};
      if((drive.x||drive.y)&&!occupied(next,.1,player))player.body.setTranslation(next,true);
      if(drive.angular)player.body.setRotation(player.body.rotation()+drive.angular*dt,true);
      return;
    }
    const controls={...input};
    if(input.forward||input.side||input.turn||player.state==='dead')aimAt(null);
    const before=walkTarget?player.body.translation():null;
    if(walkTarget){
      if(routeSearch){
        const result=routeSearch.next();
        if(result.done){
          routeSearch=null;route=result.value??[];routeCheck=0;
          if(route.length)walkStatus='walking';
          else{aimAt(null);walkStatus='blocked';}
        }
      }
      if(route.length){
        if(Math.hypot(route[0].x-before.x,route[0].y-before.y)<.025){route.shift();routeCheck=0;}
        if(!route.length)aimAt(null);
        else{
          routeCheck-=dt;
          if(pathfinding&&routeCheck<=0){
            routeCheck=.2;
            if(castWalk(before,route[0]))planWalk();
          }
          if(route.length){
            const dx=route[0].x-before.x,dy=route[0].y-before.y,distance=Math.hypot(dx,dy);
            aim=Math.atan2(dy,dx);
            const delta=aim-player.body.rotation();
            // Turn before advancing, including at planned corners.
            controls.forward=Math.cos(delta)>.995?Math.min(1,distance*6):0;
          }
        }
      }
    }
    if(aim!==null){
      const delta=Math.atan2(Math.sin(aim-player.body.rotation()),Math.cos(aim-player.body.rotation()));
      if(Math.abs(delta)<.001)aim=null;
      else controls.turn=Math.max(-3,Math.min(3,delta*12));
    }
    const initiators=new Set();
    if(controls.forward||controls.side||controls.turn)initiators.add(player);
    player.move({...controls,speed:1});
    wander(dt,initiators);
    world.step(events);
    dispatchContacts(initiators);
    touching=false;
    if(player.state!=='dead')world.contactPairsWith(player.collider,c=>world.contactPair(player.collider,c,m=>{if(m.numSolverContacts()>0)touching=true;}));
    if(walkTarget){
      const after=player.body.translation();
      blockedTime=touching&&Math.hypot(after.x-before.x,after.y-before.y)<.001?blockedTime+dt:0;
      if(player.state==='dead'){aimAt(null);player.stop();}
      else if(blockedTime>.3){
        if(pathfinding)planWalk();
        else{aimAt(null);player.stop();walkStatus='blocked';}
      }
    }
  }
  world.step(events);events.clear();
  if(parade&&!scripted)population(1000);
  return {get world(){return world;},events,player,entities,walls,outline:layout==='house'?outline:null,bounds,home,layout,byCollider,step,relocate,aimAt,walkTo,occupied,population,remove,setWandering,setPathfinding,setResidentKilling,setScriptActors,applyScriptFrame,seekScript,get pathfinding(){return pathfinding;},get residentKilling(){return residentKilling;},get walkTarget(){return walkTarget;},get walkStatus(){return walkStatus;},get wandering(){return wandering;},get touching(){return touching;},dispose(){events.free();world.free();}};
}
export {RAPIER};
