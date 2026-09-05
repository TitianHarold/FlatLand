import * as THREE from 'three';
import {createSimulation, point, labels} from './world.js';
import {worldVertices, observerFor, sightDirection, houseBoundaries, setScenePaintStyle} from './sight.js';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';
import {OPTICS_RULES, boundaryLighting, surfaceLight, exposeLight, opticalTint} from './optics.js';
import './style.css';
import {connectStudio} from './studio-bridge.js';
import {createScatter} from './scatter.js';
import {formatLength} from './measure.js';
import {updateDeathEffect} from './death-effect.js';
import {parseStory,sampleStory} from './story-script.js';

const $=id=>document.getElementById(id);
const requestedLayout=new URLSearchParams(location.search).get('scene');
const scripted=new URLSearchParams(location.search).has('storyboard');
let storyCameraManual=false;
const layout=['parade','mask','stars'].includes(requestedLayout)?requestedLayout:'house';
const parade=layout==='parade',maskTest=layout==='mask',stars=layout==='stars',openScene=layout!=='house';
let sim;
try { sim=await createSimulation({layout,scripted}); }
catch(error){$('loading').textContent='物理世界加载失败，请刷新重试。';console.error(error);throw error;}
const container=$('scene'), renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
if(scripted){container.setAttribute('role','img');container.setAttribute('aria-label','故事画面');container.tabIndex=-1;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setClearColor('#000000');
container.appendChild(renderer.domElement);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(48,1,.002,20000);
const residentCamera=new THREE.PerspectiveCamera(48,1,camera.near,camera.far);
// Layer 1 contains the observer and overview annotations, never resident vision.
camera.layers.enable(1);camera.layers.enable(2);
scene.background=new THREE.Color('#000000');
const worldGroup=new THREE.Group();scene.add(worldGroup);
const overviewEye={value:new THREE.Vector2()};
const maskRadius={value:0};
const viewportSize={value:new THREE.Vector2(innerWidth,innerHeight)};
const viewportOrigin={value:new THREE.Vector2()};
const PLANE_HEIGHT=.032,shapeHeight=.05/3;
// X blends the zero-degree 3D view into a flat window; Y is its screen height.
const flatWindow={value:new THREE.Vector2(0,0)};
const receiving={value:new THREE.Vector2(0,Math.PI/3)},eyeForward={value:new THREE.Vector2(0,1)};
// A distance lookup texture carries shared optics' grayscale to each fragment.
// The GPU only looks up the result; it contains no second lighting formula.
function opticalMaterial(color) {
  const light=new THREE.DataTexture(new Uint8Array(128*4),128,1,THREE.RGBAFormat);
  light.minFilter=THREE.LinearFilter;light.magFilter=THREE.LinearFilter;
  const material=new THREE.ShaderMaterial({
    side:THREE.DoubleSide,
    uniforms:{eye:overviewEye,maskRadius,flatWindow,receiving,eyeForward,pixelRatio:{value:renderer.getPixelRatio()},clipPlanes:{value:new THREE.Vector2(camera.near,camera.far)},planeHeight:{value:PLANE_HEIGHT},shapeHeight:{value:shapeHeight},viewport:viewportSize,viewportOrigin,light:{value:light},range:{value:new THREE.Vector2()},fade:{value:1},coloring:{value:1},wash:{value:0},environment:{value:new THREE.Vector3()},tint:{value:new THREE.Vector3(...opticalTint(color))}},
    vertexShader:`attribute vec3 paint;attribute vec3 adjacent;attribute float stroke;attribute vec2 edgeStart;attribute vec2 edgeEnd;uniform vec2 viewport;uniform vec2 flatWindow;uniform vec2 receiving;uniform float planeHeight;uniform float shapeHeight;varying vec3 surfaceTint;varying vec2 worldXY;varying vec2 edgeA;varying vec2 edgeB;
      void main(){
        // Horizontal wall caps have no area in the resident's zero-degree view.
        // Their near-plane clipping must not create triangles outside the window.
        if(flatWindow.x>0.0&&abs(normal.z)>.5){gl_Position=vec4(0.0,0.0,2.0,1.0);return;}
        surfaceTint=paint;vec4 p=modelMatrix*vec4(position,1.0);vec4 a=modelMatrix*vec4(edgeStart,position.z,1.0),b=modelMatrix*vec4(edgeEnd,position.z,1.0);
        edgeA=a.xy;edgeB=b.xy;vec4 v=viewMatrix*p;
        // Clip each boundary edge at the eye before bending its projection.
        if(receiving.x*flatWindow.x>0.0&&v.z>-.002){
          vec4 q=length(position.xy-edgeStart)<.00001?b:a;vec4 qv=viewMatrix*q;
          if(qv.z>=-.002){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
          p=mix(p,q,(-.002-v.z)/(qv.z-v.z));v=viewMatrix*p;
        }
        worldXY=p.xy;gl_Position=projectionMatrix*v;
        float angularX=atan(v.x,-v.z)/receiving.y;
        gl_Position.x=mix(gl_Position.x,angularX*gl_Position.w,flatWindow.x*receiving.x);
        float side=clamp((p.z-planeHeight)/(shapeHeight*0.5),-1.0,1.0);
        gl_Position.y=mix(gl_Position.y,side*flatWindow.y*gl_Position.w,flatWindow.x);
        if(stroke!=0.0){vec4 q=projectionMatrix*viewMatrix*modelMatrix*vec4(adjacent,1.0);
          vec2 direction=(q.xy/q.w-gl_Position.xy/gl_Position.w)*viewport;
          vec2 normal=vec2(-direction.y,direction.x)/max(length(direction),0.0001);
          gl_Position.xy+=normal/viewport*gl_Position.w*stroke*2.0;}}`,
    fragmentShader:`uniform vec2 eye;uniform vec2 eyeForward;uniform vec2 receiving;uniform vec2 flatWindow;uniform vec2 viewport;uniform vec2 viewportOrigin;uniform float pixelRatio;uniform vec2 clipPlanes;uniform float maskRadius;uniform sampler2D light;uniform vec2 range;uniform float fade;uniform float coloring;uniform float wash;uniform vec3 environment;uniform vec3 tint;varying vec3 surfaceTint;varying vec2 worldXY;varying vec2 edgeA;varying vec2 edgeB;
      float cross2(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
      void main(){float distance=length(worldXY-eye);gl_FragDepthEXT=gl_FragCoord.z;
        float bend=receiving.x*flatWindow.x;
        if(bend>0.0){
          float u=2.0*(gl_FragCoord.x/pixelRatio-viewportOrigin.x)/viewport.x-1.0,h=receiving.y;
          float angle=u*h;
          if(bend<1.0){
            angle=mix(atan(u*tan(h)),angle,bend);
            for(int i=0;i<3;i++){
              float t=tan(angle);
              angle-=(mix(t/tan(h),angle/h,bend)-u)/mix((1.0+t*t)/tan(h),1.0/h,bend);
            }
          }
          vec2 ray=eyeForward*cos(angle)+vec2(eyeForward.y,-eyeForward.x)*sin(angle),edge=edgeB-edgeA;
          distance=cross2(edgeA-eye,edge)/cross2(ray,edge);
          if(distance<=0.0)discard;
          // Nonlinear screen X cannot interpolate perspective depth correctly.
          // Intersect this fragment's own edge; the depth buffer resolves occlusion.
        }
        // At zero degrees all optical surfaces share linear distance depth,
        // retaining precision for the distant star field as well as near edges.
        if(flatWindow.x>0.0)gl_FragDepthEXT=distance/clipPlanes.y;
        if(maskRadius>0.0&&distance>=maskRadius){gl_FragColor=vec4(0.0,0.0,0.0,fade);return;}
        float t=clamp((distance-range.x)/range.y,0.0,1.0);
        vec2 sampleLight=texture2D(light,vec2((t*127.0+0.5)/128.0,0.5)).rg;
        vec3 pigment=surfaceTint*tint;
        vec3 painted=mix(sampleLight.r*pigment,sampleLight.g*pigment+(sampleLight.r-sampleLight.g)*environment,wash);
        gl_FragColor=vec4(mix(vec3(sampleLight.r),painted,coloring),fade);}`
  });
  material.defaultAttributeValues.paint=[1,1,1];
  material.defaultAttributeValues.normal=[0,0,0];
  material.defaultAttributeValues.adjacent=[0,0,0];material.defaultAttributeValues.stroke=[0];
  material.addEventListener('dispose',()=>light.dispose());
  return material;
}
let lightRevision=0,lightingUpdates=0;
function updateOverviewLight(mesh, observer) {
  const pose=mesh.userData.lightPose,x=mesh.position.x,y=mesh.position.y,angle=mesh.rotation.z;
  // Heading changes only projection. Distance lighting changes with XY poses or optics.
  if(pose&&pose.x===x&&pose.y===y&&pose.angle===angle&&pose.eyeX===observer.x&&pose.eyeY===observer.y&&pose.revision===lightRevision)return;
  mesh.userData.lightPose={x,y,angle,eyeX:observer.x,eyeY:observer.y,revision:lightRevision};
  lightingUpdates++;
  const {material,vertices}=mesh.userData.boundary;
  const boundary={...mesh.userData.boundary,material,vertices:worldVertices(vertices,mesh.position,mesh.rotation.z)};
  // Geometry-relative contrast is independent of pigment and global range.
  const shape=boundaryLighting(boundary,observer,rules);
  const span=Math.max(1e-6,shape.farthest-shape.nearest);
  const light=mesh.material.uniforms.light.value, pixels=light.image.data;
  for(let i=0;i<128;i++) {
    const sample=surfaceLight(shape.nearest+span*i/127,shape,rules),gray=exposeLight(sample,rules)*(rules.attenuationMode==='mask'?sample.reception:1);
    // Both views use optics' reception: in wash mode it dilutes the pigment.
    const offset=i*4;
    pixels[offset]=gray;pixels[offset+1]=Math.round(gray*sample.reception);pixels[offset+2]=gray;pixels[offset+3]=255;
  }
  mesh.material.uniforms.range.value.set(shape.nearest,span);light.needsUpdate=true;
  mesh.material.uniforms.coloring.value=Number(rules.coloring);
  mesh.material.uniforms.wash.value=Number(rules.attenuationMode==='wash');
  mesh.material.uniforms.environment.value.set(...opticalTint(rules.environmentColor));
}
function paintedGeometry(edges,outlineOnly=false) {
  const positions=[],colors=[],adjacent=[],strokes=[],starts=[],ends=[];
  for(const {a,b,color} of edges){
    const tint=opticalTint(color);
    const append=(p,z)=>{positions.push(p.x,p.y,z);colors.push(...tint);starts.push(a.x,a.y);ends.push(b.x,b.y);};
    if(outlineOnly){
      // Two CSS pixels of display ink, independent of physical body thickness.
      for(const [p,q,side] of [[a,b,-1],[b,a,1],[a,b,1],[b,a,1],[b,a,-1],[a,b,1]]){
        append(p,1.005);adjacent.push(q.x,q.y,1.005);strokes.push(side);
      }
      continue;
    }
    // Thin boundary faces keep one geometry for overhead and resident views.
    // The overhead body stays hollow; its faces still occlude what is behind.
    append(a,0);append(b,0);append(a,1);append(b,0);append(b,1);append(a,1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('edgeStart',new THREE.Float32BufferAttribute(starts,2));geometry.setAttribute('edgeEnd',new THREE.Float32BufferAttribute(ends,2));
  if(outlineOnly){geometry.setAttribute('adjacent',new THREE.Float32BufferAttribute(adjacent,3));geometry.setAttribute('stroke',new THREE.Float32BufferAttribute(strokes,1));}
  geometry.setAttribute('paint',new THREE.Float32BufferAttribute(colors,3));return geometry;
}
const box=new THREE.BoxGeometry(1,1,1).toNonIndexed(),wallMeshes=[],wallBoundaries=houseBoundaries(sim),wallMaterial=opticalMaterial(OPTICS_RULES.materials.house.color);
// Box faces carry the same boundary endpoints as resident faces.
const wallStarts=[],wallEnds=[],wallPositions=box.getAttribute('position');
for(let face=0;face<wallPositions.count;face+=6){
  const a=new THREE.Vector2(wallPositions.getX(face),wallPositions.getY(face));
  let b=a;
  for(let i=1;i<6;i++){
    const q=new THREE.Vector2(wallPositions.getX(face+i),wallPositions.getY(face+i));
    if(q.distanceToSquared(a)>0){b=q;break;}
  }
  for(let i=0;i<6;i++){wallStarts.push(a.x,a.y);wallEnds.push(b.x,b.y);}
}
box.setAttribute('edgeStart',new THREE.Float32BufferAttribute(wallStarts,2));box.setAttribute('edgeEnd',new THREE.Float32BufferAttribute(wallEnds,2));
for(const [i,w] of sim.walls.entries()) {
  const {x,y}=w.collider.halfExtents(),pos=w.collider.translation();
  const mesh=new THREE.Mesh(box,wallMaterial);
  mesh.position.set(pos.x,pos.y,PLANE_HEIGHT);mesh.rotation.z=w.collider.rotation();mesh.scale.set(x*2,y*2,shapeHeight);
  mesh.userData.boundary={...wallBoundaries[i],vertices:[{x:-x,y:-y},{x,y:-y},{x,y},{x:-x,y}]};
  worldGroup.add(mesh);wallMeshes.push(mesh);
}
const entityMeshes=new Map();
let deathAnimation=false;
function removeMesh(id){
  const mesh=entityMeshes.get(id);
  worldGroup.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();
  mesh.children.forEach(c=>c.geometry.dispose());entityMeshes.delete(id);
}
function addMesh(e) {
  if(!e.storyId)setScenePaintStyle([e],rules,rules.paintStyle);
  const vertices=e.vertices,edges=e.paintedEdges??vertices.map((a,i)=>({a,b:vertices[(i+1)%vertices.length]}));
  const geometry=paintedGeometry(edges),material=opticalMaterial();
  const mesh=new THREE.Mesh(geometry,material);
  if(e===sim.player)mesh.layers.set(1);
  mesh.userData.boundary={material:'resident',vertices};
  const edge=new THREE.Mesh(paintedGeometry(edges,true),material);
  edge.layers.set(1);
  mesh.add(edge);worldGroup.add(mesh);entityMeshes.set(e.id,mesh);
  return mesh;
}
function updateMeshPaint(mesh,character) {
  const edges=character.paintedEdges;
  for(const part of [mesh,...mesh.children]){
    const paint=part.geometry.getAttribute('paint');
    edges.forEach(({color},i)=>{
      const tint=opticalTint(color);
      // Both a side face and its display outline have six vertices per edge.
      for(let vertex=0;vertex<6;vertex++)paint.setXYZ(i*6+vertex,...tint);
    });
    paint.needsUpdate=true;
  }
}
// Debug geometry shares the observer and the mask's finite range.
const observerGuide=new THREE.Group();scene.add(observerGuide);
const cone=new THREE.Group();observerGuide.add(cone);
const sightGuides=[0,.5,1].map(screenX=>{
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
  const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#aaa',transparent:true,opacity:screenX===.5?.32:.65,depthWrite:false,dashSize:screenX===.5?.2:.6,gapSize:.18}));
  cone.add(line);return {line,screenX};
});
const rangeCircle=new THREE.Line(new THREE.BufferGeometry().setFromPoints(
  Array.from({length:129},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/64),Math.sin(i*Math.PI/64),0))),
  new THREE.LineDashedMaterial({color:'#aaa',transparent:true,opacity:.55,depthWrite:false,dashSize:.055,gapSize:.035}));
rangeCircle.computeLineDistances();observerGuide.add(rangeCircle);
const ring=new THREE.Mesh(new THREE.RingGeometry(.43,.45,48),new THREE.MeshBasicMaterial({color:'#ccc',transparent:true,opacity:.55,side:THREE.DoubleSide}));observerGuide.add(ring);
const targetMarker=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color:'#f1d575',depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
targetMarker.layers.set(2);targetMarker.renderOrder=10;targetMarker.visible=false;scene.add(targetMarker);
let targetMarkerUntil=0;
function markTarget(target){targetMarker.position.set(target.x,target.y,.09);targetMarkerUntil=performance.now()+900;}
for(const guide of [cone,rangeCircle,ring])guide.traverse(part=>part.layers.set(2));
if(parade&&!scripted)ring.scale.setScalar(4);
const labelElements=(openScene||scripted?[]:labels).map(([name,x,y,cls,sub])=>{
  const el=document.createElement('div');el.className=`room-label ${cls}`;el.textContent=name;
  if(sub){const span=document.createElement('span');span.className='sub';span.textContent=sub;el.appendChild(span);}
  $('labels').appendChild(el);return{el,position:new THREE.Vector3(point(x,y).x,point(x,y).y,.1)};
});

// Photometry stays shared with Study 000; the room always renders its 3D meshes.
const rules={...OPTICS_RULES,finish:'clear',coloring:true,visionEffect:'attenuation',scatterDistance:25,scatterCurve:'smooth'};
const scatter=createScatter(renderer,{eye:overviewEye,flatWindow,viewportOrigin,planeHeight:PLANE_HEIGHT});
function renderView(view,rect){
  if(rules.visionEffect!=='attenuation'){
    scatter.render(scene,view,rect,maskRadius.value,rules.scatterDistance,rules.scatterCurve);
  }else{renderer.clear();renderer.render(scene,view);}
}
const DEFAULT_FIELD_ANGLE=120;
let fieldAngle=DEFAULT_FIELD_ANGLE,projection='perspective';
const currentObserver=()=>observerFor(sim.player,THREE.MathUtils.degToRad(fieldAngle),projection);
function updateFieldAngle() {
  fieldAngle=Number($('field-angle').value);receiving.value.y=THREE.MathUtils.degToRad(fieldAngle)/2;
  $('field-angle-value').textContent=`${fieldAngle}°`;
}
$('field-angle').oninput=updateFieldAngle;updateFieldAngle();
$('projection').onchange=()=>{projection=$('projection').value;receiving.value.x=Number(projection==='equidistant');};
let windowHeight=8,lineOnly=true,stretch=0,windowStarted=0,expandOnArrival=false;
const windowFrom=new THREE.Vector2(),windowTo=new THREE.Vector2();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
function setStretch(expand,flatten=perspective===1){
  if(expand&&perspective!==1)return;
  lineOnly=!expand;windowFrom.copy(flatWindow.value);
  windowTo.set(Number(flatten),expand?1:windowHeight/100);windowStarted=performance.now();
  if(reducedMotion.matches)flatWindow.value.copy(windowTo);
  $('sight-expanded').textContent=expand?'收回细线':'上下拉满';
  $('sight-expanded').setAttribute('aria-pressed',String(expand));
  $('sight-line').setAttribute('aria-pressed',String(!expand));
  updateViewDescription();
}
renderer.autoClear=false;
renderer.info.autoReset=false;
const mini=$('minimap').getContext('2d');
let mapFollowsHeading=false;
function setMapFollow(follow) {
  mapFollowsHeading=follow;
  $('map-lock').checked=!follow;
  $('map-lock-label').textContent=follow?'朝向跟随':'北向固定';
  $('minimap').setAttribute('aria-label',`角色位置与朝向，${follow?'朝向跟随':'北向固定'}`);
  container.focus({preventScroll:true});
}
$('map-lock').onchange=()=>setMapFollow(!$('map-lock').checked);
function drawMini(observer) {
  const scale=stars?.055:maskTest?.8:parade?2.5:18,centre=210,radius=180;
  const p=observer,heading=Math.PI/2-observer.heading;
  // North is +Y. Rotate the map so the resident's forward vector points up.
  const rotation=mapFollowsHeading?heading-Math.PI/2:0;
  mini.clearRect(0,0,420,420);
  mini.save();mini.translate(centre,centre);
  mini.beginPath();mini.arc(0,0,radius,0,Math.PI*2);mini.fillStyle='#eeeee3';mini.fill();mini.clip();
  mini.rotate(rotation);mini.scale(scale,-scale);mini.translate(-p.x,-p.y);
  mini.lineWidth=2.5/scale;mini.strokeStyle=rules.coloring?rules.materials.house.color:'#969696';mini.beginPath();
  for(const w of sim.walls){mini.moveTo(w.a.x,w.a.y);mini.lineTo(w.b.x,w.b.y);}mini.stroke();
  mini.strokeStyle='#628653';mini.lineWidth=1.5/scale;mini.setLineDash([.3,.18]);
  for(const screenX of (!scripted||storyCameraManual)?[0,.5,1]:[]){
    const d=sightDirection(observer,screenX);
    mini.beginPath();mini.moveTo(p.x,p.y);mini.lineTo(p.x+d.x*radius/scale,p.y+d.y*radius/scale);mini.stroke();
  }
  mini.setLineDash([]);
  function drawResident(e) {
    if(e.state==='dead'||e.storyVisible===false)return;
    const pos=e.body.translation(),angle=e.body.rotation();
    // Small residents get a readable map symbol without changing world geometry.
    const size=Math.max(...e.vertices.map(v=>Math.hypot(v.x,v.y)));
    const symbolScale=Math.max(1,4/(size*scale));
    mini.save();mini.translate(pos.x,pos.y);mini.rotate(angle);mini.scale(symbolScale,symbolScale);
    const vertices=e.vertices;
    mini.globalAlpha=e.state==='dead'?.3:1;
    mini.beginPath();vertices.forEach((v,i)=>i?mini.lineTo(v.x,v.y):mini.moveTo(v.x,v.y));
    if(vertices.length>2)mini.closePath();
    mini.lineJoin='round';mini.lineWidth=5/(scale*symbolScale);mini.strokeStyle='#faf9f2';mini.stroke();
    mini.lineWidth=2/(scale*symbolScale);
    for(const {a,b,color} of e.paintedEdges){
      mini.beginPath();mini.moveTo(a.x,a.y);mini.lineTo(b.x,b.y);
      mini.strokeStyle=rules.coloring&&e.state!=='dead'?color:'#777777';mini.stroke();
    }
    mini.restore();
  }
  for(const e of sim.entities)if(e!==sim.player)drawResident(e);
  if(!scripted||storyCameraManual){
    drawResident(sim.player);
    mini.translate(p.x,p.y);mini.rotate(heading);
    mini.strokeStyle='#527547';mini.lineWidth=2/scale;mini.beginPath();mini.arc(0,0,.65,0,Math.PI*2);mini.stroke();
    mini.fillStyle='#527547';mini.beginPath();mini.moveTo(1.05,0);mini.lineTo(.69,.18);mini.lineTo(.69,-.18);mini.closePath();mini.fill();
  }
  mini.restore();
  mini.font='600 21px "PingFang SC", sans-serif';mini.textAlign='center';mini.textBaseline='middle';
  for(const [name,angle] of [['北',Math.PI/2],['东',0],['南',-Math.PI/2],['西',Math.PI]]) {
    mini.fillStyle=name==='北'?'#526e47':'#858d7b';
    mini.fillText(name,centre+Math.cos(angle-rotation)*198,centre-Math.sin(angle-rotation)*198);
  }
}
let width=innerWidth,height=innerHeight,targetPerspective=0,perspective=0,toastTime=0;
const sightPreview=$('sight-preview'),previewWindow=$('sight-preview-window'),savedFlatWindow=new THREE.Vector2();
let previewBounds=null;
let canvasWidth=0,canvasHeight=0,overviewZoom=1;
const overviewBounds=new THREE.Box2();
function fitOverview(){
  overviewBounds.makeEmpty();
  for(const wall of wallBoundaries)for(const vertex of wall.vertices)overviewBounds.expandByPoint(vertex);
  for(const entity of sim.entities)if(!scripted||entity!==sim.player)for(const vertex of worldVertices(entity.vertices,entity.body.translation(),entity.body.rotation()))overviewBounds.expandByPoint(vertex);
  if(overviewBounds.isEmpty())overviewBounds.set(new THREE.Vector2(-1,-1),new THREE.Vector2(1,1));
  overviewZoom=1;
}
fitOverview();
container.addEventListener('wheel',event=>{
  if(perspective!==0||event.ctrlKey)return;
  event.preventDefault();
  overviewZoom=THREE.MathUtils.clamp(overviewZoom*Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.003),.25,16);
},{passive:false});
let frames=0,fps=60,statsAt=performance.now(),previousTime=performance.now(),accumulator=0,collisionCooldown=0;
function resize(){width=container.clientWidth;height=container.clientHeight;viewportSize.value.set(width,height);renderer.setSize(width,height);previewBounds=null;}
addEventListener('resize',resize);resize();
function setDisplayHeight(height){
  for(const mesh of wallMeshes)mesh.scale.z=height;
  for(const mesh of entityMeshes.values()){mesh.position.z=PLANE_HEIGHT-height/2;mesh.scale.z=height;}
}
function drawSightPreview(observer){
  // Only a small viewport pass: reuse this scene, its meshes and light textures.
  // Cache layout until resize or view entry, avoiding a layout read each frame.
  if(!previewBounds){
    const rect=previewWindow.getBoundingClientRect();
    previewBounds={x:Math.floor(rect.left),y:Math.floor(height-rect.bottom),width:Math.floor(rect.width),height:Math.floor(rect.height)};
    // DOM room labels must not show through the inset's black canvas region.
    const panel=sightPreview.getBoundingClientRect(),l=panel.left,r=panel.right,t=panel.top,b=panel.bottom;
    $('labels').style.clipPath=`polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${l}px ${t}px,${r}px ${t}px,${r}px ${b}px,${l}px ${b}px,${l}px ${t}px)`;
  }
  const {x,y,width:w,height:h}=previewBounds;
  residentCamera.position.set(observer.x,observer.y,PLANE_HEIGHT);
  residentCamera.up.set(0,0,1);
  residentCamera.lookAt(observer.x+eyeForward.value.x,observer.y+eyeForward.value.y,PLANE_HEIGHT);
  residentCamera.aspect=w/h;
  residentCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(observer.fov/2)/residentCamera.aspect));
  residentCamera.updateProjectionMatrix();
  savedFlatWindow.copy(flatWindow.value);flatWindow.value.set(1,windowHeight/100);
  viewportSize.value.set(w,h);viewportOrigin.value.set(x,y);
  renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);renderer.setScissorTest(true);
  // The resident inset views the same meshes from their edges, so restore their
  // thickness for this pass, then return them to the overhead plane.
  setDisplayHeight(shapeHeight);
  renderView(residentCamera,{x,y,width:w,height:h});
  setDisplayHeight(shapeHeight*perspective);
  renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);
  flatWindow.value.copy(savedFlatWindow);viewportSize.value.set(width,height);viewportOrigin.value.set(0,0);
}
const keys=new Set();
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');toastTime=2.5;}
function updateViewDescription() {
  $('view-description').textContent=targetPerspective>.95
    ?(lineOnly?'居民视野只保留中央细线，其余方向为纯黑。':'中央细线向上下铺满画面，颜色不随高度变化。')
    :targetPerspective>.1?'逐渐进入平面，明暗始终以观察者为基准。':'移动观察者，比较世界明暗与眼前的光。';
}
function setPerspective(value) {
  clearTimeout(clickTimer);sim.aimAt(null);pendingTurn=0;
  if(value!==targetPerspective)setStretch(false,value===1&&perspective===1);
  targetPerspective=value;$('perspective').value=Math.round(value*100);
  for(const [id,selected] of [['overview',value===0],['resident',value===1]]){$(id).classList.toggle('selected',selected);$(id).setAttribute('aria-pressed',selected);}
  $('angle-value').textContent=value===1?'0° · 居民视野':`${Math.round((1-value)*90)}° · ${value===0?'俯视':'下降中'}`;
  updateViewDescription();
  $('mode-label').textContent=value>.95?'居民视角 / INSIDE':value>.05?'维度之间 / TRANSITION':'俯视 / OVERVIEW';
}
$('perspective').addEventListener('input',e=>setPerspective(Number(e.target.value)/100));
$('overview').onclick=()=>{setPerspective(0);container.focus({preventScroll:true});};$('resident').onclick=()=>{setPerspective(1);container.focus({preventScroll:true});};
$('sight-expanded').onclick=()=>{setStretch(lineOnly);container.focus({preventScroll:true});};
$('sight-line').onclick=()=>{setStretch(false);container.focus({preventScroll:true});};
$('resident-window').oninput=()=>{
  const value=Number($('resident-window').value);
  const changed=value!==windowHeight;windowHeight=value;
  if(changed)setStretch(false);
  $('resident-window-value').textContent=`${value}%`;
};
$('contour').checked=rules.contour>0;
$('contour').onchange=e=>{rules.contour=e.target.checked?OPTICS_RULES.contour:0;lightRevision++;};
$('finish').value=rules.finish;
$('finish').onchange=e=>{rules.finish=e.target.value;lightRevision++;};
$('coloring').checked=rules.coloring;
$('coloring').onchange=e=>{rules.coloring=e.target.checked;lightRevision++;};
function setPaintStyle(styleId) {
  lightRevision++;
  setScenePaintStyle(sim.entities,rules,styleId);
  wallMaterial.uniforms.tint.value.set(...opticalTint(rules.materials.house.color));
  for(const character of sim.entities){
    const mesh=entityMeshes.get(character.id);if(mesh)updateMeshPaint(mesh,character);
  }
}
for(const [id,style] of Object.entries(PAINT_STYLES))$('paint-style').add(new Option(style.name,id));
$('paint-style').value=DEFAULT_PAINT_STYLE;
setPaintStyle(DEFAULT_PAINT_STYLE);
$('paint-style').onchange=e=>setPaintStyle(e.target.value);
$('wandering').checked=sim.wandering;
$('wandering').onchange=e=>{sim.setWandering(e.target.checked);container.focus({preventScroll:true});};
if(parade){
  $('scene-name').textContent='色彩检阅场';$('scene-subtitle').textContent='中央通道 · 两侧色彩队列';
  $('reset').textContent='回到入口';
  $('population').replaceChildren(new Option('1000','1000'),new Option('2000','2000'));
  document.title='平面国 · 色彩检阅场';
}
if(maskTest){
  $('scene-name').textContent='同心圆遮罩';$('scene-subtitle').textContent=`5—${sim.bounds.x} 身长 · 等距居民`;
  $('reset').textContent='回到圆心';document.title='平面国 · 同心圆遮罩';
  $('population').replaceChildren(new Option(`${sim.entities.length-1} 个标本 + 观察者`,String(sim.entities.length)));
  $('scene-layout').add(new Option('同心圆遮罩','mask'));
}
if(stars){
  $('scene-name').textContent='星野';$('scene-subtitle').textContent='近邻与远处居民';
  $('reset').textContent='回到中心';document.title='平面国 · 星野';
  $('scene-layout').add(new Option('星野','stars'));
}
$('scene-layout').value=layout;
$('scene-layout').onchange=()=>{
  const next=new URL(location.href);
  if($('scene-layout').value!=='house')next.searchParams.set('scene',$('scene-layout').value);else next.searchParams.delete('scene');
  location.assign(next);
};
$('population').onchange=e=>{const n=sim.population(Number(e.target.value));toast(`${n} 位居民 · 二维碰撞持续运行`);container.focus({preventScroll:true});};
$('interaction').value=sim.player.interaction;
$('interaction').onchange=e=>{
  keys.clear();sim.aimAt(null);sim.player.stop();sim.player.setInteraction(e.target.value);
  toast(e.target.value==='kill'?'击杀：主动用尖角或端点撞中对方；侧边接触停住':'触摸：接触停住，双方存活');container.focus({preventScroll:true});
};
$('reset').onclick=()=>{
  clearTimeout(clickTimer);
  let found=false;for(const p of [sim.home,...(openScene?[]:[point(320,270),point(310,295),point(290,285)])])if(sim.relocate(p)){found=true;break;}
  if(found){sim.player.body.setRotation(Math.PI/2,true);toast(maskTest?'已回到圆心':parade?'已回到检阅场入口':'已回到客厅');}else toast('这里暂时拥挤，请双击其他空地');
};
$('reference').onclick=()=>{$('reference-dialog').showModal();keys.clear();};$('close-reference').onclick=()=>$('reference-dialog').close();
$('reference-dialog').addEventListener('click',e=>{if(e.target===$('reference-dialog'))$('reference-dialog').close();});
addEventListener('keydown',e=>{
  if($('reference-dialog').open||['INPUT','SELECT'].includes(e.target.tagName)||(e.target.tagName==='BUTTON'&&e.code==='Space'))return;
  if(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){clearTimeout(clickTimer);sim.aimAt(null);if(scripted)storyCameraManual=true;}
  if(e.code==='Space'&&!e.repeat){
    if(scripted)parent.postMessage({type:'flatland-story-toggle-view'},location.origin);
    else setPerspective(targetPerspective>.5?0:1);
  }
  keys.add(e.code);
});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{keys.clear();accumulator=0;previousTime=performance.now();});
for(const button of document.querySelectorAll('[data-move]')) {
  button.addEventListener('pointerdown',e=>{button.setPointerCapture(e.pointerId);keys.add(button.dataset.move);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.move));
}
let drag=null,pendingTurn=0,suppressClick=false,clickTimer;
function groundPoint(event) {
  const rect=container.getBoundingClientRect(),raycaster=new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-PLANE_HEIGHT),new THREE.Vector3());
}
function cameraTarget(event){
  if(perspective!==1)return groundPoint(event);
  const eye=currentObserver(),rect=container.getBoundingClientRect(),d=sightDirection(eye,(event.clientX-rect.left)/rect.width);
  return d?{x:eye.x+d.x,y:eye.y+d.y}:null;
}
function pointCameraAt(target){
  if(!target)return;
  if(scripted)storyCameraManual=true;
  const eye=sim.player.body.translation(),dx=target.x-eye.x,dy=target.y-eye.y;
  if(Math.hypot(dx,dy)>1e-6)sim.player.body.setRotation(Math.atan2(dy,dx),true);
}
function placeStoryCamera(target){
  if(!target||![target.x,target.y].every(Number.isFinite))throw new Error('请重新选择观察点');
  if(sim.occupied(target,.1,sim.player))throw new Error('这个点位在墙体内，请选择空地');
  sim.player.body.setTranslation({x:target.x,y:target.y},true);
  storyCameraManual=true;
  parent.postMessage({type:'flatland-camera-placed'},location.origin);
}
container.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  clearTimeout(clickTimer);
  sim.aimAt(null);container.focus({preventScroll:true});container.setPointerCapture(e.pointerId);
  drag={startX:e.clientX,startY:e.clientY,x:e.clientX,moved:false};suppressClick=false;
});
container.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x;drag.x=e.clientX;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;if(drag.moved&&(perspective===1||scripted))pendingTurn-=dx*.005;});
container.addEventListener('pointerup',()=>{suppressClick=!!drag?.moved;drag=null;});
container.addEventListener('pointercancel',()=>{drag=null;suppressClick=true;});
container.addEventListener('click',e=>{
  clearTimeout(clickTimer);
  if(suppressClick||e.detail!==1)return;
  if(scripted){const target=cameraTarget(e);clickTimer=setTimeout(()=>pointCameraAt(target),250);return;}
  let target;const resident=perspective===1;
  if(resident){
    const observer=currentObserver(),rect=container.getBoundingClientRect();
    const direction=sightDirection(observer,(e.clientX-rect.left)/rect.width);
    if(!direction)return;
    target={x:observer.x+direction.x,y:observer.y+direction.y};
  }else target=groundPoint(e);
  if(target&&!resident)markTarget(target);
  if(target)clickTimer=setTimeout(()=>{
    if(resident)sim.aimAt(target);
    else if(!sim.walkTo(target))toast('目的地被墙或居民占据，请选择空地');
  },350);
});
container.addEventListener('dblclick',e=>{
  e.preventDefault();clearTimeout(clickTimer);sim.aimAt(null);
  if(suppressClick)return;
  if(scripted){
    if(perspective!==0)return;
    try{placeStoryCamera(groundPoint(e));}catch(error){parent.postMessage({type:'flatland-camera-error',message:error.message},location.origin);}
    return;
  }
  const target=groundPoint(e);
  if(target){markTarget(target);toast(sim.relocate(target)?'观察者已移动到这里':'角色轮廓会与墙或居民重叠，请选择空地');}
});
container.addEventListener('contextmenu',e=>{
  if(!scripted)return;
  e.preventDefault();clearTimeout(clickTimer);container.focus({preventScroll:true});pointCameraAt(cameraTarget(e));
});
addEventListener('blur',()=>clearTimeout(clickTimer));
if(scripted){
  let lastInteraction=0;
  const interact=()=>{const now=performance.now();if(now-lastInteraction>150){lastInteraction=now;parent.postMessage({type:'flatland-story-interaction'},location.origin);}};
  container.addEventListener('pointermove',interact);container.addEventListener('pointerdown',interact);addEventListener('keydown',interact);
}
function animate(now) {
  const delta=Math.min((now-previousTime)/1000,.08);previousTime=now;accumulator+=delta;
  const held=(...codes)=>codes.some(c=>keys.has(c))?1:0;
  while(accumulator>=1/60) {
    const mouseTurn=Math.max(-3,Math.min(3,pendingTurn/(1.5/60)));pendingTurn-=mouseTurn*1.5/60;
    if(scripted&&mouseTurn)storyCameraManual=true;
    sim.step({forward:held('KeyW','ArrowUp')-held('KeyS','ArrowDown'),side:held('KeyQ')-held('KeyE'),turn:held('KeyA','ArrowLeft')-held('KeyD','ArrowRight')+mouseTurn});accumulator-=1/60;
    if(sim.walkStatus==='blocked'){toast(sim.pathfinding?'没有找到可通行的路线，请换一个目的地':'前方有障碍，已停止移动');sim.aimAt(null);}
  }
  const progress=Math.min(1,(now-windowStarted)/300),ease=(1-Math.cos(Math.PI*progress))/2;
  if(progress===1||reducedMotion.matches)flatWindow.value.copy(windowTo);
  else flatWindow.value.lerpVectors(windowFrom,windowTo,ease);
  stretch=windowHeight===100?Number(!lineOnly):THREE.MathUtils.clamp((flatWindow.value.y-windowHeight/100)/(1-windowHeight/100),0,1);
  const previousPerspective=perspective;
  // Rotate first, then open the window. In reverse, close it before rotating.
  if(targetPerspective===1||flatWindow.value.x===0){
    perspective+=(targetPerspective-perspective)*(1-Math.exp(-delta*7));
    if(Math.abs(perspective-targetPerspective)<.0005)perspective=targetPerspective;
  }
  if(previousPerspective!==1&&perspective===1)setStretch(expandOnArrival);
  const observer=currentObserver();
  const t=perspective,p=observer,residentView=t===1;
  const heading=Math.PI/2-observer.heading,eased=t*t*(3-2*t);
  overviewEye.value.set(p.x,p.y);eyeForward.value.set(Math.sin(observer.heading),Math.cos(observer.heading));
  const centre=new THREE.Vector3((overviewBounds.min.x+overviewBounds.max.x)/2,(overviewBounds.min.y+overviewBounds.max.y)/2,0);
  // Fit the actual scene once; viewport zoom is independent of the resident lens.
  const framedWidth=Math.max(overviewBounds.max.x-overviewBounds.min.x,(overviewBounds.max.y-overviewBounds.min.y)*width/height)*1.08/overviewZoom;
  const topDistance=framedWidth/(2*Math.tan(observer.fov/2));
  // Blend from the fitted canvas centre into the observer without a first-frame jump.
  const location=new THREE.Vector3(centre.x+(p.x-centre.x)*eased,centre.y+(p.y-centre.y)*eased,0);
  const elevation=(1-t)*Math.PI/2,distance=topDistance*(1-eased);
  camera.position.set(location.x-Math.cos(heading)*Math.cos(elevation)*distance,location.y-Math.sin(heading)*Math.cos(elevation)*distance,PLANE_HEIGHT+Math.sin(elevation)*distance);
  camera.up.set(0,Math.sin(elevation),Math.cos(elevation)).normalize();
  camera.lookAt(location.x+Math.cos(heading)*eased,location.y+Math.sin(heading)*eased,PLANE_HEIGHT*eased);
  const verticalSlope=Math.tan(observer.fov/2)/(width/height);
  // World-space coverage of the full overhead canvas, including empty space.
  canvasHeight=2*topDistance*verticalSlope;canvasWidth=canvasHeight*width/height;
  camera.aspect=width/height;
  camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(verticalSlope));
  camera.updateProjectionMatrix();
  const scaleBar=$('scale-bar');scaleBar.hidden=t!==0;
  if(t===0){
    const pixelsPerLength=height/canvasHeight;
    const magnitude=10**Math.floor(Math.log10(90/pixelsPerLength));
    const size=([5,2,1].find(n=>n*magnitude*pixelsPerLength<=110)??1)*magnitude;
    scaleBar.style.width=`${size*pixelsPerLength}px`;scaleBar.textContent=formatLength(size);
  }
  // At exactly 90 degrees every edge lies in one plane: no extruded sides or
  // height parallax. The same mesh gains display height toward resident view.
  if(wallMeshes.length)updateOverviewLight(wallMeshes[0],p);
  const present=new Set(sim.entities.map(e=>e.id));
  for(const id of entityMeshes.keys())if(!present.has(id))removeMesh(id);
  for(const e of sim.entities) {
    let mesh=entityMeshes.get(e.id);
    if(mesh?.userData.deathSeen&&e.state!=='dead'){removeMesh(e.id);mesh=null;}
    if(e.storyVisible===false){if(mesh)mesh.visible=false;continue;}
    mesh??=addMesh(e);const pos=e.body.translation();mesh.position.x=pos.x;mesh.position.y=pos.y;mesh.rotation.z=e.body.rotation();
    const visible=updateDeathEffect(mesh,e,scripted?(storyFrame?.time??0)*1000:now,(scripted||deathAnimation)&&!reducedMotion.matches,e.storyDeathAt===undefined?undefined:e.storyDeathAt*1000);
    mesh.visible=(e!==sim.player||t===0)&&visible&&e.storyVisible!==false;
    mesh.children.forEach(outline=>{outline.visible=!residentView;});
    if(mesh.visible)updateOverviewLight(mesh,p);
  }
  setDisplayHeight(shapeHeight*t);
  observerGuide.position.set(p.x,p.y,PLANE_HEIGHT);cone.visible=(!scripted||storyCameraManual)&&t<.75;
  const guideExtent=maskRadius.value>0?maskRadius.value:topDistance*2*Math.tan(observer.fov/2)+Math.hypot(p.x-centre.x,p.y-centre.y);
  for(const {line,screenX} of sightGuides){
    const d=sightDirection(observer,screenX),positions=line.geometry.attributes.position;
    positions.setXYZ(1,d.x*guideExtent,d.y*guideExtent,0);positions.needsUpdate=true;
    // Direction changes can move a guide outside its previous culling bounds.
    line.geometry.computeBoundingSphere();line.computeLineDistances();
  }
  rangeCircle.visible=!scripted&&t===0&&maskRadius.value>0&&$('show-range').checked;
  rangeCircle.scale.setScalar(maskRadius.value);
  ring.visible=(!scripted||storyCameraManual)&&t===0;
  if(sim.walkTarget){markTarget(sim.walkTarget);}
  targetMarker.visible=(!scripted||storyCameraManual)&&t===0&&now<targetMarkerUntil;
  targetMarker.scale.setScalar(canvasWidth/width*5);
  $('labels').style.opacity=Math.max(0,1-t*3.7);
  for(const {el,position} of labelElements){const pos=position.clone().project(camera);el.style.left=`${(pos.x*.5+.5)*width}px`;el.style.top=`${(-pos.y*.5+.5)*height}px`;}
  $('sight-display').hidden=!residentView;
  $('minimap-panel').hidden=!residentView;document.body.classList.toggle('immersed',t>.7);
  sightPreview.hidden=scripted||t!==0;
  if(sightPreview.hidden&&previewBounds){previewBounds=null;$('labels').style.clipPath='';}
  if(residentView)drawMini(observer);
  renderer.info.reset();
  renderView(camera,{width,height});
  renderer.setScissorTest(false);
  if(!sightPreview.hidden)drawSightPreview(observer);
  frames++;if(now-statsAt>750){fps=Math.round(frames*1000/(now-statsAt));frames=0;statsAt=now;const alive=sim.entities.filter(e=>e.state!=='dead').length;$('performance').textContent=`${alive} 位居民 · ${fps} FPS · 二维碰撞已开启`;}
  $('coordinates').textContent=`X ${p.x.toFixed(2)}  /  Y ${p.y.toFixed(2)} 身长  ·  ${sim.touching?'接触边界':'自由移动'}`;
  collisionCooldown-=delta;if(sim.touching&&keys.size&&collisionCooldown<=0){toast('遇到边界 · 可以沿墙移动');collisionCooldown=3;}
  toastTime-=delta;if(toastTime<=0)$('toast').classList.remove('visible');
  requestAnimationFrame(animate);
}
$('loading').remove();if(!scripted)container.focus({preventScroll:true});requestAnimationFrame(animate);
let storyScript,storyFrame,storyColoring;
function fitStoryAct(index){
  const act=storyScript.acts[index],end=act.start+act.duration;
  overviewBounds.makeEmpty();
  for(const wall of wallBoundaries)for(const point of wall.vertices)overviewBounds.expandByPoint(point);
  const include=([x,y],r=.6)=>{
    overviewBounds.expandByPoint(new THREE.Vector2(x-r,y-r));overviewBounds.expandByPoint(new THREE.Vector2(x+r,y+r));
  };
  const start=sampleStory(storyScript,act.start);
  start.actors.forEach((actor,i)=>{
    const track=storyScript.tracks.get(actor.id),during=event=>event.at>=act.start&&event.at<end;
    if(!actor.visible&&!track.visible.some(event=>during(event)&&event.to))return;
    include(actor.position,storyScript.actors[i].size/2);
    for(const event of track.position)if(during(event)){include(event.to,storyScript.actors[i].size/2);if(event.via)include(event.via,storyScript.actors[i].size/2);}
  });
  for(const frame of [start,sampleStory(storyScript,end-.00001)])if(frame.observer)include(frame.observer.position);
  if(overviewBounds.isEmpty())overviewBounds.set(new THREE.Vector2(-1,-1),new THREE.Vector2(1,1));
  overviewZoom=1;
}
function seekStory(time){
  if(!storyScript)throw new Error('尚未载入故事');
  const previous=storyFrame;
  storyFrame=sim.seekScript(storyScript,time);
  const changed=previous?.actIndex!==storyFrame.actIndex;
  const atStart=time===storyScript.acts[storyFrame.actIndex].start;
  if(changed||time<previous?.time)for(const [id,mesh] of entityMeshes)if(mesh.userData.deathSeen)removeMesh(id);
  if(changed||atStart||time<previous?.time)storyCameraManual=false;
  if(changed||atStart)fitStoryAct(storyFrame.actIndex);
  if(storyFrame.observer&&!storyCameraManual){
    const {position:[x,y],angle}=storyFrame.observer;
    sim.player.body.setTranslation({x,y},true);sim.player.body.setRotation(angle*Math.PI/180,true);
  }
  const coloring=storyFrame.coloring??storyColoring;
  if(rules.coloring!==coloring){rules.coloring=coloring;lightRevision++;}
  for(const e of sim.entities){
    const mesh=entityMeshes.get(e.id);
    if(e.storyId&&mesh&&mesh.userData.storyPaint!==e.edgeColors.join(',')){updateMeshPaint(mesh,e);mesh.userData.storyPaint=e.edgeColors.join(',');}
  }
  return {time:storyFrame.time,actIndex:storyFrame.actIndex,ended:storyFrame.ended};
}
connectStudio('world',{
  ...(scripted?{story:{
    load(text){
      const next=parseStory(text);
      if(next.scene!==layout)throw new Error('故事场景与当前世界不一致，请重新载入场景');
      storyColoring??=rules.coloring;
      storyScript=next;storyFrame=undefined;sim.setScriptActors(next.actors,next.observer,rules.paintStyle);seekStory(0);
      if(!next.observer&&!next.acts[0].observer){
        const centre=overviewBounds.getCenter(new THREE.Vector2());
        const candidates=[{x:centre.x,y:overviewBounds.min.y-2},sim.home,{x:overviewBounds.max.x+2,y:centre.y}];
        const eye=(layout==='house'?[sim.home,...candidates]:candidates).find(p=>!sim.occupied(p,.1))??sim.home;
        sim.player.body.setTranslation(eye,true);sim.player.body.setRotation(Math.atan2(centre.y-eye.y,centre.x-eye.x),true);
      }
      const eye=sim.player.body.translation();
      for(const offset of [-.6,.6])overviewBounds.expandByPoint(new THREE.Vector2(eye.x+offset,eye.y+offset));
      return {title:next.title,duration:next.duration};
    },
    seek:seekStory,
    beginViewpoint(){setPerspective(0);perspective=0;},
    observeAt(x,y){
      if(![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('请在画面内选择观察点');
      const rect=container.getBoundingClientRect(),p=groundPoint({clientX:rect.left+x*rect.width,clientY:rect.top+y*rect.height});
      placeStoryCamera(p);
      const centre=overviewBounds.getCenter(new THREE.Vector2());
      pointCameraAt(centre);return {x:p.x,y:p.y};
    },
    snapshot:()=>storyFrame?structuredClone(storyFrame):null,
  }}:{}),
  configure(values){
    if(Object.hasOwn(values,'pathfinding'))sim.setPathfinding(values.pathfinding);
    if(Object.hasOwn(values,'residentKilling'))sim.setResidentKilling(values.residentKilling);
    if(Object.hasOwn(values,'deathAnimation'))deathAnimation=Boolean(values.deathAnimation);
    lightRevision++;
    if(Object.hasOwn(values,'population')){sim.population(values.population);fitOverview();}
    if(values.fitOverview)fitOverview();
    if(Number.isFinite(values.overviewZoom))overviewZoom=THREE.MathUtils.clamp(values.overviewZoom,.25,16);
    if(Object.hasOwn(values,'display')){
      expandOnArrival=values.display==='expanded';
      if(perspective===1&&lineOnly===expandOnArrival)setStretch(expandOnArrival);
    }
    for(const name of ['exposure','fog','detailGain','detailStyle','visionEffect','scatterDistance','scatterCurve','attenuationDistance','attenuationMode','attenuationCurve','attenuationFloor'])if(Object.hasOwn(values,name))rules[name]=values[name];
    maskRadius.value=rules.attenuationMode==='mask'?rules.attenuationDistance:0;
    if(rules.visionEffect==='attenuation')scatter.clear();
    for(const [material,key] of [['resident','residentEmission'],['house','houseEmission']])if(Object.hasOwn(values,key))rules.materials={...rules.materials,[material]:{...rules.materials[material],emission:values[key]}};
  },
  snapshot:()=>({status:$('performance').textContent,position:$('coordinates').textContent,observer:{...sim.player.body.translation(),angle:sim.player.body.rotation()},walkTarget:sim.walkTarget,pathfinding:sim.pathfinding,residentKilling:sim.residentKilling,deathAnimation,targetMarker:{visible:targetMarker.visible,x:targetMarker.position.x,y:targetMarker.position.y},lightingUpdates,observerScreen:new THREE.Vector3(overviewEye.value.x,overviewEye.value.y,PLANE_HEIGHT).project(camera).toArray().slice(0,2),layout,projection,canvasExtent:{width:canvasWidth,height:canvasHeight},overviewZoom,perspective:targetPerspective,cameraProgress:perspective,
    cameraGuide:{visible:ring.visible||cone.visible,manual:storyCameraManual},displayHeight:shapeHeight*perspective,cameraDirection:camera.getWorldDirection(new THREE.Vector3()).toArray(),
    rangeGuide:{visible:rangeCircle.visible,radius:rangeCircle.scale.x,x:observerGuide.position.x,y:observerGuide.position.y,rayLength:Math.hypot(sightGuides[0].line.geometry.attributes.position.getX(1),sightGuides[0].line.geometry.attributes.position.getY(1))},
    guideOrigins:{eye:[overviewEye.value.x,overviewEye.value.y,PLANE_HEIGHT],ring:ring.getWorldPosition(new THREE.Vector3()).toArray(),range:rangeCircle.getWorldPosition(new THREE.Vector3()).toArray(),rays:sightGuides.map(({line})=>line.localToWorld(new THREE.Vector3().fromBufferAttribute(line.geometry.attributes.position,0)).toArray())},
    mapLocked:!mapFollowsHeading,lineOnly,stretch,shapeHeight,windowHeight:flatWindow.value.y*100,windowBlend:flatWindow.value.x,planeHeight:PLANE_HEIGHT,geometryBottom:entityMeshes.get(sim.player.id)?.position.z,geometryHeight:entityMeshes.get(sim.player.id)?.scale.z,wallCenter:wallMeshes[0]?.position.z,wallHeight:wallMeshes[0]?.scale.z,cameraFov:camera.fov,cameraAspect:camera.aspect,renderedView:'world',renderCalls:renderer.info.render.calls,renderTriangles:renderer.info.render.triangles,renderPoints:renderer.info.render.points,observerVisible:Boolean(entityMeshes.get(sim.player.id)?.visible),population:sim.entities.filter(e=>e.state!=='dead').length,wandering:sim.wandering,
    deathEffects:{active:[...entityMeshes.values()].filter(m=>m.userData.death).length,visible:[...entityMeshes.values()].filter(m=>m.userData.deathSeen&&m.visible).length},
    optics:{displayEnhancement:rules.contour>0&&rules.detailGain>0,detailGain:rules.detailGain,detailStyle:rules.detailStyle??'sharp',visionEffect:rules.visionEffect,scatterDistance:rules.scatterDistance,scatterCurve:rules.scatterCurve,exposure:rules.exposure,fog:rules.fog,attenuationMode:rules.attenuationMode,attenuationCurve:rules.attenuationCurve,attenuationDistance:rules.attenuationDistance,attenuationFloor:rules.attenuationFloor,residentEmission:rules.materials.resident.emission,houseEmission:rules.materials.house.emission},
    paint:PAINT_STYLES[rules.paintStyle],interaction:sim.player.interaction,playerState:sim.player.state}),
});
