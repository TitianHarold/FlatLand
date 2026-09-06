import './ui-appearance.css';

// Display preference shared with the stage, independent of scene presets.
const storageKey='flatland-ui-theme-v1';
const modes=['light','dark','auto'],labels={light:'亮色',dark:'暗色',auto:'自动跟随系统'};
const system=matchMedia('(prefers-color-scheme: dark)');
const toggles=[...document.querySelectorAll('[data-ui-theme-toggle]')];
let mode='auto';
function applyTheme(preference){
  mode=modes.includes(preference)?preference:'auto';
  const theme=mode==='auto'?(system.matches?'dark':'light'):mode;
  document.documentElement.dataset.uiTheme=theme;
  document.documentElement.dataset.uiThemeMode=mode;
  for(const toggle of toggles){
    toggle.title=labels[mode];
    toggle.setAttribute('aria-label',`界面主题：${labels[mode]}；点击切换为${labels[modes[(modes.indexOf(mode)+1)%3]]}`);
  }
  window.dispatchEvent(new Event('flatland-ui-theme-change'));
  for(const frame of document.querySelectorAll('iframe'))frame.contentWindow?.postMessage({type:'flatland-ui-theme',theme,mode},location.origin);
}
function restoreTheme(){
  try{
    if(parent!==window&&parent.location.origin===location.origin&&parent.document.documentElement.dataset.uiTheme){
      applyTheme(parent.document.documentElement.dataset.uiThemeMode??parent.document.documentElement.dataset.uiTheme);return;
    }
    applyTheme(localStorage.getItem(storageKey));
  }catch{applyTheme('auto');}
}
restoreTheme();
for(const toggle of toggles)toggle.addEventListener('click',()=>{
  applyTheme(modes[(modes.indexOf(mode)+1)%3]);
  try{localStorage.setItem(storageKey,mode);}catch{/* The current page still switches when storage is unavailable. */}
});
system.addEventListener('change',()=>{if(mode==='auto')applyTheme(mode);});
addEventListener('storage',event=>{if(event.key===storageKey||event.key===null)restoreTheme();});
addEventListener('message',event=>{
  if(event.source===parent&&event.origin===location.origin&&event.data?.type==='flatland-ui-theme')applyTheme(event.data.mode??event.data.theme);
});
addEventListener('pageshow',restoreTheme);
