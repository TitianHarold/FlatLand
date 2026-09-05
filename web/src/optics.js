import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';

// Shared optics: world-space boundaries -> a one-dimensional light image.
// No role definitions, behavior, physics, or browser APIs belong here.
export const DEFAULT_FOV = Math.PI / 2;
export const OPTICS_RULES = Object.freeze({
  // Emission is a shared material rule, never a per-character attribute.
  // The house ratio is provisional until the room study adopts these rules.
  materials:Object.freeze({
    resident:Object.freeze({emission:1}),
    house:Object.freeze({emission:.5,color:PAINT_STYLES[DEFAULT_PAINT_STYLE].wall}),
  }),
  fog:.0001,attenuationDistance:10,attenuationFloor:.25,attenuationCurve:'smooth',
  attenuationMode:'brightness',environmentColor:'#F7F1DC',
  contour:3,contourFloor:.45,detailGain:1,exposure:12,glow:true,coloring:false,finish:'original',
});

// Display-space tint: expose scalar light once, then retain these channel ratios.
export function opticalTint(color='#ffffff') {
  if(!/^#[\da-f]{6}$/i.test(color))throw new RangeError(`Invalid optical color: ${color}`);
  return [1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255);
}

// Derive the contrast scale from geometry, including irregular polygons.
// Area centroid makes this independent of extra collinear outline vertices.
function contourRadius(points) {
  if(points.length===2) {
    const radius=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/2;
    if(radius===0)throw new RangeError('Optical segments must have nonzero length');
    return radius;
  }
  let area=0,x=0,y=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length], cross=a.x*b.y-b.x*a.y;
    area+=cross;x+=(a.x+b.x)*cross;y+=(a.y+b.y)*cross;
  }
  if(area===0)throw new RangeError('Optical boundaries must enclose a nonzero area');
  x/=3*area;y/=3*area;
  return Math.max(...points.map(p=>Math.hypot(p.x-x,p.y-y)));
}

// Shared surface photometry for both the one-dimensional image and a world
// overview. Distances are always measured from the resident's XY position.
export function boundaryLighting(body, observer={}, rules=OPTICS_RULES) {
  const {x=0,y=0}=observer, materials=rules.materials??OPTICS_RULES.materials;
  const emission=Object.hasOwn(materials,body.material)?materials[body.material]?.emission:undefined;
  if(!Number.isFinite(emission)||emission<0)throw new RangeError(`Missing or invalid optical material rule: ${body.material}`);
  // Disconnected pieces may belong to one optical object (a house's walls).
  // Its outline supplies the same geometry scale used for a single polygon;
  // only its actual boundaries determine the nearest point and occlusion.
  const points=(body.object?.outline??body.vertices).map(p=>({x:p.x-x,y:p.y-y}));
  let nearest=Infinity, farthest=0;
  for(const vertices of body.object?.boundaries??[body.vertices]){
    const boundary=vertices.map(p=>({x:p.x-x,y:p.y-y}));
    for(let i=0;i<boundary.length;i++) {
      const a=boundary[i], b=boundary[(i+1)%boundary.length], dx=b.x-a.x, dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,-(a.x*dx+a.y*dy)/(dx*dx+dy*dy)));
      nearest=Math.min(nearest,Math.hypot(a.x+t*dx,a.y+t*dy));
      farthest=Math.max(farthest,Math.hypot(a.x,a.y));
    }
  }
  const strength=rules.contour??OPTICS_RULES.contour;
  return {emission,nearest,farthest,radius:strength>0?contourRadius(points):1,strength};
}

// Observer-centred reception mask, in absolute world units. A zero range
// disables it. Studio mask mode reaches zero there; legacy study modes use
// this distance as the halfway point between 1 and their retained floor.
// This is a display reception rule, not an inverse-square radiometric law.
export function distanceAttenuation(distance, {attenuationDistance=OPTICS_RULES.attenuationDistance,
  attenuationFloor=OPTICS_RULES.attenuationFloor,attenuationCurve=OPTICS_RULES.attenuationCurve,attenuationMode=OPTICS_RULES.attenuationMode}={}) {
  if(attenuationDistance===0)return 1;
  const x=Math.max(0,distance)/attenuationDistance;
  if(attenuationMode==='mask'){
    if(x>=1)return 0;
    let curve;
    switch(attenuationCurve){
      case 'linear':curve=1-x;break;
      case 'exponential':curve=(Math.exp(-4*x)-Math.exp(-4))/(1-Math.exp(-4));break;
      case 'quadratic':curve=1-x*x;break;
      // Softened inverse square, with a smooth zero at the selected range.
      case 'inverse-square':curve=(1-x*x)**2/(1+16*x*x);break;
      default:curve=1-x*x*(3-2*x);
    }
    return curve;
  }
  let remaining;
  switch(attenuationCurve){
    case 'linear':remaining=Math.max(0,1-x/2);break;
    case 'exponential':remaining=2**(-x);break;
    case 'quadratic':remaining=Math.max(0,1-x*x/2);break;
    default:remaining=1/(1+x*x);
  }
  return attenuationFloor+(1-attenuationFloor)*remaining;
}

