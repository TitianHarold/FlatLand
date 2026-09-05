import assert from 'node:assert/strict';
import {OPTICS_RULES,boundaryLighting,distanceAttenuation,surfaceLight,exposeLight,projectScene,exposeRow} from '../src/optics.js';
import {resident,makeColorField,makeCrowd,paintResident} from '../src/study-scene.js';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from '../src/paint.js';

// Independent light-lab checks; the studio owns verify.mjs.
const plain={...OPTICS_RULES,fog:0,contour:0};
const source={emission:1,nearest:0,radius:1,strength:0};
// The workbench uses a finite mask, independently of the legacy study curves.
const maskRules={...plain,attenuationMode:'mask',attenuationDistance:25,coloring:true,glow:false};
for(const attenuationCurve of ['smooth','linear','exponential','quadratic','inverse-square']){
  const rules={...maskRules,attenuationCurve};
  assert.equal(distanceAttenuation(0,rules),1);
  assert.equal(distanceAttenuation(25,rules),0);
  assert.equal(distanceAttenuation(40,rules),0);
  let previous=1;
  for(let d=0;d<=40;d+=.125){
    const value=distanceAttenuation(d,rules);
    assert(value>=0&&value<=previous,'Finite masks decrease monotonically to zero');previous=value;
    assert.equal(distanceAttenuation(d,{...rules,attenuationDistance:0}),1,'Disabling the mask removes its radius');
  }
}
const maskedEdge={material:'resident',vertices:[{x:-2,y:10},{x:2,y:10}],paintedEdges:[{a:{x:-2,y:10},b:{x:2,y:10},color:'#804020'}]};
for(const coloring of [true,false])for(const exposure of [1,12,64]){
  const rules={...maskRules,coloring,exposure,attenuationCurve:'linear'};
  const normal=exposeRow(projectScene([maskedEdge],401,{rules:{...rules,attenuationDistance:0}}),{...rules,attenuationDistance:0});
  const masked=exposeRow(projectScene([maskedEdge],401,{rules}),rules);
  for(let channel=0;channel<3;channel++)assert(Math.abs(masked[200*4+channel]-normal[200*4+channel]*.6)<=1,'The mask multiplies finished colour, including grayscale and high exposure');
  const outside={...rules,attenuationDistance:5};
  assert(exposeRow(projectScene([maskedEdge],401,{rules:outside}),outside).every((v,i)=>i%4===3?v===255:v===0),'A surface beyond the radius is opaque black');
  const observer={x:13,y:-7,heading:0},shift=p=>({x:p.x+observer.x,y:p.y+observer.y});
  const translated={...maskedEdge,vertices:maskedEdge.vertices.map(shift),paintedEdges:maskedEdge.paintedEdges.map(e=>({...e,a:shift(e.a),b:shift(e.b)}))};
  assert.deepEqual(exposeRow(projectScene([translated],401,{observer,rules}),rules),masked,'Moving the observer and scene together preserves the mask');
}
const darkFront={material:'house',vertices:[{x:-4,y:2},{x:4,y:2}]};
const blockedRules={...maskRules,materials:{...maskRules.materials,house:{emission:0}}};
assert(exposeRow(projectScene([darkFront,maskedEdge],401,{rules:blockedRules}),blockedRules).every((v,i)=>i%4===3?v===255:v===0),'A black foreground surface still occludes colour behind it');
const distances=[0,2,5,10,15,25];
assert.equal(distanceAttenuation(0),1);
assert.equal(distanceAttenuation(10),.625);
assert(Math.abs(distanceAttenuation(25)-.35344827586206895)<1e-12);
assert.equal(distanceAttenuation(3000,{attenuationDistance:0}),1);
for(let i=1;i<distances.length;i++)assert(distanceAttenuation(distances[i])<distanceAttenuation(distances[i-1]));
assert(Math.abs(distanceAttenuation(10-1e-5)-distanceAttenuation(10+1e-5))<1e-5,'No cutoff at the attenuation distance');
for(const attenuationCurve of ['smooth','linear','exponential','quadratic']){
  const settings={attenuationCurve,attenuationDistance:10};
  assert.equal(distanceAttenuation(0,settings),1);
  assert.equal(distanceAttenuation(10,settings),.625,'All curves share the same distance-scale midpoint');
  let previous=1;
  for(let d=0;d<=300;d+=.25){
    const value=distanceAttenuation(d,settings);
    assert(value>=.25&&value<=previous,'Curves decrease monotonically without crossing the floor');
    assert.equal(distanceAttenuation(d,{...settings,attenuationDistance:0}),1,'Disabled curves must be neutral');
    previous=value;
  }
  assert.equal(surfaceLight(25,source,{...plain,...settings}).light,1,'A curve must not rewrite material emission');
}
assert.equal(distanceAttenuation(5,{attenuationCurve:'linear'}),.8125);
assert.equal(distanceAttenuation(5,{attenuationCurve:'quadratic'}),.90625);
assert.equal(distanceAttenuation(20,{attenuationCurve:'exponential'}),.4375);
assert.equal(distanceAttenuation(20,{attenuationCurve:'linear'}),.25);
assert.equal(distanceAttenuation(15,{attenuationCurve:'quadratic'}),.25);
const grayAt=exposure=>distances.map(d=>exposeLight(surfaceLight(d,source,plain),{exposure}));
for(const exposure of [1,12,64]) {
  const gray=grayAt(exposure);
  assert(gray.every((v,i)=>i===0||v<gray[i-1]),'Absolute distance must remain visible at every exposure');
  assert(gray[0]-gray.at(-1)>100,'Exposure must not flatten the expected near/far difference');
}
assert.equal(surfaceLight(25,source,plain).light,1,'The reception mask cannot rewrite intrinsic emission');
const medium=surfaceLight(25,source,{...plain,fog:.1});
assert(Math.abs(medium.light-Math.exp(-2.5))<1e-12,'Medium transmission remains separate from reception');

