const clamp=value=>Math.max(0,Math.min(1,value));

// A short drawing, a rapid sequence of colour strikes, then a still composition.
export function coverProgress(time,index,count){
  return {
    line:clamp((time-(index%11)*62)/280),
    colour:clamp((time-1150-((index*17)%count)*27)/100),
    fill:clamp((time-2400-(index%5)*85)/280),
  };
}

export function createStoryCoverMotion(host,art,{animate=true}={}){
  if(art?.version!==1||!Array.isArray(art.strokes))return null;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)return null;
  canvas.setAttribute('aria-hidden','true');
  const replay=animate?document.createElement('button'):null;
  host.append(canvas);
  if(replay){
    replay.type='button';replay.className='cover-replay';
    replay.setAttribute('aria-label','重播封面动画');replay.title='重播封面动画';host.append(replay);
  }
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const strokes=art.strokes.map(stroke=>{
    const lengths=stroke.points.slice(1).map((point,i)=>Math.hypot(point[0]-stroke.points[i][0],point[1]-stroke.points[i][1]));
    return {...stroke,lengths,length:lengths.reduce((sum,length)=>sum+length,0)};
  });
  let elapsed=0,last=null,frame=0,visible=true,disposed=false;
  function path(stroke,progress){
    ctx.beginPath();ctx.moveTo(...stroke.points[0]);
    let left=stroke.length*progress;
    for(let i=1;i<stroke.points.length;i++){
      const a=stroke.points[i-1],b=stroke.points[i],length=stroke.lengths[i-1];
      if(left>=length){ctx.lineTo(...b);left-=length;}
      else{const t=length?left/length:0;ctx.lineTo(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);break;}
    }
  }
  function draw(){
    const light=document.documentElement.dataset.uiTheme==='light';
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle=getComputedStyle(host).getPropertyValue('--cover-background').trim()||(light?'#fff':'#000');
    ctx.fillRect(0,0,canvas.width,canvas.height);
    const scale=Math.max(canvas.width/art.width,canvas.height/art.height);
    ctx.setTransform(scale,0,0,scale,(canvas.width-art.width*scale)/2,(canvas.height-art.height*scale)/2);
    ctx.lineCap='round';ctx.lineJoin='round';
    const time=!animate||motion.matches?4000:elapsed;
    strokes.forEach((stroke,index)=>{
      const {line,colour,fill}=coverProgress(time,index,strokes.length);
      if(!line)return;
      const color=stroke.color==='#bbb'?(light?'#656565':'#bcbcbc'):
        light?`rgb(${[1,3,5].map(offset=>Math.round(parseInt(stroke.color.slice(offset,offset+2),16)*.7)).join(' ')})`:stroke.color;
      if(stroke.fill&&fill){path(stroke,1);ctx.globalAlpha=fill*.84;ctx.fillStyle=color;ctx.fill();ctx.globalAlpha=1;}
      path(stroke,line);ctx.lineWidth=stroke.width??1.4;ctx.strokeStyle=light?'#444':'#d9d9d9';ctx.stroke();
      if(colour){path(stroke,line*colour);ctx.strokeStyle=color;ctx.stroke();}
    });
    canvas.dataset.phase=time<1150?'drawing':time<2400?'colour':time<3100?'fill':'complete';
  }
  function pause(){cancelAnimationFrame(frame);frame=0;last=null;}
  function schedule(){if(animate&&!disposed&&visible&&!document.hidden&&!motion.matches&&elapsed<3400&&!frame)frame=requestAnimationFrame(tick);}
  function tick(now){
    frame=0;
    if(last!==null)elapsed=Math.min(3400,elapsed+now-last);
    last=now;draw();schedule();
  }
  function resize(){
    const {width,height}=host.getBoundingClientRect();
    if(!width||!height)return;
    const ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);draw();schedule();
  }
  function restart(){pause();elapsed=0;draw();schedule();}
  function preference(){pause();draw();schedule();}
  function visibility(){if(document.hidden)pause();else schedule();}
  const observer=new ResizeObserver(resize);observer.observe(host);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();else pause();});intersection.observe(host);
  replay?.addEventListener('click',restart);
  motion.addEventListener('change',preference);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('flatland-ui-theme-change',draw);
  resize();
  return {restart,destroy(){disposed=true;pause();observer.disconnect();intersection.disconnect();motion.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('flatland-ui-theme-change',draw);canvas.remove();replay?.remove();}};
}
