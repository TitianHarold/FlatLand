// Interface preference only. It never enters a scene preset or an iframe.
const storageKey='flatland-ui-theme-v1';
const toggles=[...document.querySelectorAll('[data-ui-theme-toggle]')];
function applyTheme(theme){
  const value=theme==='light'?'light':'dark';
  document.documentElement.dataset.uiTheme=value;
  for(const toggle of toggles)toggle.checked=value==='dark';
  window.dispatchEvent(new Event('flatland-ui-theme-change'));
}
try{applyTheme(localStorage.getItem(storageKey));}catch{applyTheme('dark');}
for(const toggle of toggles)toggle.addEventListener('change',()=>{
  const theme=toggle.checked?'dark':'light';
  applyTheme(theme);
  try{localStorage.setItem(storageKey,theme);}catch{/* The current page still switches when storage is unavailable. */}
});
addEventListener('storage',event=>{if(event.key===storageKey||event.key===null)applyTheme(event.newValue);});
addEventListener('pageshow',()=>{try{applyTheme(localStorage.getItem(storageKey));}catch{}});
