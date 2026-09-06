import * as THREE from 'three';

// Blur the already visible world. No extra geometry pass or hidden surfaces:
// the same depth buffer supplies distance and protects nearer silhouettes.
export function createScatter(renderer,{eye,flatWindow,viewportOrigin,planeHeight,background={value:new THREE.Color(0)}}){
  const targets=new Map(),quadScene=new THREE.Scene(),quadCamera=new THREE.Camera();
  const uniforms={background,image:{value:null},depth:{value:null},step:{value:new THREE.Vector2()},
    eye,flatWindow,range:{value:1},scatterDistance:{value:1},curve:{value:0},radius:{value:1},far:{value:1},
    origin:{value:new THREE.Vector3()},right:{value:new THREE.Vector3()},up:{value:new THREE.Vector3()},forward:{value:new THREE.Vector3()}};
  const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms,
    vertexShader:`varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`uniform vec3 background;varying vec2 vUv;uniform sampler2D image;uniform sampler2D depth;
      uniform vec2 step;uniform vec2 eye;uniform vec2 flatWindow;uniform float range;uniform float scatterDistance;uniform int curve;uniform float radius;uniform float far;
      uniform vec3 origin;uniform vec3 right;uniform vec3 up;uniform vec3 forward;
      float spread(float d){
        float x=clamp(d/scatterDistance,0.,1.);
        if(curve==1)return x;
        if(curve==2)return x*x;
        if(curve==3)return (exp(4.*x)-1.)/(exp(4.)-1.);
        if(curve==4)return log(1.+15.*x)/log(16.);
        return x*x*(3.-2.*x);
      }
      float distanceAt(vec2 p){
        if(flatWindow.x>0.)return texture2D(depth,p).r*far;
        // All world boundaries lie on the same plane. Intersect its ray,
        // avoiding loss of perspective depth precision in large star fields.
        vec3 ray=forward+(p.x*2.-1.)*right+(p.y*2.-1.)*up;
        float t=(${planeHeight}-origin.z)/ray.z;
        return t>0.?length((origin+ray*t).xy-eye):far;
      }
      void main(){
        if(flatWindow.x==1.&&abs(vUv.y*2.-1.)>flatWindow.y){gl_FragColor=vec4(background,1.);return;}
        float d=distanceAt(vUv),hit=texture2D(depth,vUv).r;
        if(range>0.&&d>=range&&(flatWindow.x==0.||hit<1.)){gl_FragColor=vec4(background,1.);return;}
        float blur=radius*spread(d);
        if(blur<.1){gl_FragColor=vec4(texture2D(image,vUv).rgb,1.);return;}
        vec3 sum=vec3(0.);float weights=0.;
        for(int i=-12;i<=12;i++){
          float x=float(i)/12.;vec2 p=clamp(vUv+step*x*blur,vec2(0.),vec2(1.));
          float other=distanceAt(p),otherHit=texture2D(depth,p).r;
          float w=exp(-4.5*x*x);
          // Distant light cannot wash across a nearer opaque boundary.
          if(hit<1.&&otherHit<1.&&other>d+max(.05,d*.02))w=0.;
          float sourceRadius=radius*spread(other);
          if(otherHit<1.&&abs(x*blur)>max(.5,sourceRadius))w=0.;
          sum+=texture2D(image,p).rgb*w;weights+=w;
        }
        gl_FragColor=vec4(sum/max(weights,.00001),1.);
      }`});
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
  return {
    render(scene,camera,{x=0,y=0,width,height},range,scatterDistance,curve='smooth'){
      const ratio=renderer.getPixelRatio(),w=Math.floor(width*ratio),h=Math.floor(height*ratio);
      let pair=targets.get(camera);
      if(!pair){
        pair=[new THREE.WebGLRenderTarget(w,h,{depthTexture:new THREE.DepthTexture(w,h,THREE.FloatType),samples:4}),
          new THREE.WebGLRenderTarget(w,h,{depthBuffer:false})];
        targets.set(camera,pair);
      }
      for(const target of pair)if(target.width!==w||target.height!==h)target.setSize(w,h);
      const layers=camera.layers.mask;
      camera.layers.disable(2);viewportOrigin.value.set(0,0);
      renderer.setRenderTarget(pair[0]);renderer.clear();renderer.render(scene,camera);
      camera.layers.mask=layers;viewportOrigin.value.set(x,y);
      uniforms.depth.value=pair[0].depthTexture;uniforms.range.value=range;
      uniforms.scatterDistance.value=scatterDistance;
      uniforms.curve.value=['smooth','linear','quadratic','exponential','logarithmic'].indexOf(curve);
      uniforms.radius.value=12*ratio;uniforms.far.value=camera.far;
      uniforms.origin.value.copy(camera.position);
      const slope=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
      uniforms.right.value.setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(slope*camera.aspect);
      uniforms.up.value.setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(slope);
      uniforms.forward.value.setFromMatrixColumn(camera.matrixWorld,2).negate();
      const output=()=>{renderer.setRenderTarget(null);renderer.setViewport(x,y,width,height);renderer.setScissor(x,y,width,height);renderer.setScissorTest(true);};
      uniforms.image.value=pair[0].texture;uniforms.step.value.set(1/w,0);
      // Flatland's columns remain uniform in height; only average horizontally.
      if(flatWindow.value.x===1)output();else renderer.setRenderTarget(pair[1]);
      renderer.render(quadScene,quadCamera);
      if(flatWindow.value.x!==1){
        uniforms.image.value=pair[1].texture;uniforms.step.value.set(0,1/h);
        output();renderer.render(quadScene,quadCamera);
      }
      if(layers&4){
        camera.layers.set(2);const background=scene.background;scene.background=null;
        renderer.clearDepth();renderer.render(scene,camera);
        scene.background=background;camera.layers.mask=layers;
      }
    },
    clear(){for(const pair of targets.values())for(const target of pair)target.dispose();targets.clear();},
  };
}
