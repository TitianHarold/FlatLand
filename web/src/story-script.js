import {characterTypes,MIN_SIZE,MAX_SIZE} from './characters.js';

// JSON v1: seconds within each act, XY in body lengths, absolute angles in
// degrees (0 = +X, positive = counterclockwise). Acts share one continuous cast.
export const STORY_LIMITS={bytes:512*1024,actors:128,acts:100,actions:5000,seconds:3600};
const types=new Set(characterTypes.map(type=>type.id));
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

export function parseStory(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>STORY_LIMITS.bytes)fail('JSON','文件不得超过 512 KB');
  let data;try{data=JSON.parse(text);}catch{fail('JSON','语法无效，请检查引号、逗号和括号');}
  return compileStory(data);
}

// Compile once. Sampling is independent of previous frames, so seeking backwards,
// pausing and replaying have identical results. No code, URLs or expressions run.
export function compileStory(data){
  object(data,'story',['version','title','description','example','scene','observer','actors','acts']);
  if(data.version!==1)fail('version','仅支持 1');
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
    object(actor,path,['id','name','type','size','position','angle','color','visible']);
    const id=string(actor.id,`${path}.id`,64);
    if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)||ids.has(id))fail(`${path}.id`,'需要唯一、以字母开头的英文 ID');
    ids.add(id);
    if(!types.has(actor.type))fail(`${path}.type`, `需要 ${[...types].join('、')}`);
    return {id,name:actor.name===undefined?id:string(actor.name,`${path}.name`),type:actor.type,
      size:number(actor.size??1,`${path}.size`,MIN_SIZE,MAX_SIZE),position:position(actor.position,`${path}.position`),
      angle:number(actor.angle??0,`${path}.angle`,-36000,36000),color:actor.color===undefined?undefined:color(actor.color,`${path}.color`),
      visible:actor.visible===undefined?true:boolean(actor.visible,`${path}.visible`)};
  });
  const tracks=new Map(actors.map(actor=>[actor.id,{position:[],angle:[],color:[],visible:[]}]));
  const initial=new Map(actors.map(actor=>[actor.id,actor]));
  let duration=0,actionCount=0;
  list(data.acts,'acts',1,STORY_LIMITS.acts);
  const acts=data.acts.map((act,i)=>{
    const path=`acts[${i}]`;
    object(act,path,['title','text','duration','actions']);
    const title=string(act.title,`${path}.title`),text=act.text===undefined?'':string(act.text,`${path}.text`,8000);
    const length=number(act.duration,`${path}.duration`,.1,600),start=duration;
    duration+=length;if(duration>STORY_LIMITS.seconds)fail('acts','总时长不得超过 1 小时');
    const actions=act.actions??[];
    list(actions,`${path}.actions`,0,STORY_LIMITS.actions);
    actionCount+=actions.length;if(actionCount>STORY_LIMITS.actions)fail('actions','总动作数不得超过 5000');
    let previousAt=-1;
    actions.forEach((action,j)=>{
      const p=`${path}.actions[${j}]`;
      object(action,p,['at','actor','duration','move','turn','color','visible']);
      const at=number(action.at,`${p}.at`,0,length),span=number(action.duration??0,`${p}.duration`,0,length-at);
      if(at<previousAt)fail(`${p}.at`,'请按时刻升序排列动作');previousAt=at;
      if(!ids.has(action.actor))fail(`${p}.actor`,'找不到角色 ID');
      if(!['move','turn','color','visible'].some(key=>Object.hasOwn(action,key)))fail(p,'需要 move、turn、color 或 visible');
      if(span>0&&action.move===undefined&&action.turn===undefined)fail(`${p}.duration`,'仅移动和转向有持续时间');
      const values={};
      if(Object.hasOwn(action,'move'))values.position=position(action.move,`${p}.move`);
      if(Object.hasOwn(action,'turn'))values.angle=number(action.turn,`${p}.turn`,-36000,36000);
      if(Object.hasOwn(action,'color'))values.color=color(action.color,`${p}.color`);
      if(Object.hasOwn(action,'visible'))values.visible=boolean(action.visible,`${p}.visible`);
      for(const [key,to] of Object.entries(values)){
        const track=tracks.get(action.actor)[key],last=track.at(-1),time=start+at;
        if(last&&time<last.at+last.duration)fail(p,`与该角色尚未结束的 ${key} 动作重叠`);
        track.push({at:time,duration:['position','angle'].includes(key)?span:0,from:last?.to??initial.get(action.actor)[key],to});
      }
    });
    return {title,text,duration:length,start};
  });
  return {version:1,title,description,example,scene:data.scene,observer,actors,acts,duration,tracks};
}

export function sampleStory(story,time){
  if(!Number.isFinite(time))fail('time','需要有限数字');
  time=Math.max(0,Math.min(time,story.duration));
  let actIndex=story.acts.findIndex(act=>time<act.start+act.duration);
  if(actIndex<0)actIndex=story.acts.length-1;
  const actors=story.actors.map(actor=>{
    const state={id:actor.id,position:[...actor.position],angle:actor.angle,color:actor.color,visible:actor.visible};
    for(const [key,track] of Object.entries(story.tracks.get(actor.id))){
      for(const event of track){
        if(event.at>time)break;
        const progress=event.duration?Math.min(1,(time-event.at)/event.duration):1;
        state[key]=key==='position'?event.from.map((n,i)=>n+(event.to[i]-n)*progress)
          :key==='angle'?event.from+(event.to-event.from)*progress:event.to;
      }
    }
    return state;
  });
  return {time,actIndex,actTime:time-story.acts[actIndex].start,ended:time===story.duration,actors};
}
