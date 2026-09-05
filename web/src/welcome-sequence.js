// A title choreography, in canvas coordinates. Each path has exactly one writer.
export const ENTRANCE_DURATION=8000;
export const HOLD_START=6200;
export const FADE_START=7450;
const WIDTH=72,HEIGHT=104,ADVANCE=100;
const clamp=value=>Math.max(0,Math.min(1,value));
const ease=value=>{const t=clamp(value);return t*t*(3-2*t);};
const line=(...points)=>points;
function curve(a,b,c,d){
  return Array.from({length:25},(_,i)=>{
    const t=i/24,u=1-t;
    return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];
  });
}
const glyphs={
  F:[line([0,1],[0,0]),line([0,0],[1,0]),line([0,.48],[.78,.48])],
  L:[line([0,0],[0,1]),line([0,1],[1,1])],
  A:[line([0,1],[.5,0]),line([.5,0],[1,1]),line([.23,.55],[.77,.55])],
  T:[line([0,0],[1,0]),line([.5,0],[.5,1])],
  N:[line([0,1],[0,0]),line([0,0],[1,1]),line([1,1],[1,0])],
  D:[line([0,1],[0,0]),curve([0,0],[.72,0],[1,.08],[1,.5]),curve([1,.5],[1,.92],[.72,1],[0,1])],
};

export function createEntranceStrokes(compact=false){
  const columns=compact?4:8,width=compact?460:920,height=compact?420:300;
  const left=(width-((columns-1)*ADVANCE+WIDTH))/2;
  let id=0;
  const strokes=[...'FLATLAND'].flatMap((letter,letterIndex)=>glyphs[letter].map((path,strokeIndex)=>{
    const x=left+(letterIndex%columns)*ADVANCE,y=(compact?62:88)+Math.floor(letterIndex/columns)*174;
    const points=path.map(([px,py])=>({x:x+px*WIDTH,y:y+py*HEIGHT}));
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
    const length=lengths.reduce((sum,n)=>sum+n,0),index=id++;
    return {
      id:index,letter,letterIndex,strokeIndex,points,lengths,length,
      // Dispersed residents move into place before their pen touches the page.
      origin:{x:Math.max(15,Math.min(width-15,x+36+Math.sin(index*2.4)*72)),y:Math.max(15,Math.min(height-15,y+52+(index%2?1:-1)*(82+(index%3)*17)))},
      start:350+letterIndex*340+strokeIndex*180,
      arrival:850,duration:1400+length/HEIGHT*500,
      sides:3+index%4,
    };
  }));
  return {width,height,strokes};
}

// Arc-length sampling keeps the resident on the exact end of its retained ink,
// including D's curved strokes and frames dropped by a busy browser.
export function pointOnStroke(stroke,progress){
  let remaining=clamp(progress)*stroke.length;
  for(let i=0;i<stroke.lengths.length;i++){
    const length=stroke.lengths[i];
    if(remaining<=length||i===stroke.lengths.length-1){
      const a=stroke.points[i],b=stroke.points[i+1],t=clamp(remaining/length);
      return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x),segment:i};
    }
    remaining-=length;
  }
}

export function sampleWriter(stroke,time){
  const ink=clamp((time-stroke.start-stroke.arrival)/stroke.duration);
  if(time<stroke.start+stroke.arrival){
    const t=ease((time-stroke.start)/stroke.arrival),a=stroke.origin,b=stroke.points[0];
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x),ink,segment:0};
  }
  return {...pointOnStroke(stroke,ink),ink};
}

export function sampleEntrance(time){
  return {
    opacity:1-ease((time-FADE_START)/(ENTRANCE_DURATION-FADE_START)),
    complete:time>=ENTRANCE_DURATION,
  };
}
