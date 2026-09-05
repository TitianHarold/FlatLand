import RAPIER from '@dimforge/rapier2d-compat';
import {PAINT_STYLES,DEFAULT_PAINT_STYLE} from './paint.js';
import {MIN_SIZE,MAX_SIZE} from './measure.js';
export {MIN_SIZE,MAX_SIZE} from './measure.js';

// Size is the circumcircle diameter in body lengths; angles are radians.
export const DEFAULT_SIZE=MAX_SIZE;
// Boundary paint stays in body coordinates, mirrored about the local +X head.
// Bands index a palette's head (0), middle (1), and tail (2) colors.
const front=PAINT_STYLES[DEFAULT_PAINT_STYLE].residents[0][0];
const regularBands=[
  [0,2,0],
  [0,2,2,0],
  [0,1,2,1,0],
  [0,1,2,2,1,0],
];
export const characterTypes = [
  {id:'woman', name:'女性', shape:{kind:'segment'}, color:front, paintBands:[2,0]},
  {id:'narrow-triangle', name:'狭长三角形', shape:{kind:'triangle', baseRatio:.5/11}, color:front, paintBands:[0,2,0]},
  ...[3,4,5,6].map((sides,i)=>({
    id:`regular-${sides}`, name:['正三角形','正方形','正五边形','正六边形'][i],
    shape:{kind:'regular', sides}, color:front, paintBands:regularBands[i],
  })),
];

// Stories can instantiate more regular polygons without changing the studio's
// six default residents. They use the same Character geometry and paint bands.
export function getCharacterType(id) {
  const known=characterTypes.find(type=>type.id===id);
  if(known)return known;
  const sides=/^regular-([1-9][0-9]*)$/.test(id)?Number(id.slice(8)):0;
  if(!Number.isInteger(sides)||sides<3||sides>128)return undefined;
  return {id,name:`正${sides}边形`,shape:{kind:'regular',sides},color:front,
    paintBands:Array.from({length:sides},(_,i)=>{const x=Math.cos((i+.5)*2*Math.PI/sides);return x>.5?0:x<-.5?2:1;})};
}

export class Character {
  constructor(id, type, {shape=type.shape, color, name=type.name,size=DEFAULT_SIZE,paintStyle=DEFAULT_PAINT_STYLE,paintVariant}={}) {
    if(!Number.isFinite(size)||size<MIN_SIZE||size>MAX_SIZE)throw new RangeError(`角色体型必须在 ${MIN_SIZE} 到 ${MAX_SIZE} 身长之间`);
    this.id=id; this.typeId=type.id; this.name=name;
    this.shape=structuredClone(shape); this.size=size;
    this.paintBands=[...(type.paintBands??[0])];
    const seed=[...String(id)].reduce((value,c)=>(value*31+c.codePointAt(0))>>>0,0);
    this.paintVariant=paintVariant??seed;
    if(!Number.isInteger(this.paintVariant)||this.paintVariant<0)throw new RangeError('配色变体必须是非负整数');
    this.setPaintStyle(paintStyle);
    if(color){this.color=color;this.edgeColors=[color];}
    this.crimeCoefficient=null; this.socialClass=null;
    this.state='alive'; this.deathCause=null; this.interaction='kill';
    this.contacts=new Set(); this.collisionCount=0;
    this.drive={x:0,y:0,angular:0};
    this.body=null; this.collider=null;
  }

  get sides() { return this.shape.kind==='segment'?null:this.vertices.length; }

  // Every character faces local +X. The line's tail is its local -X end.
  get head() { return this.vertices[this.shape.kind==='segment'?1:0]; }
  get tail() { return this.shape.kind==='segment'?this.vertices[0]:null; }
  get radius() { return this.size/2; }

  setPaintStyle(id) {
    if(!Object.hasOwn(PAINT_STYLES,id))throw new RangeError(`未知配色风格：${id}`);
    const palettes=PAINT_STYLES[id].residents,colors=palettes[this.paintVariant%palettes.length];
    this.paintStyle=id;this.color=colors[0];
    this.edgeColors=this.paintBands.map(band=>colors[band]);
    return this;
  }

  // Rendering data only: splitting the woman's paint never splits her collider.
  get paintedEdges() {
    const vertices=this.vertices;
    if(this.shape.kind==='segment')vertices.splice(1,0,{x:0,y:0});
    const count=this.shape.kind==='segment'?2:vertices.length;
    return Array.from({length:count},(_,i)=>({
      a:vertices[i],b:vertices[(i+1)%vertices.length],color:this.edgeColors[i%this.edgeColors.length],
    }));
  }

  get vertices() {
    const s=this.shape,r=this.radius;
    if(s.kind==='segment')return [{x:-r,y:0},{x:r,y:0}];
    if(s.kind==='triangle'){
      const halfWidth=r*s.baseRatio,back=-Math.sqrt(r*r-halfWidth*halfWidth);
      return [{x:r,y:0},{x:back,y:halfWidth},{x:back,y:-halfWidth}];
    }
    return Array.from({length:s.sides},(_,i)=>({x:Math.cos(i*2*Math.PI/s.sides)*r,y:Math.sin(i*2*Math.PI/s.sides)*r}));
  }

