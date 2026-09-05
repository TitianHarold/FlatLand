import {characterTypes,getCharacterType,MIN_SIZE,MAX_SIZE} from './characters.js';
import {createRandom} from './random.js';

// JSON v1: seconds within each act, XY in body lengths, absolute angles in
// degrees (0 = +X, positive = counterclockwise). Acts share one continuous cast.
export const STORY_LIMITS={bytes:4*1024*1024,actors:2048,acts:100,actions:20000,seconds:3600};
const fail=(path,message)=>{throw new Error(`${path}：${message}`);};
function object(value,path,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'需要对象');
  for(const key of Object.keys(value))if(!keys.includes(key))fail(`${path}.${key}`,'未知字段');
}
function string(value,path,max=200){
  if(typeof value!=='string'||!value.trim()||value.length>max)fail(path,`需要 1—${max} 个字符`);
  return value;
}
function number(value,path,min,max){
  if(!Number.isFinite(value)||value<min||value>max)fail(path,`需要 ${min}—${max} 之间的数字`);
  return value;
}
function position(value,path){
  if(!Array.isArray(value)||value.length!==2)fail(path,'需要 [x, y]');
  return value.map((n,i)=>number(n,`${path}[${i}]`,-10000,10000));
}
function color(value,path){
  if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail(path,'需要 #RRGGBB 颜色');
  return value.toLowerCase();
}
function boolean(value,path){if(typeof value!=='boolean')fail(path,'需要 true 或 false');return value;}
function list(value,path,min,max){
  if(!Array.isArray(value)||value.length<min||value.length>max)fail(path,`需要 ${min}—${max} 项`);
}
function integer(value,path,min,max){number(value,path,min,max);if(!Number.isInteger(value))fail(path,'需要整数');return value;}

// Shared by generated paths and the player; generators emit the same bounded
// data actions as hand-authored stories, never JavaScript or a second renderer.
function motionValue(event,time){
  let t=event.duration?Math.max(0,Math.min(1,(time-event.at)/event.duration)):1;
  if(event.sway)return event.from+Math.sin(t*event.duration/event.sway.period*Math.PI*2)*event.sway.angle;
  if(event.easing==='smooth')t=t*t*(3-2*t);
  else if(event.easing==='ease-in')t*=t;
  else if(event.easing==='ease-out')t=1-(1-t)**2;
  return Array.isArray(event.from)?event.from.map((n,i)=>event.via?(1-t)**2*n+2*(1-t)*t*event.via[i]+t*t*event.to[i]:n+(event.to[i]-n)*t)
    :event.from+(event.to-event.from)*t;
}