// Separate objects must not reset the absolute-distance attenuation at their
// nearest points. Geometry size affects the detail cue, not the reception mask.
const near=boundaryLighting(resident(5,{y:6})),far=boundaryLighting(resident(5,{y:21}));
assert(exposeLight(surfaceLight(near.nearest,near))-exposeLight(surfaceLight(far.nearest,far))>90,'A distant object cannot regain full brightness at its own nearest point');
for(const radius of [.5,1,3]) {
  const shape=boundaryLighting(resident(5,{radius}),{},plain);
  assert.equal(surfaceLight(12,shape,plain).contrast,distanceAttenuation(12),'Reception distance is measured in world units, independent of object size');
}
const detailOn=surfaceLight(near.nearest+.4,near);
const detailOnly=surfaceLight(near.nearest+.4,near,{attenuationDistance:0});
const detailOff=surfaceLight(near.nearest+.4,near,{...OPTICS_RULES,attenuationMode:'mask',detailGain:0});
assert.equal(detailOff.contrast,1,'Zero detail gain fully disables local contrast');
assert.equal(detailOff.reception,distanceAttenuation(near.nearest+.4,{...OPTICS_RULES,attenuationMode:'mask'}),'Disabling detail preserves the range mask');
assert(Math.abs(detailOn.contrast-detailOnly.contrast*distanceAttenuation(near.nearest+.4))<1e-12,'Detail and absolute-distance reception must be independent factors');

// Contrast profiles change only relative-depth detail, never the range mask.
const profiles={};
for(const detailStyle of ['sharp','soft','velvet']){
  const settings={...OPTICS_RULES,attenuationMode:'mask',detailStyle,detailGain:8};
  profiles[detailStyle]=[0,.02,.1,.2].map(offset=>surfaceLight(near.nearest+offset,near,settings).contrast);
  assert(profiles[detailStyle].every((v,i,a)=>i===0||v<=a[i-1]),'Profile fades monotonically with depth');
  assert.equal(surfaceLight(near.nearest+.2,near,{...settings,detailGain:0}).contrast,1,'Every contrast profile turns fully off at zero');
}
assert(profiles.soft[1]>profiles.sharp[1],'Soft profile broadens the highlight');
assert(profiles.velvet[0]<profiles.soft[0]&&profiles.velvet[3]>profiles.sharp[3],'Velvet suppresses the bright peak while retaining broad depth layers');

