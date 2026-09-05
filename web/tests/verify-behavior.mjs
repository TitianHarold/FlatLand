import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation} from '../src/world.js';
import {updateDeathEffect} from '../src/death-effect.js';

for(const enabled of [false,true]){
  const sim=await createSimulation({layout:'stars',wandering:false});
  const actor=sim.entities[1],target=sim.entities[2],playerMode=sim.player.interaction;
  assert(!sim.residentKilling&&!sim.pathfinding);
  for(const e of [...sim.entities])if(![sim.player,actor,target].includes(e))sim.remove(e);
  sim.relocate({x:-3,y:3});
  actor.body.setTranslation({x:-1,y:0},true);actor.body.setRotation(0,true);
  target.body.setTranslation({x:1,y:0},true);target.body.setRotation(Math.PI,true);sim.step();
  sim.setResidentKilling(enabled);assert.equal(sim.player.interaction,playerMode,'NPC mode does not change observer permissions');
  for(let i=0;i<300&&target.state!=='dead';i++){actor.move({forward:1});sim.step();}
  assert.equal(target.state,enabled?'dead':'alive','NPC contact follows its own killing switch');
  assert.equal(actor.state,'alive','A stationary victim cannot retaliate');
  if(enabled)assert(!target.body.isEnabled(),'A killed character immediately leaves physics');
  sim.population(14);
  assert(sim.entities.filter(e=>e!==sim.player).every(e=>e.interaction===(enabled?'kill':'touch')),'New residents inherit the current setting');
  sim.setResidentKilling(false);assert(sim.entities.filter(e=>e!==sim.player).every(e=>e.interaction==='touch'),'Turning NPC killing off applies to every resident');
  sim.dispose();
}

const character={state:'alive',deathCause:null,size:1};
function fixture(){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([.3,-.3,0,.3,.3,0,.3,-.3,.05,.3,.3,0,.3,.3,.05,.3,-.3,.05],3));
  for(const [key,y] of [['edgeStart',-.3],['edgeEnd',.3]])geometry.setAttribute(key,new THREE.Float32BufferAttribute(Array.from({length:6},()=>[.3,y]).flat(),2));
  const material=new THREE.ShaderMaterial({uniforms:{fade:{value:1}}});
  const mesh=new THREE.Mesh(geometry,material);mesh.add(new THREE.Mesh(geometry.clone(),material));return mesh;
}
const mesh=fixture(),original=mesh.geometry.attributes.position.array.slice();
assert(updateDeathEffect(mesh,character,0,true));assert(!mesh.userData.death,'Live characters allocate no fragments');
character.state='dead';character.deathCause='killed';
assert(updateDeathEffect(mesh,character,100,true));
assert(updateDeathEffect(mesh,character,400,true));
assert(mesh.geometry.attributes.position.getX(0)>original[0]+.4,'Edges break away from the body centre');
assert.equal(mesh.geometry.attributes.position.getX(0),mesh.geometry.attributes.edgeStart.getX(0),'Optical endpoints move together with fragment geometry');
assert.equal(mesh.children[0].geometry.attributes.position.getX(0),mesh.geometry.attributes.position.getX(0),'Outline and 3D fragments stay together');
assert.equal(mesh.material.uniforms.fade.value,.5);assert(!mesh.material.depthWrite,'Fading fragments cannot keep occluding the scene');
assert(!updateDeathEffect(mesh,character,700,true));assert(!mesh.userData.death,'Finished fragments release animation buffers');
assert(!updateDeathEffect(mesh,character,800,true),'Finished corpses never replay the animation');
const disabled=fixture();assert(!updateDeathEffect(disabled,character,0,false),'Disabled animation disappears immediately');
assert(!updateDeathEffect(disabled,character,1,true),'Enabling animation does not replay old deaths');
const interrupted=fixture();assert(updateDeathEffect(interrupted,character,0,true));assert(!updateDeathEffect(interrupted,character,100,false));assert(!interrupted.userData.death,'Disabling an active effect immediately clears it');
for(const root of [mesh,disabled,interrupted]){root.geometry.dispose();root.children[0].geometry.dispose();root.material.dispose();}
console.log('Behavior checks passed: independent NPC kills, population inheritance, fragment motion/fade, disabled effects and cleanup.');
