import {createStoryCoverMotion} from './story-cover-motion.js';

// Two cards sit side by side with a bounded gap; larger catalogues form a deck.
export function deckLayout(count,width,available,active=-1){
  if(count<=2)return {positions:Array.from({length:count},(_,index)=>index*(width+16)),total:count*width+Math.max(0,count-1)*16};
  const pitch=Math.max(width/4,Math.min(width/3,(available-width-width*5/12)/Math.max(1,count-1)));
  let x=0;
  const positions=Array.from({length:count},(_,index)=>{
    if(index)x+=index===active?width*3/4:pitch;
    return x;
  });
  return {positions,total:(positions.at(-1)??0)+width};
}

export function mountStoryGallery(catalogue){
  const list=document.querySelector('#story-list'),create=document.querySelector('#create-story');
  const feature=document.querySelector('#featured-story'),image=document.querySelector('#featured-cover');
  const title=document.querySelector('#featured-title'),description=document.querySelector('#featured-description');
  const play=document.querySelector('#featured-play'),soon=document.querySelector('#featured-soon');
  const viewport=document.querySelector('#deck-viewport');
  let entries=[],cards=[],selected=-1,expanded=-1,coverMotion=null,thumbnails=[];

  function layout(){
    if(!cards.length)return;
    const {width,height}=create.getBoundingClientRect();
    if(!width)return;
    const {positions,total}=deckLayout(cards.length,width,viewport.clientWidth,expanded);
    list.style.width=`${total}px`;
    cards.forEach((card,index)=>{
      card.style.transform=`translate(${positions[index]}px,${index===expanded?-height/9:0}px)`;
      card.style.setProperty('--visible-width',`${index?Math.min(width,positions[index]-positions[index-1]):width}px`);
    });
  }
  function select(index){
    if(index===selected||!entries[index])return;
    selected=index;
    const story=entries[index];
    coverMotion?.destroy();coverMotion=null;
    title.textContent=story.title;description.textContent=story.description??'';
    image.hidden=!story.cover;
    if(story.cover){image.src=story.cover;image.alt=story.title;}
    if(story.motionCover)coverMotion=createStoryCoverMotion(image.parentElement,story.motionCover);
    feature.classList.toggle('has-cover',Boolean(story.cover));
    play.hidden=Boolean(story.comingSoon);soon.hidden=!story.comingSoon;
    if(!story.comingSoon)play.href=`./storyboard.html?story=${encodeURIComponent(story.id)}`;
    cards.forEach((card,i)=>{if(i<entries.length)card.setAttribute('aria-pressed',String(i===index));});
  }
  function expand(index){select(index);expanded=index;layout();}
  function render(stories){
    thumbnails.forEach(thumbnail=>thumbnail.destroy());thumbnails=[];
    entries=stories;selected=-1;expanded=-1;list.replaceChildren();
    cards=entries.map((story,index)=>{
      const card=document.createElement('button');card.type='button';card.className='story-card';
      card.setAttribute('aria-label',story.title+(story.comingSoon?'，Coming soon':''));
      if(story.motionCover){
        card.classList.add('has-motion-cover');
        const art=document.createElement('div');art.className='story-card-art';card.append(art);
        const thumbnail=createStoryCoverMotion(art,story.motionCover,{animate:false});
        if(thumbnail)thumbnails.push(thumbnail);
      }else if(story.cover){const cover=document.createElement('img');cover.className='story-cover';cover.src=story.cover;cover.alt='';cover.loading='lazy';card.append(cover);}
      const copy=document.createElement('span');copy.className='story-card-copy';
      const heading=document.createElement('span');heading.className='story-card-title';heading.textContent=story.title;copy.append(heading);
      if(story.comingSoon){const state=document.createElement('span');state.className='story-card-status';state.textContent='Coming soon';copy.append(state);}
      card.append(copy);list.append(card);
      card.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')expand(index);});
      card.addEventListener('focus',()=>expand(index));
      card.addEventListener('click',()=>expand(index));
      return card;
    });
    if(entries.length)list.append(create);
    cards.push(create);
    // Fixed stacking: the leftmost story is on top, the create card is at the bottom.
    cards.forEach((card,index)=>{card.style.zIndex=String(cards.length-index);});
    list.hidden=feature.hidden=viewport.hidden=entries.length===0;
    if(entries.length){select(Math.max(0,entries.findIndex(story=>!story.comingSoon)));expanded=selected;layout();}
  }
  create.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')expand(entries.length);});
  create.addEventListener('pointerleave',()=>{expanded=selected;layout();});
  create.addEventListener('focus',()=>expand(entries.length));
  viewport.addEventListener('pointerleave',()=>{expanded=selected;layout();});
  list.addEventListener('keydown',event=>{
    const current=cards.indexOf(document.activeElement);
    const next=event.key==='ArrowRight'?Math.min(cards.length-1,current+1):event.key==='ArrowLeft'?Math.max(0,current-1):event.key==='Home'?0:event.key==='End'?cards.length-1:-1;
    if(next<0)return;
    event.preventDefault();cards[next].focus({preventScroll:true});
    cards[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  });
  new ResizeObserver(layout).observe(viewport);
  render(catalogue);
  return {render,layout};
}

// Optional local artwork/catalogue. Vite removes this entire branch in production;
// the ignored directory is outside public/ so its files are never copied to dist.
export async function loadStoryPreview(catalogue){
  if(import.meta.env.DEV&&new URLSearchParams(location.search).has('preview')){
    try{
      const response=await fetch('./story-preview.local/catalog.json',{cache:'no-store'});
      if(!response.ok)return catalogue;
      const preview=await response.json();
      const entries=preview.map(entry=>entry.storyId?catalogue.find(story=>story.id===entry.storyId):{...entry,comingSoon:true}).filter(Boolean);
      return [...entries,...catalogue.filter(story=>!entries.some(entry=>entry.id===story.id))];
    }catch{/* Local preview data is optional; the real catalogue remains usable. */}
  }
  return catalogue;
}