// The same house object has two disconnected boundaries at different depths.
const boundaries=[[{x:-2,y:5},{x:-1,y:5}],[{x:3,y:15},{x:6,y:15}]];
const object={outline:[{x:-2,y:5},{x:-1,y:5},{x:6,y:15},{x:3,y:15}],boundaries};
const bodies=boundaries.map(vertices=>({material:'house',vertices,object}));
const grouped=projectScene(bodies,400,{rules:plain}),pixels=exposeRow(grouped,plain);
assert(pixels[140*4]>pixels[260*4]+70,'Near and far pieces of one house need distinct observer-centred reception');
assert.deepEqual(exposeRow(projectScene(bodies.map(({material,vertices})=>({material,vertices})),400,{rules:plain}),plain),pixels,'Grouping must not change absolute-distance reception when detail is disabled');

const observer={x:37,y:-21,heading:.72},c=Math.cos(observer.heading),s=Math.sin(observer.heading);
const transform=vertices=>vertices.map(p=>({x:observer.x+c*p.x+s*p.y,y:observer.y-s*p.x+c*p.y}));
const movedObject={outline:transform(object.outline),boundaries:boundaries.map(transform)};
const moved=movedObject.boundaries.map(vertices=>({material:'house',vertices,object:movedObject}));
const shifted=exposeRow(projectScene(moved,400,{observer,rules:plain}),plain);
assert(shifted.every((v,i)=>Math.abs(v-pixels[i])<=1),'Observer translation and heading must preserve relative reception');

// Tiny sources keep geometric coverage and contribute through the same mask.
const clear={...plain,attenuationDistance:0};
const distant=projectScene([resident(7,{y:3000})],400,{rules:plain});
const unmasked=projectScene([resident(7,{y:3000})],400,{rules:clear});
assert(distant.coverage>0&&distant.coverage<1);
assert.deepEqual(distant.light,unmasked.light,'Reception must preserve subpixel light integration');
const star=exposeRow(distant,plain);
assert(Math.max(...star.filter((_,i)=>i%4===0))>20,'The far-tail reception floor must retain visible star points');
const empty=exposeRow(projectScene([],400));
assert(empty.every((v,i)=>i%4===3?v===255:v===0),'Empty directions remain black');
const blocker={material:'house',vertices:[{x:-2,y:2},{x:2,y:2},{x:2,y:3},{x:-2,y:3}]};
const darkHouse={...plain,materials:{...OPTICS_RULES.materials,house:{emission:0}}};
assert(exposeRow(projectScene([blocker,resident(5)],400,{rules:darkHouse}),darkHouse).every((v,i)=>i%4===3?v===255:v===0),'No reception mask may reveal an occluded source');

const pentagon=exposeRow(projectScene([resident(5,{angle:Math.PI/5})],152));
const row=Array.from({length:152},(_,i)=>pentagon[i*4]);
assert(row[75]>row[67]+12&&row[67]>row[66]+25&&row[66]>row[65]+15,'Reception must preserve the pentagon front-to-side gradient');
assert(row[65]>70,'The receding side remains visible at the default study distance');
console.log(JSON.stringify({opticsChecks:'absolute distance, exposure, intrinsic emission, medium transmission, independent detail, object grouping, observer pose, subpixel stars, occlusion, pentagon gradient',distances,defaultGray:grayAt(12),starPeak:Math.max(...star.filter((_,i)=>i%4===0)),pentagonGray:[row[75],row[67],row[66],row[65]]},null,2));