const actorKeys=['id','name','type','size','position','angle','color','coloring','visible'];
const actionKeys=['at','actor','duration','move','turn','color','coloring','visible','interaction','easing','via','face','sway'];
const actKeys=['title','text','duration','actions','coloring','observer','collision'];
function expandStory(data){
  const random=createRandom(integer(data.seed??1,'seed',0,0xffffffff)),between=([lo,hi])=>lo+(hi-lo)*random();
  list(data.actors??[],'actors',0,STORY_LIMITS.actors);
  const actors=[...(data.actors??[])],groups=new Map();
  actors.forEach((actor,i)=>object(actor,`actors[${i}]`,actorKeys));
  list(data.groups??[],'groups',0,STORY_LIMITS.actors);
  for(const [i,group] of (data.groups??[]).entries()){
    const p=`groups[${i}]`;object(group,p,[...actorKeys,'count']);
    const id=string(group.id,`${p}.id`,50),count=integer(group.count,`${p}.count`,1,STORY_LIMITS.actors);
    if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)||groups.has(id))fail(p,'需要唯一的英文群体 ID');
    if(actors.length+count>STORY_LIMITS.actors)fail(p,'展开后角色不得超过 2048');
    const {count:unused,...base}=group,members=[];
    for(let n=1;n<=count;n++){
      const member=`${id}_${n}`;members.push(member);
      actors.push({position:[0,0],visible:false,...base,id:member,name:`${group.name??id} ${n}`});
    }
    groups.set(id,members);
  }
  const byId=new Map(actors.map(a=>[a.id,a]));
  if(byId.size!==actors.length||[...groups.keys()].some(id=>byId.has(id)))fail('groups','群体与角色 ID 需要唯一，不能重复');
  const select=value=>{
    const result=(Array.isArray(value)?value:[value]).flatMap(part=>{
      if(typeof part==='string'){
        if(groups.has(part))return groups.get(part);
        if(byId.has(part))return [part];
        fail('actors',`找不到角色或群体 ID：${part}`);
      }
      object(part,'actors',['group','count']);
      const members=groups.get(part.group);if(!members)fail('actors.group','找不到群体');
      return members.slice(0,integer(part.count,'actors.count',1,members.length));
    });
    if(result.length>STORY_LIMITS.actors||new Set(result).size!==result.length)fail('actors','选择不能重复或超过 2048 人');
    return result;
  };
  const history=new Map(actors.map(a=>[a.id,{move:[],turn:[]}]));
  const shown=new Set(actors.filter(a=>a.visible!==false).map(a=>a.id));
  let start=0,total=0;
  const pose=(id,key,time)=>{
    const actor=byId.get(id);if(!actor)fail('actor',`找不到角色：${id}`);
    let from=key==='move'?position(actor.position,'position'):actor.angle??0,value=from;
    for(const event of history.get(id)[key].toSorted((a,b)=>a.at-b.at)){
      if(event.at>time)break;
      value=motionValue({...event,from},time);from=event.to;
    }
    return value;
  };
  const range=(value,p,min,max)=>{list(value,p,2,2);value.forEach(n=>number(n,p,min,max));if(value[1]<value[0])fail(p,'上限不能小于下限');return value;};
  const box=(value,p)=>{list(value,p,4,4);range(value.slice(0,2),p,-10000,10000);range(value.slice(2),p,-10000,10000);return value;};
  const inside=(p,b)=>p[0]>=b[0]&&p[0]<=b[1]&&p[1]>=b[2]&&p[1]<=b[3];
  list(data.acts,'acts',1,STORY_LIMITS.acts);
  const acts=data.acts.map((act,index)=>{
    const path=`acts[${index}]`;object(act,path,[...actKeys,'cast']);
    const length=number(act.duration,`${path}.duration`,.1,600),out=[];
    const emit=action=>{
      if(++total>STORY_LIMITS.actions)fail(path,'展开后动作不得超过 20000');
      number(action.at,'at',0,length);
      if(action.duration!==undefined)number(action.duration,'duration',0,length-action.at);
      out.push(action);
      if(action.visible!==undefined)action.visible?shown.add(action.actor):shown.delete(action.actor);
      for(const key of ['move','turn'])if(action[key]!==undefined)history.get(action.actor)[key].push({at:start+action.at,duration:action.duration??0,to:action[key],easing:action.easing,via:key==='move'?action.via:undefined});
      if(action.sway){
        const from=pose(action.actor,'turn',start+action.at),event={at:start+action.at,duration:action.duration??0,from,sway:action.sway};
        history.get(action.actor).turn.push({...event,to:motionValue(event,event.at+event.duration)});
      }
    };
    if(act.cast!==undefined){
      const cast=new Set(select(act.cast));
      for(const id of byId.keys())if(cast.has(id)||shown.has(id))emit({at:0,actor:id,visible:cast.has(id),...(cast.has(id)?{interaction:'touch'}:{})});
    }
    list(act.actions??[],`${path}.actions`,0,STORY_LIMITS.actions);
    let previous=-1;
    for(const command of act.actions??[]){
      object(command,path,[...actionKeys,'actors','scatter','fan','wander','turnBy','stagger']);
      const at=number(command.at,'at',0,length);
      if(at<previous)fail(path,'请按时刻升序排列动作');previous=at;
      if(command.actor!==undefined&&command.actors!==undefined)fail(path,'actor 与 actors 只能选择一个');
      let members=select(command.actors??command.actor);
      const special=['scatter','fan','wander'].filter(k=>command[k]!==undefined);
      if(special.length>1)fail(path,'每条规则只能选择一种排布或走动');
      if(special.length){
        const allowed=special[0]==='wander'?['at','actor','actors','duration','wander']:['at','actor','actors',special[0],'visible','color','coloring','interaction'];
        object(command,path,allowed);
      }
      const {actors:selection,scatter,fan,wander,turnBy,stagger,...base}=command;
      let interval=0,batch=1;
      if(stagger!==undefined){
        const delay=typeof stagger==='number'?{interval:stagger}:stagger;
        object(delay,'stagger',['interval','batch','from']);interval=number(delay.interval,'stagger.interval',0,600);
        batch=integer(delay.batch??1,'stagger.batch',1,STORY_LIMITS.actors);
        if(delay.from!==undefined){const origin=pose(delay.from,'move',start+at);members=members.toSorted((a,b)=>Math.hypot(...pose(a,'move',start+at).map((v,i)=>v-origin[i]))-Math.hypot(...pose(b,'move',start+at).map((v,i)=>v-origin[i])));}
      }
      const layout=scatter??wander;
      let bounds,avoid=[];
      if(layout){
        object(layout,special[0],scatter?['bounds','gap','avoid']:['bounds','radius','step','pause','avoid']);
        if(layout.bounds!==undefined)bounds=box(layout.bounds,`${special[0]}.bounds`);
        list(layout.avoid??[],'avoid',0,100);avoid=(layout.avoid??[]).map(b=>box(b,'avoid'));
      }
      if(scatter){
        if(!bounds)fail('scatter.bounds','需要排布范围');
        const gap=number(scatter.gap??1.05,'scatter.gap',.3,100),others=[...shown].filter(id=>!members.includes(id)).map(id=>pose(id,'move',start+at));
        for(const id of members){
          let p;
          for(let n=0;n<1000;n++){
            const candidate=[between(bounds.slice(0,2)),between(bounds.slice(2))];
            if(!avoid.some(b=>inside(candidate,b))&&others.every(q=>Math.hypot(q[0]-candidate[0],q[1]-candidate[1])>=gap)){p=candidate;break;}
          }
          if(!p)fail('scatter','范围内放不下这些居民，请扩大范围或减少人数');
          others.push(p);emit({...base,actor:id,move:p,turn:between([-180,180])});
        }
      }else if(fan){
        object(fan,'fan',['center','rings','radius','gap','angles']);
        const center=position(fan.center??[0,0],'fan.center'),rings=integer(fan.rings,'fan.rings',1,members.length),columns=members.length/rings;
        if(!Number.isInteger(columns)||columns<2)fail('fan.rings','每圈人数必须相同，且不少于两人');
        const radius=number(fan.radius,'fan.radius',.1,10000),gap=number(fan.gap,'fan.gap',.1,10000),angles=range(fan.angles,'fan.angles',-36000,36000);
        members.forEach((id,i)=>{const angle=angles[0]+(angles[1]-angles[0])*(i%columns)/(columns-1),r=radius+Math.floor(i/columns)*gap;emit({...base,actor:id,move:[center[0]+Math.cos(angle*Math.PI/180)*r,center[1]+Math.sin(angle*Math.PI/180)*r],turn:angle});});
      }else if(wander){
        const duration=number(base.duration,'wander.duration',.1,length-at),radius=number(wander.radius??2,'wander.radius',.1,20),step=range(wander.step??[1.6,3],'wander.step',.3,60),pause=range(wander.pause??[.18,.85],'wander.pause',0,60);
        for(const id of members){
          const anchor=pose(id,'move',start+at);let t=at+between([.2,1.2]);
          while(t<at+duration-.5){
            const span=Math.min(between(step),at+duration-t),from=pose(id,'move',start+t);let to=anchor;
            for(let n=0;n<100;n++){
              const candidate=anchor.map(v=>v+between([-radius,radius]));
              if((!bounds||inside(candidate,bounds))&&!avoid.some(b=>inside(candidate,b))){to=candidate;break;}
            }
            const dx=to[0]-from[0],dy=to[1]-from[1],distance=Math.hypot(dx,dy)||1,bend=between([-.6,.6]),angle=pose(id,'turn',start+t),heading=Math.atan2(dy,dx)*180/Math.PI;
            emit({at:t,actor:id,move:to,via:[(from[0]+to[0])/2-dy/distance*bend,(from[1]+to[1])/2+dx/distance*bend],duration:span,easing:'smooth'});
            emit({at:t,actor:id,turn:angle+((heading-angle)%360+540)%360-180,duration:Math.min(.6,span),easing:'smooth'});
            t+=span+between(pause);
          }
        }
      }else for(const [i,id] of members.entries()){
        const time=at+Math.floor(i/batch)*interval;
        if(turnBy!==undefined){if(base.turn!==undefined)fail('turnBy','不能同时设置 turn');number(turnBy,'turnBy',-36000,36000);}
        emit({...base,at:time,actor:id,...(turnBy===undefined?{}:{turn:pose(id,'turn',start+time)+turnBy})});
      }
    }
    start+=length;const {cast,...plain}=act;return {...plain,actions:out.toSorted((a,b)=>a.at-b.at)};
  });
  const {seed,groups:unused,...plain}=data;return {...plain,actors,acts};
}

