// A story PR only needs web/stories/<id>/story.json; no source-code registry edit.
// JSON is parsed by Vite at build time, and URLs respect the deployment base path.
const documents=import.meta.glob('../stories/*/story.json',{eager:true,import:'default'});
const sources=import.meta.glob('../stories/*/story.json',{eager:true,query:'?url',import:'default'});
const settings=import.meta.glob('../stories/*/settings.json',{eager:true,import:'default'});
const covers=Object.fromEntries(Object.entries(import.meta.glob('../stories/*/assets/cover.{png,jpg,jpeg,webp}',{eager:true,query:'?url',import:'default'})).map(([path,url])=>[path.split('/').at(-3),url]));
export const stories=Object.entries(documents).flatMap(([path,story])=>{
  const id=path.split('/').at(-2);
  if(id==='examples'||story.example===true)return [];
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||typeof story.title!=='string'||!story.title.trim()){
    throw new Error(`Invalid story catalogue entry: ${path}`);
  }
  return [{id,title:story.title,description:story.description??'',source:sources[path],settings:settings[path.replace('/story.json','/settings.json')],cover:covers[id]}];
});