// Color belongs to visible edge fragments, with one scalar exposure shared by
// all channels. Turning coloring off must reproduce the original grayscale.
const coloredRules={...plain,coloring:true,glow:false};
const paint={material:'resident',vertices:[{x:-2,y:6},{x:2,y:6}],paintedEdges:[
  {a:{x:-2,y:6},b:{x:0,y:6},color:'#FFE36E'},
  {a:{x:0,y:6},b:{x:2,y:6},color:'#F08060'},
]};
const painted=exposeRow(projectScene([paint],401,{rules:coloredRules}),coloredRules);
const grayRules={...coloredRules,coloring:false};
const grayPainted=exposeRow(projectScene([paint],401,{rules:grayRules}),grayRules);
const unpainted={material:paint.material,vertices:paint.vertices};
assert.deepEqual(grayPainted,exposeRow(projectScene([unpainted],401,{rules:grayRules}),grayRules),'Disabled coloring must be byte-identical to original geometry and grayscale');
const rgb=(image,pixel)=>Array.from(image.slice(pixel*4,pixel*4+3));
assert(painted[165*4]>painted[165*4+1]&&painted[165*4+1]>painted[165*4+2],'The left visible half must carry its warm color');
assert(painted[235*4+1]<painted[165*4+1]-50,'The right half must retain its distinct paint');
const wallTint=PAINT_STYLES[DEFAULT_PAINT_STYLE].wall.slice(1).match(/../g).map(hex=>parseInt(hex,16));
const wall={...unpainted,material:'house'};
const wallPixels=exposeRow(projectScene([wall],401,{rules:coloredRules}),coloredRules);
const wallGray=exposeRow(projectScene([wall],401,{rules:grayRules}),grayRules)[200*4];
assert.deepEqual(rgb(wallPixels,200),wallTint.map(v=>Math.round(wallGray*v/255)),'House paint must use the centralized muted blue-gray color and scalar brightness');
for(const distance of [6,24])for(const exposure of [1,12,64]){
  const body={material:'resident',vertices:[{x:-2,y:distance},{x:2,y:distance}],paintedEdges:[{a:{x:-2,y:distance},b:{x:2,y:distance},color:'#F08060'}]};
  const settings={...coloredRules,exposure};
  const gray=exposeLight(surfaceLight(distance,boundaryLighting(body,{},settings),settings),settings);
  const image=exposeRow(projectScene([body],401,{rules:settings}),settings);
  assert.deepEqual(rgb(image,200),[240,128,96].map(v=>Math.round(gray*v/255)),'Distance and exposure must preserve hue instead of saturating channels to white');
}
const hidden={...paint,vertices:paint.vertices.map(p=>({x:p.x,y:p.y+2})),paintedEdges:paint.paintedEdges.map(edge=>({a:{x:edge.a.x,y:edge.a.y+2},b:{x:edge.b.x,y:edge.b.y+2},color:'#00FF00'}))};
assert.deepEqual(exposeRow(projectScene([paint,hidden],401,{rules:coloredRules}),coloredRules),painted,'Hidden colored edges must not leak into the view');
const starBody=(left,right,color)=>{
  const a={x:(left/50-1)*1000,y:1000},b={x:(right/50-1)*1000,y:1000};
  return {material:'resident',vertices:[a,b],paintedEdges:[{a,b,color}]};
};
const stars=projectScene([starBody(50.1,50.2,'#FF0000'),starBody(50.3,50.4,'#0000FF')],100,{rules:{...coloredRules,attenuationDistance:0}});
const mixed=exposeRow(stars,coloredRules);
assert(mixed[200]>0&&mixed[202]>0&&mixed[201]===0,'Subpixel sources in one pixel must mix visible colors');
assert(Math.abs(mixed[200]-mixed[202])<=1,'Equal red and blue fragments must have equal weights');
const emptyColor=exposeRow(projectScene([],400,{rules:coloredRules}),{...coloredRules,glow:true});
assert(emptyColor.every((v,i)=>i%4===3?v===255:v===0),'Color cannot illuminate empty space');
console.log(JSON.stringify({colorChecks:'painted halves, exact grayscale switch, cold walls, hue under distance and exposure, occlusion, subpixel mixture, empty black',warmHalves:[rgb(painted,165),rgb(painted,235)],coldWall:rgb(wallPixels,200)},null,2));