export function parseStory(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>STORY_LIMITS.bytes)fail('JSON','文件不得超过 4 MB');
  let data;try{data=JSON.parse(text);}catch{fail('JSON','语法无效，请检查引号、逗号和括号');}
  return compileStory(data);
}

// Compile once. Sampling is independent of previous frames, so seeking backwards,
// pausing and replaying have identical results. No code, URLs or expressions run.
export function compileStory(data){
  object(data,'story',['version','title','description','example','scene','observer','actors','acts','seed','groups']);
  if(data.version!==1)fail('version','仅支持 1');
  if(data.seed!==undefined)integer(data.seed,'seed',0,0xffffffff);
  data=expandStory(data);
  const title=string(data.title,'title');
  const description=data.description===undefined?'':string(data.description,'description',4000);
  const example=data.example===undefined?false:boolean(data.example,'example');
  if(!['house','parade','stars','mask'].includes(data.scene))fail('scene','需要 house、parade、stars 或 mask');
  let observer;
  if(data.observer!==undefined){
    object(data.observer,'observer',['position','angle']);
    observer={position:position(data.observer.position,'observer.position'),angle:number(data.observer.angle??90,'observer.angle',-36000,36000)};
  }
  list(data.actors,'actors',1,STORY_LIMITS.actors);
  const ids=new Set();
  const actors=data.actors.map((actor,i)=>{
    const path=`actors[${i}]`;
    object(actor,path,actorKeys);
    const id=string(actor.id,`${path}.id`,64);
    if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)||ids.has(id))fail(`${path}.id`,'需要唯一、以字母开头的英文 ID');
    ids.add(id);
    if(typeof actor.type!=='string'||!getCharacterType(actor.type))fail(`${path}.type`, `需要 ${characterTypes.map(type=>type.id).join('、')} 或 regular-N（3—128 边）`);
    return {id,name:actor.name===undefined?id:string(actor.name,`${path}.name`),type:actor.type,
      size:number(actor.size??1,`${path}.size`,MIN_SIZE,MAX_SIZE),position:position(actor.position,`${path}.position`),
      angle:number(actor.angle??0,`${path}.angle`,-36000,36000),color:actor.color===undefined?undefined:color(actor.color,`${path}.color`),
      coloring:actor.coloring===undefined?true:boolean(actor.coloring,`${path}.coloring`),
      visible:actor.visible===undefined?true:boolean(actor.visible,`${path}.visible`)};
  });
  const tracks=new Map(actors.map(actor=>[actor.id,{position:[],angle:[],color:[],coloring:[],visible:[],interaction:[],face:[]}]));
  const initial=new Map(actors.map(actor=>[actor.id,actor]));
  let duration=0,actionCount=0;
  list(data.acts,'acts',1,STORY_LIMITS.acts);
  const acts=data.acts.map((act,i)=>{
    const path=`acts[${i}]`;
    object(act,path,actKeys);
    const collision=act.collision===undefined?false:boolean(act.collision,`${path}.collision`);
    const title=string(act.title,`${path}.title`),text=act.text===undefined?'':string(act.text,`${path}.text`,8000);
    const coloring=act.coloring===undefined?undefined:boolean(act.coloring,`${path}.coloring`);
    let observer;
    if(act.observer!==undefined){
      const p=`${path}.observer`,value=act.observer;
      object(value,p,['position','angle','follow','offset']);
      if(value.follow!==undefined&&!ids.has(value.follow))fail(`${p}.follow`,'找不到角色 ID');
      if(value.follow!==undefined&&value.position!==undefined)fail(p,'跟随角色与固定位置只能选择一个');
      if(value.offset!==undefined&&value.follow===undefined)fail(`${p}.offset`,'偏移仅用于跟随角色');
      observer={follow:value.follow,position:value.follow===undefined?position(value.position,`${p}.position`):undefined,
        offset:position(value.offset??[0,0],`${p}.offset`),angle:value.angle===undefined?undefined:number(value.angle,`${p}.angle`,-36000,36000)};
    }
    const length=number(act.duration,`${path}.duration`,.1,600),start=duration;
    duration+=length;if(duration>STORY_LIMITS.seconds)fail('acts','总时长不得超过 1 小时');
    const actions=act.actions??[];
    list(actions,`${path}.actions`,0,STORY_LIMITS.actions);
    actionCount+=actions.length;if(actionCount>STORY_LIMITS.actions)fail('actions','总动作数不得超过 20000');
    let previousAt=-1;
    actions.forEach((action,j)=>{
      const p=`${path}.actions[${j}]`;
      object(action,p,actionKeys);
      const at=number(action.at,`${p}.at`,0,length),span=number(action.duration??0,`${p}.duration`,0,length-at);
      if(at<previousAt)fail(`${p}.at`,'请按时刻升序排列动作');previousAt=at;
      if(!ids.has(action.actor))fail(`${p}.actor`,'找不到角色 ID');
      if(!['move','turn','color','coloring','visible','interaction','face','sway'].some(key=>Object.hasOwn(action,key)))fail(p,'需要 move、turn、color、coloring、visible、interaction、face 或 sway');
      if(span>0&&['move','turn','face','sway'].every(key=>action[key]===undefined))fail(`${p}.duration`,'仅移动、转向、朝向和摇摆有持续时间');
      const easing=action.easing??'linear';
      if(!['linear','smooth','ease-in','ease-out'].includes(easing))fail(`${p}.easing`,'需要 linear、smooth、ease-in 或 ease-out');
      if((action.easing!==undefined||action.via!==undefined)&&!span)fail(p,'速度曲线与弧线需要持续时间');
      if(action.via!==undefined&&action.move===undefined)fail(`${p}.via`,'弧线需要 move');
      const via=action.via===undefined?undefined:position(action.via,`${p}.via`);
      const values={};
      if(Object.hasOwn(action,'move'))values.position=position(action.move,`${p}.move`);
      if(Object.hasOwn(action,'turn'))values.angle=number(action.turn,`${p}.turn`,-36000,36000);
      if(action.face!==undefined){
        if(!span||!ids.has(action.face)||action.face===action.actor)fail(`${p}.face`,'需要其他角色 ID 与持续时间');
        values.face=action.face;
      }
      if(action.sway!==undefined){
        object(action.sway,`${p}.sway`,['angle','period']);
        number(action.sway.angle,`${p}.sway.angle`,0,180);number(action.sway.period,`${p}.sway.period`,.3,600);
        if(!span||action.turn!==undefined)fail(`${p}.sway`,'需要持续时间，不能同时设置 turn');
        const from=tracks.get(action.actor).angle.at(-1)?.to??initial.get(action.actor).angle;
        values.angle=from+Math.sin(span/action.sway.period*Math.PI*2)*action.sway.angle;
      }
      if(Object.hasOwn(action,'color'))values.color=color(action.color,`${p}.color`);
      if(Object.hasOwn(action,'coloring'))values.coloring=boolean(action.coloring,`${p}.coloring`);
      if(Object.hasOwn(action,'visible'))values.visible=boolean(action.visible,`${p}.visible`);
      if(Object.hasOwn(action,'interaction')){
        if(!['touch','kill'].includes(action.interaction))fail(`${p}.interaction`,'需要 touch 或 kill');
        values.interaction=action.interaction;
      }
      for(const [key,to] of Object.entries(values)){
        const track=tracks.get(action.actor)[key],last=track.at(-1),time=start+at;
        if(last&&time<last.at+last.duration)fail(p,`与该角色尚未结束的 ${key} 动作重叠`);
        track.push({at:time,duration:['position','angle','face'].includes(key)?span:0,from:last?.to??initial.get(action.actor)[key],to,easing,...(key==='position'&&via?{via}:{}),...(key==='angle'&&action.sway?{sway:action.sway}:{})});
      }
    });
    return {title,text,duration:length,start,coloring,observer,collision};
  });
  return {version:1,title,description,example,scene:data.scene,observer,actors,acts,duration,tracks};
}