  attach(world, {x=0,y=0,angle=0}={}) {
    if(this.body)throw new Error('角色已经放入物理世界');
    if(this.state==='dead')throw new Error('死亡角色不能重新放置');
    this.world=world;
    this.body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y).setRotation(angle).setLinearDamping(5).setAngularDamping(7).setCcdEnabled(true));
    const vertices=this.vertices;
    const desc=this.shape.kind==='segment'
      // A zero-area segment needs explicit mass and rotational inertia.
      ?RAPIER.ColliderDesc.segment(...vertices).setMassProperties(1,{x:0,y:0},(this.radius*2)**2/12)
      :RAPIER.ColliderDesc.convexHull(new Float32Array(vertices.flatMap(p=>[p.x,p.y]))).setMass(1);
    this.collider=world.createCollider(desc.setContactSkin(.0003).setFriction(.1).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),this.body);
    return this;
  }

  // Explicit input only; no autonomous controller. Releasing input stops the drive.
  move({forward=0,side=0,turn=0,speed=.8}={}) {
    if(!this.body||this.state==='dead')return;
    const angle=this.body.rotation(),c=Math.cos(angle),s=Math.sin(angle);
    const pace=speed/Math.max(1,Math.hypot(forward,side));
    const velocity={x:(c*forward-s*side)*pace,y:(s*forward+c*side)*pace};
    // Keep intended motion: collision impulses may already have stopped the body
    // when the event arrives. Positive side is left relative to the head.
    this.drive={...velocity,angular:turn*1.5};
    for(const other of this.contacts){
      if(!(other instanceof Character)||other.state==='dead')continue;
      const contact=this.collider.contactCollider(other.collider,.002);
      if(!contact)continue;
      if(this.approaches(contact)){
        if(!this.interact(other,contact))return;
      }
    }
    this.body.setLinvel(velocity,true);
    this.body.setAngvel(turn*1.5,true);
  }

  setInteraction(interaction) {
    if(!['kill','touch'].includes(interaction))throw new RangeError('交互方式必须是击杀或触摸');
    if(this.state!=='dead')this.interaction=interaction;
  }

  stop() {
    this.drive={x:0,y:0,angular:0};
    if(!this.body||this.state==='dead')return;
    this.body.setLinvel({x:0,y:0},true);this.body.setAngvel(0,true);
  }

  approaches(contact) {
    const p=this.body.translation(),v=this.drive;
    // Velocity at the actual contact point includes the rotational sweep.
    return (v.x-v.angular*(contact.point1.y-p.y))*contact.normal1.x
      +(v.y+v.angular*(contact.point1.x-p.x))*contact.normal1.y>1e-6;
  }

  hitsWithCorner(other) {
    const vertices=this.vertices,tolerance=this.size*.0001;
    let corner=false;
    // Read the full contact patch from collision detection, before solver motion
    // can turn a vertex impact into a later edge contact. A single witness point
    // is insufficient: flat edge contact can report a vertex at either end.
    this.world.contactPair(this.collider,other.collider,(manifold,flipped)=>{
      const tips=[],distances=Array.from({length:manifold.numContacts()},(_,i)=>manifold.contactDist(i));
      const nearest=Math.min(...distances);
      for(let i=0;i<distances.length;i++){
        // CCD may report the pre-impact gap; only the nearest points strike first.
        if(distances[i]>nearest+tolerance)continue;
        const p=flipped?manifold.localContactPoint2(i):manifold.localContactPoint1(i);
        if(p)tips.push(vertices.findIndex(v=>Math.hypot(p.x-v.x,p.y-v.y)<=tolerance));
      }
      if(tips.length&&tips[0]>=0&&tips.every(index=>index===tips[0]))corner=true;
    });
    return corner;
  }

  interact(other,contact=this.collider.contactCollider(other.collider,.002)) {
    if(this.state==='dead'||other.state==='dead'||!contact)return false;
    if(this.interaction==='kill'&&this.approaches(contact)&&this.hitsWithCorner(other)){
      other.die('killed');return true;
    }
    this.stop();other.stop();return false;
  }

  // The caller supplies the actor driving this contact, never a collider-order guess.
  onCollision(other, started, initiator=null) {
    if(!started){this.contacts.delete(other);return;}
    if(this.state==='dead'||other?.state==='dead')return;
    if(!this.contacts.has(other))this.collisionCount++;
    this.contacts.add(other);
    if(other instanceof Character){
      if(!other.contacts.has(this))other.collisionCount++;
      other.contacts.add(this);
      if(initiator===this)this.interact(other);
    }
  }

  injure() { if(this.state==='alive')this.state='injured'; }

  die(cause='manual') {
    if(this.state==='dead')return;
    this.state='dead';this.deathCause=cause;
    for(const other of this.contacts)if(other instanceof Character)other.contacts.delete(this);
    this.contacts.clear();
    // Keep the last pose for display; the dead character no longer participates in physics.
    this.body?.setEnabled(false);
  }
}

export {RAPIER};
