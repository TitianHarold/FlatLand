import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';

// Scene fixtures, not character definitions or optical rules.
export const MASK_FIELD={rings:40,spacing:5,count(ring){return Math.max(6,Math.round(48*ring/this.rings));}};
export const STUDY_SHAPES=[
  {name:'三角形',label:'03',shape:3},
  {name:'四边形',label:'04',shape:4},
  {name:'五边形',label:'05',shape:5},
  {name:'六边形',label:'06',shape:6},
  {name:'七边形',label:'07',shape:7},
  {name:'线段',label:'—',shape:2},
  {name:'圆形',label:'○',shape:'circle'},
];

export function resident(shape, {x=0,y=6,radius=1,angle=0}={}) {
  // A circle uses a fine boundary approximation for shared polygon optics.
  // Rotation cannot change a circle, so keep its sampling phase fixed.
  const sides=shape==='circle'?256:shape;
  if(shape==='circle')angle=0;
  return {material:'resident',vertices:Array.from({length:sides},(_,i)=>{
    const a=angle-Math.PI/2+i*2*Math.PI/sides;
    return {x:x+Math.cos(a)*radius,y:y+Math.sin(a)*radius};
  })};
}

// Paint is fixture data; every sample still uses the same resident emission.
export function paintResident(body,index=0,paintStyle=DEFAULT_PAINT_STYLE) {
  const palette=PAINT_STYLES[paintStyle].residents;
  const colors=palette[index%palette.length],vertices=body.vertices;
  const points=vertices.length===2?[vertices[0],{
    x:(vertices[0].x+vertices[1].x)/2,y:(vertices[0].y+vertices[1].y)/2,
  },vertices[1]]:vertices;
  const count=vertices.length===2?2:points.length;
  return {...body,paintedEdges:Array.from({length:count},(_,i)=>({
    a:points[i],b:points[(i+1)%points.length],color:colors[vertices.length>32?0:i%colors.length],
  }))};
}

// A compact optical target, not a city: opaque back panels, rotating foreground
// polygons and thin near segments. All geometries remain disjoint at d >= 3.
export function makeColorField({angle=0,distance=6,details=true,paintStyle=DEFAULT_PAINT_STYLE}={}) {
  const scale=distance/6,palettes=PAINT_STYLES[paintStyle].residents;
  const palette=i=>palettes[i%palettes.length];
  const colors=[palette(0)[1],palette(0)[2],palette(2)[0],palette(1)[0],palette(0)[0],palette(1)[1],'#F7EDCE'];
  const segment=(left,right,y,color)=>{
    const a={x:left,y},b={x:right,y};
    return {material:'house',vertices:[a,b],paintedEdges:[{a,b,color}]};
  };
  const bodies=colors.map((color,i)=>segment(-12+i*24/7,-12+(i+1)*24/7,9*scale,color));
  for(let i=0;i<5;i++)bodies.push(paintResident(resident(i+3,{x:(i-2)*1.5,y:4.5*scale,radius:.35,angle}),i,paintStyle));
  if(details)for(let i=0;i<12;i++){
    const x=-2.6+i*.47;
    bodies.push(segment(x,x+(i%3===0?.024:.009),3.2*scale,i%3===0?'#263C63':'#FAF1D7'));
  }
  return bodies;
}

export function makeCrowd(count=240,{nearby=false}={}) {
  let seed=1904;
  const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const crowd=[];
  while(crowd.length<count) {
    const i=crowd.length, band=i/count;
    const angle=nearby&&band<.42?random()*Math.PI*2:band<.52?(-26+(random()+random()-1)*42)*Math.PI/180:
      band<.8?(94+(random()+random()-1)*32)*Math.PI/180:random()*Math.PI*2;
    // The studio includes sparse neighbours; the optical comparison keeps distant-only fixtures.
    const [start,span]=nearby&&band<.08?[4,20]:nearby&&band<.24?[24,104]:nearby&&band<.42?[128,1072]:[1200,1800];
    const distance=start+random()*span;
    const x=Math.sin(angle)*distance,y=Math.cos(angle)*distance;
    if(crowd.some(p=>Math.hypot(p.x-x,p.y-y)<2.1))continue;
    crowd.push({x,y,sides:3+i%7,angle:random()*Math.PI*2});
  }
  return crowd;
}
