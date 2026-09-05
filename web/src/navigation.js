// Lazy weighted A*: query Rapier's swept body, never rasterize the whole scene.
// Yield between batches so an unreachable click cannot monopolize a frame.
export function* findRoute(start, goal, cast) {
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),spacing=.25;
  const open=[],nodes=new Map();
  function push(node){
    let i=open.length;open.push(node);
    while(i>0){const parent=(i-1)>>1;if(open[parent].f<=node.f)break;open[i]=open[parent];i=parent;}
    open[i]=node;
  }
  function pop(){
    const first=open[0],last=open.pop();
    if(open.length){
      let i=0;
      while(i*2+1<open.length){
        let child=i*2+1;if(child+1<open.length&&open[child+1].f<open[child].f)child++;
        if(last.f<=open[child].f)break;open[i]=open[child];i=child;
      }
      open[i]=last;
    }
    return first;
  }
  // Slight goal bias avoids exploring every equally short approach to a remote
  // obstacle. A safe, prompt route matters more than exact shortest-path length.
  const priority=(g,p)=>g+1.05*distance(p,goal);
  const origin={...start,i:0,j:0,g:0,f:priority(0,start),parent:null};
  nodes.set('0,0',origin);push(origin);
  // ponytail: bounded local search; a navigation mesh is only needed if larger
  // mazes exceed this budget. Open star fields take the direct sweep shortcut.
  for(let expanded=0;open.length&&expanded<12000;expanded++){
    if(expanded%128===0)yield;
    const current=pop(),key=`${current.i},${current.j}`;
    if(nodes.get(key)!==current)continue;
    const hit=cast(current,goal);
    if(!hit){
      const path=[goal];for(let n=current;n.parent;n=n.parent)path.push({x:n.x,y:n.y});
      path.reverse();
      // Remove grid zigzags, but only where the whole body can pass.
      const smooth=[];let from=start;
      for(let i=0;i<path.length;){
        let next=i;
        while(next+1<path.length&&!cast(from,path[next+1]))next++;
        smooth.push(path[next]);from=path[next];i=next+1;
        if(i%128===0)yield;
      }
      return smooth;
    }
    const candidates=[];
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)if(i||j)candidates.push([current.i+i,current.j+j]);
    // Jump over long, clear distances before searching around a far obstacle.
    const length=distance(current,goal),t=Math.max(0,hit.time_of_impact-spacing*2/length);
    if(length*t>spacing*2)candidates.push([
      Math.round((current.x+(goal.x-current.x)*t-start.x)/spacing),
      Math.round((current.y+(goal.y-current.y)*t-start.y)/spacing),
    ]);
    for(const [i,j] of candidates){
      const next={x:start.x+i*spacing,y:start.y+j*spacing,i,j},key=`${i},${j}`;
      const g=current.g+distance(current,next);
      if((nodes.get(key)?.g??Infinity)<=g||cast(current,next))continue;
      const node={...next,g,f:priority(g,next),parent:current};nodes.set(key,node);push(node);
    }
  }
  return null;
}
