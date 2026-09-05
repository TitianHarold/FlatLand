// Reuse each painted edge as a fragment; allocate only when a kill is displayed.
// Returns whether the character should still be drawn this frame.
export function updateDeathEffect(mesh,character,now,enabled,startedAt=now){
  if(character.state!=='dead')return true;
  if(!mesh.userData.deathSeen){
    mesh.userData.deathSeen=true;
    if(enabled&&character.deathCause==='killed'){
      const parts=[mesh,...mesh.children].map(part=>({part,original:Object.fromEntries(
        ['position','adjacent','edgeStart','edgeEnd'].filter(key=>part.geometry.hasAttribute(key)).map(key=>[key,part.geometry.getAttribute(key).array.slice()]))}));
      mesh.userData.death={started:startedAt,parts};
      mesh.material.transparent=true;mesh.material.depthWrite=false;
      for(const {part} of parts)part.frustumCulled=false;
    }
  }
  const effect=mesh.userData.death;
  if(!enabled||!effect||now-effect.started>=600){delete mesh.userData.death;return false;}
  const progress=Math.max(0,(now-effect.started)/600),spread=1-(1-progress)**2;
  for(const {part,original} of effect.parts){
    const starts=original.edgeStart,ends=original.edgeEnd;
    for(let i=0;i<starts.length/2;i++){
      const x=(starts[i*2]+ends[i*2])/2,y=(starts[i*2+1]+ends[i*2+1])/2,length=Math.hypot(x,y)||1;
      const dx=x/length*character.size*.6*spread,dy=y/length*character.size*.6*spread;
      for(const [key,values] of Object.entries(original)){
        const attribute=part.geometry.getAttribute(key),offset=i*attribute.itemSize;
        attribute.setXY(i,values[offset]+dx,values[offset+1]+dy);
      }
    }
    for(const key of Object.keys(original))part.geometry.getAttribute(key).needsUpdate=true;
  }
  mesh.material.uniforms.fade.value=1-progress;
  return true;
}
