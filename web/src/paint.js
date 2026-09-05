// Five theme colours per style. Buildings keep their own shared neutral colour.
export const DEFAULT_PAINT_STYLE='dufy';
export const DEFAULT_WALL_COLOR='#928C99';
export const PAINT_STYLES={
  soft:{name:'清透柔和',colors:['#D7A0A8','#ABCBC4','#9CABD3','#E0B592','#B9CDBB']},
  neon:{name:'霓虹',colors:['#FF638A','#67F0D1','#5C8CFF','#FFBD5A','#B18CFF']},
  morandi:{name:'莫兰迪',colors:['#B49A98','#A4ADA1','#929FB0','#B6A68F','#AF99A2']},
  dufy:{name:'杜菲 · 明亮色域',colors:['#F0C84B','#426AB3','#E88970','#8EBE95','#B96791']},
  grayscale:{name:'头白尾灰',colors:['#FFFFFF','#A6A6A6','#4D4D4D'],pattern:'directional'},
};
PAINT_STYLES.custom={name:'自定义',colors:[...PAINT_STYLES[DEFAULT_PAINT_STYLE].colors]};
let paintMode='solid',wallColor=DEFAULT_WALL_COLOR;
const isColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
function prepare(style){
  const colors=style.colors;
  // Reuse Character's edge bands. Each individual keeps a stable selection.
  style.residents=style.pattern==='directional'?[[...colors]]:paintMode==='solid'?colors.map(c=>[c,c,c]):colors.flatMap((a,i)=>
    colors.filter((_,j)=>j!==i).map((b,j)=>[a,colors[(i+j+2)%colors.length],b]));
  style.wall=wallColor;
}
export function setPaintMode(mode){
  if(!['solid','mixed'].includes(mode))throw new Error('Invalid paint mode');
  paintMode=mode;Object.values(PAINT_STYLES).forEach(prepare);
}
export function setWallColor(color){
  if(!isColor(color))throw new Error('Invalid wall colour');
  wallColor=color;for(const style of Object.values(PAINT_STYLES))style.wall=color;
}
export function setCustomPaintStyle(palette){
  // Migrate saved 3-by-3 palettes; the editor now stores five keys.
  let colors=palette?.colors;
  if(!colors&&Array.isArray(palette?.residents)&&palette.residents.length===3&&
    palette.residents.every(row=>Array.isArray(row)&&row.length===3&&row.every(isColor))){
    colors=[...new Set(palette.residents.flat())];
    colors=Array.from({length:5},(_,i)=>colors[i%colors.length]);
  }
  if(palette?.pattern!==undefined&&palette.pattern!=='directional')throw new Error('Invalid paint pattern');
  if(!Array.isArray(colors)||colors.length!==(palette.pattern==='directional'?3:5)||!colors.every(isColor)||
    palette.wall!==undefined&&!isColor(palette.wall))throw new Error('Invalid custom palette');
  PAINT_STYLES.custom={name:'自定义',colors:[...colors],...(palette.pattern?{pattern:palette.pattern}:{})};prepare(PAINT_STYLES.custom);
}
setPaintMode(paintMode);