export function surfaceLight(distance, shape, rules=OPTICS_RULES) {
  const fog=rules.fog??OPTICS_RULES.fog;
  const contourFloor=rules.contourFloor??OPTICS_RULES.contourFloor;
  const localDepth=shape.strength>0?shape.strength*Math.max(0,distance-shape.nearest)/shape.radius:0;
  const reception=rules.visionEffect==='scatter'&&rules.attenuationMode==='mask'
    ?Number(!rules.attenuationDistance||distance<rules.attenuationDistance):distanceAttenuation(distance,rules);
  const gain=rules.detailGain??1;
  let detail=1;
  if(gain>0&&shape.strength>0){
    if(rules.detailStyle==='soft'||rules.detailStyle==='velvet'){
      const t=Math.min(1,localDepth/3),smooth=t*t*(3-2*t);
      const base=1-(1-contourFloor)*smooth;
      // Broad transitions retain depth without a narrow mirror-like highlight.
      detail=rules.detailStyle==='velvet'?.65*base**(gain/4):base**(gain/2);
    }else detail=(contourFloor+(1-contourFloor)*Math.exp(-localDepth))**gain;
  }
  // Intrinsic emission and medium transmission form light. Absolute-distance
  // reception and relative-depth detail are independent display masks. Only
  // detail uses the object's nearest point; reception must never normalize it.
  // In wash mode, distance controls colour concentration instead of multiplying
  // a dark mask into the surface. Fog absorption and local depth remain separate.
  return {light:shape.emission*Math.exp(-fog*distance),reception,
    contrast:detail*(['wash','mask'].includes(rules.attenuationMode)?1:reception)};
}

export function exposeLight({light,contrast=1}, {exposure=OPTICS_RULES.exposure,finish=OPTICS_RULES.finish}={}) {
  const value=light*exposure/(1+light*exposure);
  // Clear colour fields: tone-map intensity first, apply a softer depth cue
  // before display encoding, then encode once. This avoids multiplying dark
  // masks into already encoded colour. The .7 exponent is an artistic depth
  // compression, not a scattering/reflectance law. Exposure cannot erase it.
  const linear=finish==='clear'?value*Math.max(0,contrast)**.7:value;
  const srgb=linear<=.0031308?12.92*linear:1.055*linear**(1/2.4)-.055;
  if(finish==='clear')return Math.round(srgb*255);
  // Retain the previous display-space cue in the two comparison modes.
  let brightness=srgb*contrast;
  if(finish==='matte'){
    const highlight=Math.max(0,brightness-.55);
    brightness=brightness-highlight+highlight/(1+1.5*highlight);
  }
  return Math.round(brightness*255);
}