// Matte is a shared display option: softer bright tones and resolved edges,
// with unchanged source energy, faint stars, and the order of depth cues.
const matte={...OPTICS_RULES,finish:'matte'};
const matteView=angle=>exposeRow(projectScene([resident(5,{angle})],152),matte);
const matteFront=matteView(Math.PI/5),matteLeft=matteView(Math.PI/5+.3),matteRight=matteView(Math.PI/5-.3);
const matteGray=[75,67,66,65].map(i=>matteFront[i*4]);
assert(matteGray[0]<row[75]-15,'Matte must visibly soften the bright front');
assert(matteGray[0]>matteGray[1]+5&&matteGray[1]>matteGray[2]+30&&matteGray[2]>matteGray[3]+20,'Matte must retain distinct front and receding sides');
assert(matteGray[3]>=row[65],'Matte must not darken the already dim far side');
assert(matteLeft.every((v,i)=>Math.abs(v-matteRight[(151-Math.floor(i/4))*4+i%4])<=1),'Matte depth cues must rotate symmetrically with geometry');
const matteProjection=projectScene([resident(5,{angle:Math.PI/5})],152,{rules:matte});
assert.deepEqual(matteProjection,projectScene([resident(5,{angle:Math.PI/5})],152),'Matte cannot alter projection, visibility or emitted light');
assert(matteProjection.light.every((v,i)=>v>0||matteFront[i*4]===0),'Resolved matte boundaries must not generate exterior halos');
assert.deepEqual(exposeRow(distant,{...plain,finish:'matte'}),star,'Faint subpixel stars must keep their brightness and halo');
for(const exposure of [1,12,64]){
  const shape=boundaryLighting(resident(5,{angle:Math.PI/5}));
  const tones=[0,.05,.2,.5,1].map(offset=>exposeLight(surfaceLight(shape.nearest+offset,shape),{exposure,finish:'matte'}));
  assert(tones.every((v,i)=>i===0||v<tones[i-1]),'Matte highlights must not clip nearby distances to one tone');
}
const mattePaint=exposeRow(projectScene([paint],401,{rules:coloredRules}),{...coloredRules,finish:'matte'});
const mattePaintGray=exposeRow(projectScene([paint],401,{rules:grayRules}),{...grayRules,finish:'matte'});
assert.deepEqual(rgb(mattePaint,235),[240,128,96].map(v=>Math.round(mattePaintGray[235*4]*v/255)),'Matte must preserve paint hue through shared scalar exposure');
assert(exposeRow(projectScene([],100),matte).every((v,i)=>i%4===3?v===255:v===0),'Matte empty directions remain black');
console.log(JSON.stringify({matteChecks:'soft highlights, visible far sides, rotating depth cues, unchanged projection, resolved edges, preserved stars, hue and empty black',frontToSideGray:matteGray},null,2));

// Clear light restores luminous middle/high tones without flattening geometry
// or making dim contours and subpixel residents disappear.
const clearFinish={...OPTICS_RULES,finish:'clear'};
const clearFront=exposeRow(matteProjection,clearFinish);
const clearGray=[75,67,66,65].map(i=>clearFront[i*4]);
assert(clearGray[0]>matteGray[0]+30,'Clear light must visibly recover the front brightness lost to the matte shoulder');
assert(clearGray[0]>clearGray[1]+3&&clearGray[1]>clearGray[2]+15&&clearGray[2]>clearGray[3]+10,'Colour-field depth must remain ordered without the old harsh display-space contrast');
assert(clearGray[3]>=matteGray[3],'Clear light must keep the far side visible');
assert(new Set(Array.from({length:8},(_,i)=>clearFront[(68+i)*4])).size>=3,'The broad front edge must retain a gentle continuous distance gradient');
assert(matteProjection.light.every((v,i)=>v>0||clearFront[i*4]===0),'Clear resolved boundaries must retain their clean exterior');
assert.deepEqual(projectScene([resident(5,{angle:Math.PI/5})],152,{rules:clearFinish}),matteProjection,'Finish cannot change physical emission, coverage or occlusion');
assert(Math.max(...exposeRow(distant,{...plain,finish:'clear'}).filter((_,i)=>i%4===0))>=Math.max(...star.filter((_,i)=>i%4===0)),'The new reception must retain rather than extinguish distant stars');
for(const exposure of [1,12,64]){
  const shape=boundaryLighting(resident(5,{angle:Math.PI/5}));
  const tones=[0,.05,.2,.5,1].map(offset=>exposeLight(surfaceLight(shape.nearest+offset,shape),{exposure,finish:'clear'}));
  assert(tones.every((v,i)=>i===0||v<tones[i-1]),'Clear highlights must preserve depth even at high exposure');
  const settings={...coloredRules,exposure,finish:'clear'};
  const image=exposeRow(projectScene([paint],401,{rules:settings}),settings);
  const grayscale=exposeRow(projectScene([paint],401,{rules:{...settings,coloring:false}}),{...settings,coloring:false});
  assert.deepEqual(rgb(image,235),[240,128,96].map(v=>Math.round(grayscale[235*4]*v/255)),'Clear exposure must retain paint hue');
}
const clearLeft=exposeRow(projectScene([resident(5,{angle:Math.PI/5+.3})],152),clearFinish);
const clearRight=exposeRow(projectScene([resident(5,{angle:Math.PI/5-.3})],152),clearFinish);
assert(clearLeft.every((v,i)=>Math.abs(v-clearRight[(151-Math.floor(i/4))*4+i%4])<=1),'Clear depth cues rotate symmetrically with the actual boundary');
assert(exposeRow(projectScene([],100),clearFinish).every((v,i)=>i%4===3?v===255:v===0),'Clear empty directions remain black');
console.log(JSON.stringify({clearChecks:'luminous front, visible far sides, continuous gradient, stable stars, unchanged geometry, exposure, hue, rotation and empty black',frontToSideGray:clearGray},null,2));

