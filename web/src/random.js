// One reproducible stream for generated layouts and movement; no global RNG state.
export function createRandom(seed){
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}