// Integrate visible angular intervals, including fractions of a pixel. A thin
// distant body must not disappear just because no pixel-centre ray hits it.
// bodies: [{material:'resident'|'house', vertices:[{x,y}, ...]}]. Vertices describe
// opaque segments or simple polygons, nonintersecting, in world coordinates. Supply only
// other visible bodies: the caller excludes the observer's own boundary.
// Parts of one object can share {object:{outline, boundaries}}. This groups
// photometry only: every part still projects its actual vertices independently.
// Optional paintedEdges:[{a,b,color:'#RRGGBB'}] subdivides this same boundary
// for paint only. rules.coloring=false always uses the original vertices.
// observer: {x,y,heading,fov,projection}; heading 0 faces +Y, positive turns toward +X.
// projection: 'perspective' (default) or 'equidistant' (equal angle per pixel).
// Every observer in a scene receives the same rules object; inputs are read-only.
export function projectScene(bodies, width, {observer={},rules=OPTICS_RULES}={}) {
  const {x=0,y=0,heading=0,fov=DEFAULT_FOV,projection='perspective'}=observer;
  if(!['perspective','equidistant'].includes(projection))throw new RangeError(`Unknown optical projection: ${projection}`);
  if(!Number.isFinite(fov)||fov<=0||fov>=Math.PI)throw new RangeError('Optical field of view must be between 0 and pi radians');
  const contour=rules.contour??OPTICS_RULES.contour;
  const light=new Float64Array(width), contrast=new Float64Array(width), events=[], tan=Math.tan(fov/2);
  const spread=new Float64Array(width);
  const reception=rules.attenuationMode==='mask'?new Float64Array(width):null;
  const color=rules.coloring?new Float64Array(width*3):null;
  const environment=color&&rules.attenuationMode==='wash'?opticalTint(rules.environmentColor??OPTICS_RULES.environmentColor):null;
  const c=Math.cos(heading), s=Math.sin(heading);
  const projected=p=>projection==='equidistant'?(Math.atan2(p.x,p.y)/fov+.5)*width:(p.x/p.y/tan+1)*width/2;
  const slopeAt=pixel=>projection==='equidistant'?Math.tan((2*pixel/width-1)*fov/2):(2*pixel/width-1)*tan;
  const objects=new Map();
  bodies.forEach((body,id) => {
    const transform=p=>({x:c*(p.x-x)-s*(p.y-y),y:s*(p.x-x)+c*(p.y-y)});
    const edges=color&&body.paintedEdges?body.paintedEdges:body.vertices.map((a,i)=>({a,b:body.vertices[(i+1)%body.vertices.length]}));
    const key=body.object??body;
    if(!objects.has(key))objects.set(key,{shape:boundaryLighting(body,observer,rules),material:body.material,left:width,right:0});
    const object=objects.get(key),{shape}=object;
    if(object.material!==body.material)throw new RangeError('Parts of one optical object must share a material');
    for(const painted of edges) {
      let a=transform(painted.a), b=transform(painted.b);
      // Clip at the eye before dividing by depth; a turned camera can put
      // either end of a crowd edge behind it.
      if(a.y<=.001&&b.y<=.001) continue;
      if(a.y<.001||b.y<.001) {
        const t=(.001-a.y)/(b.y-a.y), cut={x:a.x+t*(b.x-a.x),y:.001};
        if(a.y<.001)a=cut;else b=cut;
      }
      const u=projected(a), v=projected(b);
      const left=Math.max(0,Math.min(u,v)), right=Math.min(width,Math.max(u,v));
      if(right-left<1e-10)continue;
      object.left=Math.min(object.left,left);object.right=Math.max(object.right,right);
      const dx=b.x-a.x, dy=b.y-a.y;
      const tint=color?opticalTint(painted.color??(rules.materials??OPTICS_RULES.materials)[body.material]?.color):null;
      const edge={id, shape, tint, dx,dy,numerator:a.x*dy-a.y*dx};
      events.push({at:left,edge,enter:true},{at:right,edge,enter:false});
    }
  });
  for(const {shape,left,right} of objects.values()){
    // Optional perceptual aid, separate from physical fog. Emphasize relative
    // depth while a contour is resolved, then smoothly release that contrast
    // between eight and one pixels. Subpixel stars retain their original light.
    const resolved=Math.max(0,Math.min(1,(right-left-1)/7));
    const detail=resolved*resolved*(3-2*resolved);
    shape.strength=contour*detail;
    shape.spread=1-detail;
  }
  events.sort((a,b)=>a.at-b.at);
  const active=new Set(), visible=new Set();
  let previous=0, coverage=0;
  const depth=(edge,pixel)=>edge.numerator/(slopeAt(pixel)*edge.dy-edge.dx);
  for(let i=0;i<events.length;) {
    const next=events[i].at;
    if(next>previous&&active.size) {
      let nearest=null, best=Infinity;
      for(const edge of active) {
        const d=depth(edge,(previous+next)/2);
        if(d>0&&d<best){best=d;nearest=edge;}
      }
      if(nearest) {
        visible.add(nearest.id);coverage+=next-previous;
        // Nonintersecting edges cannot swap depth order inside this interval.
        // ponytail: brightness uses one midpoint per pixel fragment; subdivide
        // within a pixel if highly varying media are introduced later.
        for(let start=previous;start<next;) {
          const pixel=Math.floor(start), end=Math.min(next,pixel+1);
          const mid=(start+end)/2, slope=slopeAt(mid);
          const distance=depth(nearest,mid)*Math.hypot(slope,1);
          const sample=surfaceLight(distance,nearest.shape,rules),energy=sample.light*(end-start);
          light[pixel]+=energy;
          contrast[pixel]+=energy*sample.contrast;
          if(reception)reception[pixel]+=energy*sample.reception;
          spread[pixel]+=energy*nearest.shape.spread;
          if(color)for(let channel=0;channel<3;channel++){
            // An opaque surface approaches a chosen environmental hue. This is
            // artistic colour dilution, not transparency or scattered light.
            const tint=environment?sample.reception*nearest.tint[channel]+(1-sample.reception)*environment[channel]:nearest.tint[channel];
            color[pixel*3+channel]+=energy*sample.contrast*tint;
          }
          start=end;
        }
      }
    }
    while(i<events.length&&events[i].at===next) {
      const event=events[i++];
      if(event.enter)active.add(event.edge);else active.delete(event.edge);
    }
    previous=next;
  }
  for(let x=0;x<width;x++){
    contrast[x]=light[x]>0?contrast[x]/light[x]:1;
    spread[x]=light[x]>0?spread[x]/light[x]:0;
    if(reception)reception[x]=light[x]>0?reception[x]/light[x]:0;
  }
  return {light,contrast,spread,coverage,visibleCount:visible.size,...(color?{color}:{}),...(reception?{reception}:{})};
}