// Colour concentration is a surface display rule, never visibility/alpha.
const washRules={...clearFinish,coloring:true,attenuationMode:'wash',contour:0,fog:0,glow:false};
const washedAt=(distance,mode='wash')=>{
  const a={x:-2,y:distance},b={x:2,y:distance};
  const body={material:'resident',vertices:[a,b],paintedEdges:[{a,b,color:'#E88970'}]};
  const settings={...washRules,attenuationMode:mode};
  return rgb(exposeRow(projectScene([body],401,{rules:settings}),settings),200);
};
const washDistances=[3,6,15,25,100],washed=washDistances.map(d=>washedAt(d));
const shades=washDistances.map(d=>washedAt(d,'brightness'));
assert(shades.every((v,i)=>i===0||v.every((channel,c)=>channel<shades[i-1][c])),'Brightness mode must darken a distant painted surface');
assert(washed.every((v,i)=>i===0||v[0]-v[2]<washed[i-1][0]-washed[i-1][2]),'Wash mode must progressively dilute chroma toward the environmental colour');
assert(washed.at(-1)[0]-washed.at(-1)[2]>30&&Math.max(...washed.at(-1))<250,'Far paint must retain colour rather than clip to white');
assert(washedAt(25)[1]>washedAt(25,'brightness')[1]+80,'The two attenuation modes must make a visibly different result');
assert.deepEqual(exposeRow(projectScene([paint,hidden],401,{rules:washRules}),washRules),exposeRow(projectScene([paint],401,{rules:washRules}),washRules),'A washed opaque surface must still fully hide paint behind it');
for(const projection of ['perspective','equidistant']){
  const observer={projection,fov:179*Math.PI/180};
  assert.deepEqual(exposeRow(projectScene([paint,hidden],401,{observer,rules:washRules}),washRules),exposeRow(projectScene([paint],401,{observer,rules:washRules}),washRules),'Colour dilution must not reveal occluded paint even in a near-180-degree source row');
}
const washEmpty=exposeRow(projectScene([],401,{rules:washRules}),washRules);
assert(washEmpty.every((v,i)=>i%4===3?v===255:v===0),'Environmental tint is not a light source in empty space');
const noAttenuation={...washRules,attenuationDistance:0};
assert.deepEqual(exposeRow(projectScene([paint],401,{rules:noAttenuation}),noAttenuation),exposeRow(projectScene([paint],401,{rules:{...noAttenuation,attenuationMode:'brightness'}}),{...noAttenuation,attenuationMode:'brightness'}),'Disabling reception removes both forms of distance attenuation');
const field=makeColorField({angle:.4}),fieldCopy=structuredClone(field);
const fieldImage=exposeRow(projectScene(field,800,{rules:washRules}),washRules);
assert.deepEqual(field,fieldCopy,'Projection must never modify source paint or geometry');
assert.notDeepEqual(fieldImage,exposeRow(projectScene(makeColorField({angle:.4,details:false}),800,{rules:washRules}),washRules),'The near fine segments must remain visible against the colour fields');
assert.notDeepEqual(fieldImage,exposeRow(projectScene(makeColorField({angle:.8}),800,{rules:washRules}),washRules),'Rotation must reveal different genuinely visible painted boundaries');
console.log(JSON.stringify({washChecks:'distance dilution, colour retention, distinct modes, real occlusion, empty black, disable switch, fine segments and moving paint',distances:washDistances,brightness:shades,concentration:washed},null,2));