export function sampleStory(story,time){
  if(!Number.isFinite(time))fail('time','需要有限数字');
  time=Math.max(0,Math.min(time,story.duration));
  let actIndex=story.acts.findIndex(act=>time<act.start+act.duration);
  if(actIndex<0)actIndex=story.acts.length-1;
  const actors=story.actors.map(actor=>{
    const state={id:actor.id,position:[...actor.position],angle:actor.angle,color:actor.color,coloring:actor.coloring,visible:actor.visible,interaction:'touch'};
    for(const [key,track] of Object.entries(story.tracks.get(actor.id))){
      for(const event of track){
        if(event.at>time)break;
        state[key]=key==='face'?(time<event.at+event.duration?event.to:undefined)
          :['position','angle'].includes(key)?motionValue(event,time):event.to;
      }
    }
    return state;
  });
  const byId=new Map(actors.map(actor=>[actor.id,actor]));
  for(const actor of actors)if(actor.face){const target=byId.get(actor.face);actor.angle=Math.atan2(target.position[1]-actor.position[1],target.position[0]-actor.position[0])*180/Math.PI;}
  const act=story.acts[actIndex],view=act.observer;
  const followed=view?.follow?actors.find(actor=>actor.id===view.follow):undefined;
  const observer=view?{position:followed?followed.position.map((n,i)=>n+view.offset[i]):[...view.position],angle:view.angle??followed?.angle??90}:undefined;
  return {time,actIndex,actTime:time-act.start,ended:time===story.duration,coloring:act.coloring,collision:act.collision,observer,actors};
}
