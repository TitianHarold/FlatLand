import {projectScene, exposeRow, OPTICS_RULES, DEFAULT_FOV} from './optics.js';
import {PAINT_STYLES} from './paint.js';

// Scene appearance changes only. Use the same operation for existing residents
// and newly added instances; neither physics nor optical intensity is reset.
export function setScenePaintStyle(entities,rules,styleId) {
  const style=PAINT_STYLES[styleId];
  if(!style)throw new RangeError(`Unknown paint style: ${styleId}`);
  for(const character of entities)character.setPaintStyle(styleId);
  const materials=rules.materials??OPTICS_RULES.materials;
  rules.materials={...materials,house:{...materials.house,color:style.wall}};
  rules.paintStyle=styleId;
}

// One pose and one left-to-right screen convention for the image and its guides.
export function observerFor(character,fov=DEFAULT_FOV,projection='perspective') {
  return {...character.body.translation(),heading:Math.PI/2-character.body.rotation(),fov,projection};
}

export function sightDirection(observer, screenX, screenY=.5, aspect=1) {
  const offset=2*screenX-1;
  let slope=offset*Math.tan(observer.fov/2);
  if(observer.projection==='equidistant'){
    const radius=Math.hypot(offset,(2*screenY-1)/aspect),theta=radius*observer.fov/2;
    if(theta>=Math.PI/2)return null;
    slope=radius>0?Math.tan(theta)*offset/radius:0;
  }
  const length=Math.hypot(slope,1);
  const c=Math.cos(observer.heading),s=Math.sin(observer.heading);
  return {x:(c*slope+s)/length,y:(c-s*slope)/length};
}

export function worldVertices(vertices, position, angle) {
  const c=Math.cos(angle), s=Math.sin(angle);
  return vertices.map(p=>({x:position.x+c*p.x-s*p.y,y:position.y+s*p.x+c*p.y}));
}

// Thick walls overlap at corners and junctions. Insert their crossing points so
// each projected interval has a stable depth order, as shared optics requires.
// Keep each complete outline: splitting it into separate objects would change
// its contour radius and therefore its lighting. Static walls are prepared once.
function splitWallCrossings(boundaries) {
  const outlines=boundaries.map(body=>body.vertices.map((a,i)=>({a,b:body.vertices[(i+1)%body.vertices.length],cuts:[0]})));
  const edges=outlines.flat(), cross=(a,b)=>a.x*b.y-a.y*b.x;
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++) {
    const a=edges[i], b=edges[j];
    const r={x:a.b.x-a.a.x,y:a.b.y-a.a.y}, s={x:b.b.x-b.a.x,y:b.b.y-b.a.y};
    const denominator=cross(r,s);
    if(Math.abs(denominator)<1e-12)continue;
    const offset={x:b.a.x-a.a.x,y:b.a.y-a.a.y};
    const t=cross(offset,s)/denominator, u=cross(offset,r)/denominator;
    if(t<0||t>1||u<0||u>1)continue;
    if(t>1e-9&&t<1-1e-9)a.cuts.push(t);
    if(u>1e-9&&u<1-1e-9)b.cuts.push(u);
  }
  return boundaries.map((body,i)=>({...body,vertices:outlines[i].flatMap(({a,b,cuts})=>
    cuts.sort((x,y)=>x-y).filter((t,j)=>j===0||t-cuts[j-1]>1e-9)
      .map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}))
  )}));
}

// Studio adapter: the simulation supplies geometry and pose; optics owns every
// light rule. Invisible exploration limits and the observer's body emit no image.
export function houseBoundaries(sim) {
  const walls=splitWallCrossings(sim.walls.map(({collider})=>{
    const {x,y}=collider.halfExtents();
    return {material:'house',vertices:worldVertices([
      {x:-x,y:-y},{x,y:-y},{x,y},{x:-x,y},
    ],collider.translation(),collider.rotation())};
  }));
  if(sim.outline&&walls.length){
    const object={outline:sim.outline,boundaries:walls.map(w=>w.vertices)};
    for(const wall of walls)wall.object=object;
  }
  return walls;
}

export function createSight(sim, walls=houseBoundaries(sim)) {
  return function render(width, rules=OPTICS_RULES, observer=observerFor(sim.player)) {
    const bodies=[...walls];
    for(const e of sim.entities)if(e!==sim.player&&e.state!=='dead') {
      const position=e.body.translation(),angle=e.body.rotation();
      bodies.push({material:'resident',vertices:worldVertices(e.vertices,position,angle),
        ...(rules.coloring&&e.paintedEdges?{paintedEdges:e.paintedEdges.map(({a,b,color})=>{
          const [start,end]=worldVertices([a,b],position,angle);return {a:start,b:end,color};
        })}:{})});
    }
    return exposeRow(projectScene(bodies,width,{observer,rules}),rules);
  };
}