// A normalized optical spread lets nearby visible lights combine before
// exposure. It never bypasses scene occlusion and adds no light to empty space.
// On a hit, use that pixel's own geometry cue so light spread cannot erase a
// narrow receding side. In empty pixels the halo inherits its sources' cue.
// Color accumulates visible, shaded source weights through that same spread;
// scalar exposure is applied once, then multiplied by the resulting tint.
export function exposeRow({light,contrast,spread,color,reception}, {exposure=OPTICS_RULES.exposure,glow=OPTICS_RULES.glow,coloring=OPTICS_RULES.coloring,finish=OPTICS_RULES.finish}={}) {
  const weights=glow?[.78,.075,.03,.005]:[1];
  // Matte and clear resolved boundaries keep their light in place. Point sources retain
  // the normalized spread, with a smooth transition from one to eight pixels.
  const weight=(source,d)=>{
    const amount=finish==='original'?1:(spread?.[source]??1);
    return d===0?1-(1-weights[0])*amount:weights[d]*amount;
  };
  const pixels=new Uint8ClampedArray(light.length*4);
  for(let x=0;x<light.length;x++) {
    let energy=weight(x,0)*light[x];
    let shadedEnergy=energy*(contrast?.[x]??1);
    let maskedEnergy=energy*(reception?.[x]??1);
    for(let d=1;d<weights.length;d++) {
      const left=light[x-d]??0, right=light[x+d]??0;
      const leftEnergy=weight(x-d,d)*left,rightEnergy=weight(x+d,d)*right;
      energy+=leftEnergy+rightEnergy;
      maskedEnergy+=leftEnergy*(reception?.[x-d]??1)+rightEnergy*(reception?.[x+d]??1);
      shadedEnergy+=leftEnergy*(contrast?.[x-d]??1)+rightEnergy*(contrast?.[x+d]??1);
    }
    const shade=light[x]>0?(contrast?.[x]??1):energy>0?shadedEnergy/energy:1;
    // The observer's mask multiplies the finished colour, after exposure.
    const gray=exposeLight({light:energy,contrast:shade},{exposure,finish})*(reception&&energy>0?maskedEnergy/energy:1);
    for(let channel=0;channel<3;channel++){
      let tint=1;
      if(coloring&&color&&shadedEnergy>0){
        let colored=weight(x,0)*color[x*3+channel];
        for(let d=1;d<weights.length;d++)colored+=weight(x-d,d)*(color[(x-d)*3+channel]??0)+weight(x+d,d)*(color[(x+d)*3+channel]??0);
        tint=colored/shadedEnergy;
      }
      pixels[x*4+channel]=Math.round(gray*tint);
    }
    pixels[x*4+3]=255;
  }
  return pixels;
}
