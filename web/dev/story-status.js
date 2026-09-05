import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),repo=fileURLToPath(new URL('../../',import.meta.url));

export function draftIds(status){
  const records=status.split('\0'),ids=new Set();
  const add=path=>{
    const match=/^web\/stories\/([a-z0-9]+(?:-[a-z0-9]+)*)\//.exec(path);
    if(match&&match[1]!=='examples')ids.add(match[1]);
  };
  for(let i=0;i<records.length;i++){
    const record=records[i];if(!record)continue;
    add(record.slice(3));
    if(/[RC]/.test(record.slice(0,2)))add(records[++i]??'');
  }
  return [...ids];
}

// Read-only and dev-only: a browser flag cannot tell whether a story was saved.
export function storyStatus(){
  return {name:'flatland-story-status',configureServer(server){
    server.middlewares.use('/__flatland/draft-status',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){res.statusCode=405;res.end('{}');return;}
      try{
        const {stdout}=await run('git',['status','--porcelain=v1','-z','--untracked-files=all','--','web/stories/'],{cwd:repo,timeout:3000,maxBuffer:1024*1024});
        res.end(JSON.stringify({drafts:draftIds(stdout)}));
      }catch{res.statusCode=503;res.end(JSON.stringify({error:'无法读取本地故事状态'}));}
    });
  }};
}
