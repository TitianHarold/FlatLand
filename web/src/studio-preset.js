import {PAINT_STYLES,DEFAULT_PAINT_STYLE,DEFAULT_WALL_COLOR,setCustomPaintStyle} from './paint.js';
import {OPTICS_RULES} from './optics.js';

export const storageKey='flatland-studio-preset-v1',GAIN_LIMIT=16;
export const defaults={
  currentScene:'house',
  shared:{paintStyle:DEFAULT_PAINT_STYLE,customPaint:{colors:[...PAINT_STYLES.custom.colors]},paintMode:'solid',wallColor:DEFAULT_WALL_COLOR,coloring:false,
    exposure:OPTICS_RULES.exposure,detailGain:1,detailStyle:'velvet',scatterEnabled:true,scatterDistance:128,scatterCurve:'quadratic',attenuationEnabled:true,attenuationDistance:2048,attenuationCurve:'quadratic',
    residentEmission:OPTICS_RULES.materials.resident.emission,houseEmission:2**-7},
  view:{dimension:0,display:'line',fieldAngle:120,windowHeight:1,projection:'perspective',showRange:true,mapLocked:true},
  behavior:{population:0,wandering:false,interaction:'touch',pathfinding:false,residentKilling:false,deathAnimation:false},
};

export function sharedSettings(shared){return {
  // Visibility and scatter distances stay independent across every scene.
  exposure:shared.exposure,detailGain:shared.detailGain===0?0:2**shared.detailGain,detailStyle:shared.detailStyle,visionEffect:shared.scatterEnabled?(shared.attenuationEnabled?'both':'scatter'):'attenuation',scatterDistance:shared.scatterDistance,scatterCurve:shared.scatterCurve,fog:0,residentEmission:shared.residentEmission,houseEmission:shared.houseEmission,
  attenuationDistance:shared.attenuationEnabled?shared.attenuationDistance:0,
  attenuationMode:'mask',attenuationFloor:0,attenuationCurve:shared.attenuationCurve,paintStyle:shared.paintStyle,customPaint:shared.customPaint,paintMode:shared.paintMode,wallColor:shared.wallColor,
};}

// Validate one configuration. Missing fields use built-in defaults only.
export function readPreset(saved){
  saved=structuredClone(saved);
  if(saved?.state?.currentScene==='optics')saved.state.currentScene='stars';
  if(saved?.version!==1||!saved.state||typeof saved.state!=='object'||Array.isArray(saved.state))throw new Error('Invalid preset');
  const result=structuredClone(defaults),source=saved.state;
  const currentScene=Object.hasOwn(source,'currentScene')?source.currentScene:defaults.currentScene;
  if(!['house','neighborhood','parade','stars','mask','characters'].includes(currentScene))throw new Error('Invalid scene');
  for(const group of ['shared','view','behavior'])if(Object.hasOwn(source,group)&&(!source[group]||typeof source[group]!=='object'||Array.isArray(source[group])))throw new Error('Invalid configuration group');
  // Older presets chose a combined mode under one master switch.
  if(source.shared&&source.shared.scatterEnabled==null&&Object.hasOwn(source.shared,'visionEffect')){
    const enabled=source.shared.attenuationEnabled??true;
    source.shared.scatterEnabled=enabled&&['scatter','both'].includes(source.shared.visionEffect);
    source.shared.attenuationEnabled=enabled&&source.shared.visionEffect!=='scatter';
  }
  if(source.shared?.scatterAmount===0)source.shared.scatterEnabled=false;
  const enums={scatterCurve:['smooth','linear','quadratic','exponential','logarithmic'],detailStyle:['soft','velvet','sharp'],paintStyle:Object.keys(PAINT_STYLES),paintMode:['solid','mixed'],attenuationCurve:['smooth','linear','exponential','quadratic','inverse-square'],display:['expanded','line'],projection:['equidistant','perspective']};
  const limits={exposure:[1.5,96],detailGain:[0,3],scatterDistance:[2,8192],residentEmission:[2**-GAIN_LIMIT,2**GAIN_LIMIT],houseEmission:[2**-GAIN_LIMIT,2**GAIN_LIMIT],attenuationDistance:[2,8192],dimension:[0,100],fieldAngle:[60,160],windowHeight:[1,100]};
  // Older presets kept behavior per scene. Adopt the current scene's values once.
  if(!source.behavior&&source[currentScene])source.behavior=source[currentScene];
  if(source.shared?.wallColor===undefined&&source.shared?.paintStyle==='custom'&&source.shared.customPaint?.wall)source.shared.wallColor=source.shared.customPaint.wall;
  for(const group of ['shared','view','behavior']){
    for(const [key,defaultValue] of Object.entries(defaults[group])){
      let value=Object.hasOwn(source[group]??{},key)?source[group][key]:defaultValue;
      if(key==='customPaint'){setCustomPaintStyle(value);value={colors:[...PAINT_STYLES.custom.colors],...(PAINT_STYLES.custom.pattern?{pattern:PAINT_STYLES.custom.pattern}:{})};}
      if(key==='wallColor'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Invalid wall colour');
      // Preserve the old appearance once, then save the two distances separately.
      if(key==='scatterDistance'&&source.shared?.scatterDistance===undefined&&source.shared?.visionEffect!==undefined)value=source.shared.attenuationDistance??defaults.shared.scatterDistance;
      if(['attenuationDistance','scatterDistance'].includes(key)&&value===1)value=2;
      if(key==='detailGain'&&Number.isInteger(value)&&value>=-3&&value<0)value=0;
      if(['residentEmission','houseEmission','exposure'].includes(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0){
        const base=key==='exposure'?12:1,limit=key==='exposure'?3:GAIN_LIMIT;
        value=base*2**Math.max(-limit,Math.min(limit,Math.round(Math.log2(value/base))));
      }
      if(typeof value!==typeof defaultValue)throw new Error('Invalid type');
      if(typeof value==='number'&&(!Number.isFinite(value)||limits[key]&&(value<limits[key][0]||value>limits[key][1])))throw new Error('Out of range');
      if(enums[key]&&!enums[key].includes(value))throw new Error('Invalid option');
      if(key==='interaction'&&!['kill','touch'].includes(value))throw new Error('Invalid interaction');
      if(key==='population'&&![0,14,100,300,1000,2000].includes(value))throw new Error('Invalid population');
      if(key==='detailGain'&&!Number.isInteger(value))throw new Error('Invalid detail gain');
      result[group][key]=value;
    }
  }
  result.currentScene=currentScene;return result;
}
