export function bindPromptCopy(prompt,copy,copyStatus){
copy.addEventListener('click',async()=>{
  let copied=false;
  try{await navigator.clipboard.writeText(prompt.value);copied=true;}catch{
    prompt.focus();prompt.select();
    try{copied=document.execCommand('copy');}catch{/* Keep the text selected for manual copying. */}
  }
  copy.textContent=copied?'已复制':'复制';
  copyStatus.textContent=copied?'已复制':'请手动复制已选中的 Prompt。';
  if(copied)copy.focus({preventScroll:true});
});
}