// Independent projection checks: analytic ray distances, exact endpoint
// positions, off-centre subpixel sources, camera pose and foreground blocking.
for(const projection of ['perspective','equidistant'])for(const degrees of [60,120,160,179]){
  const width=400,fov=degrees*Math.PI/180,eye={projection,fov};
  const rayRules={...OPTICS_RULES,fog:.1,contour:0,attenuationDistance:0,glow:false};
  const plane={material:'resident',vertices:[{x:-1000,y:5},{x:1000,y:5}]};
  const planeImage=exposeRow(projectScene([plane],width,{observer:eye,rules:rayRules}),rayRules);
  for(const pixel of [0,31,100,199,200,300,368,399]){
    const u=(pixel+.5)/width;
    const theta=projection==='equidistant'?(u-.5)*fov:Math.atan((2*u-1)*Math.tan(fov/2));
    const expected=exposeLight({light:Math.exp(-.1*5/Math.cos(theta))},rayRules);
    assert.equal(planeImage[pixel*4],expected,'Pixel integration must use the actual ray distance in each projection');
  }
  const xAt=(u,y)=>y*(projection==='equidistant'?Math.tan((u/width-.5)*fov):(2*u/width-1)*Math.tan(fov/2));
  const interval=(left,right,y,material='resident')=>({material,vertices:[{x:xAt(left,y),y},{x:xAt(right,y),y}]});
  const emptyMedium={...rayRules,fog:0};
  for(const [left,right,coverage] of [[-.25,.25,.25],[199.75,200.25,.5],[399.75,400.25,.25],[73.1,73.4,.3]]){
    const image=projectScene([interval(left,right,10)],width,{observer:eye,rules:emptyMedium});
    assert(Math.abs(image.coverage-coverage)<1e-8,'Left edge, centre, right edge and subpixel width must match the selected mapping');
    assert(Math.abs(image.light.reduce((a,b)=>a+b,0)-coverage)<1e-8,'Subpixel energy must be integrated instead of point-sampled');
  }
  const target=interval(73.1,73.4,10);
  const reference=projectScene([target],width,{observer:eye,rules:emptyMedium});
  const shifted=projectScene([{...target,vertices:transform(target.vertices)}],width,{observer:{...observer,...eye},rules:emptyMedium});
  assert(shifted.light.every((v,i)=>Math.abs(v-reference.light[i])<1e-9),'Turning and moving the observer with the scene must preserve projected intervals');
  const settings={...emptyMedium,materials:{...OPTICS_RULES.materials,house:{emission:0}}};
  const hiddenImage=exposeRow(projectScene([interval(73,74,5,'house'),target],width,{observer:eye,rules:settings}),settings);
  assert(hiddenImage.every((v,i)=>i%4===3?v===255:v===0),'A dark foreground must occlude subpixel light in either mapping');
}
assert.throws(()=>projectScene([],100,{observer:{projection:'invalid'}}),/Unknown optical projection/);
for(const fov of [0,-1,Math.PI,Infinity,NaN])assert.throws(()=>projectScene([],100,{observer:{fov}}),/field of view/);

// Optical-only scale probe; this is not a physics or whole-frame benchmark.
const largeCrowd=makeCrowd(2000).map((p,i)=>paintResident(resident(p.sides,{...p,angle:p.angle}),i));
const samples=[];
for(let run=0;run<4;run++){
  const start=performance.now();
  const result=exposeRow(projectScene(largeCrowd,1280,{observer:{fov:120*Math.PI/180,projection:'equidistant'},rules:washRules}),washRules);
  if(run)samples.push(performance.now()-start);
  assert.equal(result.length,1280*4);
  assert(result.some((v,i)=>i%4!==3&&v>0),'A large crowd must produce a visible colour image');
}
console.log(JSON.stringify({projectionChecks:'perspective/equidistant at 60/120/160/179 degrees, analytic distances, endpoints, subpixels, pose and opaque colour dilution',optical2000MedianMs:Number(samples.sort((a,b)=>a-b)[1].toFixed(2))},null,2));

// Pure scattering preserves in-range surface energy; the finite range is still shared.
{
  const shape={emission:1,nearest:0,radius:1,strength:0};
  const rules={...OPTICS_RULES,attenuationMode:'mask',attenuationDistance:20,fog:0,visionEffect:'scatter'};
  for(const distance of [0,1,10,19.99])assert.equal(surfaceLight(distance,shape,rules).reception,1);
  for(const distance of [20,21,100])assert.equal(surfaceLight(distance,shape,rules).reception,0);
  assert.equal(surfaceLight(100,shape,{...rules,attenuationDistance:0}).reception,1);
  assert(surfaceLight(10,shape,{...rules,visionEffect:'both'}).reception<1);
}
