/* Reactive liquid background: metaball field from the pointer trail plus slow ambient blobs, warped by noise and drawn as icy fill with thin heat-map contour bands. */
(() => {
const cv=document.getElementById("liquid"), gl=cv.getContext("webgl",{antialias:false,premultipliedAlpha:false});
if(!gl){cv.remove();return}
const N=24;
const vs=`attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const fs=`precision mediump float;
uniform vec2 uRes;uniform float uT;uniform vec3 uP[${N}];
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
vec3 bands(float x){
  vec3 c=vec3(.0,.03,.22);
  c=mix(c,vec3(.02,.12,.55),smoothstep(.10,.13,x));
  c=mix(c,vec3(.0,.35,.95),smoothstep(.24,.27,x));
  c=mix(c,vec3(.15,.85,1.),smoothstep(.38,.41,x));
  c=mix(c,vec3(.05,.42,.18),smoothstep(.50,.53,x));
  c=mix(c,vec3(.92,.10,.12),smoothstep(.62,.65,x));
  c=mix(c,vec3(.98,.88,.12),smoothstep(.76,.79,x));
  c=mix(c,vec3(.80,.90,1.),smoothstep(.90,.93,x));
  return c;}
void main(){
  vec2 p=gl_FragCoord.xy/uRes.y;
  float t=uT;
  vec2 w=vec2(fbm(p*2.2+vec2(t*.05,0.)),fbm(p*2.2+vec2(5.2,-t*.04)))-.5;
  vec2 q=p+w*.10;
  float ar=uRes.x/uRes.y, f=0.;
  for(int i=0;i<3;i++){float fi=float(i);
    vec2 c=vec2(ar*(.5+.38*sin(t*.07*(fi+1.)+fi*2.1)),.5+.34*cos(t*.06*(fi+1.3)+fi*1.7));
    vec2 d=q-c;f+=.010/(dot(d,d)+.002);}
  for(int i=0;i<${N};i++){vec3 P=uP[i];vec2 d=q-P.xy/uRes.y;f+=P.z*.0016/(dot(d,d)+.0004);}
  vec3 navy=vec3(.008,.024,.066);
  vec3 col=navy+vec3(0.,.06,.2)*smoothstep(.15,.7,f)*.8;
  float x=clamp((f-.62)/.38,0.,1.);
  if(f>.62){col=bands(x);}
  if(f>1.){float s=smoothstep(1.,5.,f);col=mix(vec3(.80,.90,1.),vec3(.52,.68,.88),s*.65+fbm(q*3.+t*.03)*.2);}
  float vg=1.-smoothstep(.2,1.4,length(gl_FragCoord.xy/uRes-.5));
  gl_FragColor=vec4(col*mix(.55,1.,vg),1.);}`;
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){throw new Error(gl.getShaderInfoLog(s))}return s}
let pr;
try{pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw 0;}
catch(e){cv.remove();return}
gl.useProgram(pr);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(pr,"a");gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
const uRes=gl.getUniformLocation(pr,"uRes"),uT=gl.getUniformLocation(pr,"uT"),uP=gl.getUniformLocation(pr,"uP");
const SCALE=.55;let W=0,Hh=0;
function size(){W=Math.max(1,Math.round(innerWidth*SCALE));Hh=Math.max(1,Math.round(innerHeight*SCALE));cv.width=W;cv.height=Hh;gl.viewport(0,0,W,Hh);}
size();addEventListener("resize",size);
const pts=new Float32Array(N*3);let head=0,last=null;
function add(x,y,s){pts[head*3]=x*SCALE;pts[head*3+1]=(innerHeight-y)*SCALE;pts[head*3+2]=s;head=(head+1)%N;}
addEventListener("pointermove",e=>{
  const x=e.clientX,y=e.clientY;
  if(last){const dx=x-last.x,dy=y-last.y,d=Math.hypot(dx,dy);if(d<14)return;
    const steps=Math.min(4,Math.floor(d/28));for(let i=1;i<=steps;i++)add(last.x+dx*i/(steps+1),last.y+dy*i/(steps+1),.9);}
  add(x,y,1);last={x,y};
},{passive:true});
addEventListener("pointerdown",e=>{add(e.clientX,e.clientY,2.2);last={x:e.clientX,y:e.clientY}},{passive:true});
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const t0=performance.now();let raf=0;
function frame(now){
  for(let i=0;i<N;i++)pts[i*3+2]*=.972;
  gl.uniform2f(uRes,W,Hh);gl.uniform1f(uT,reduce?12.:(now-t0)/1000);gl.uniform3fv(uP,pts);
  gl.drawArrays(gl.TRIANGLES,0,3);
  raf=reduce?0:requestAnimationFrame(frame);
}
raf=requestAnimationFrame(frame);
if(reduce){addEventListener("pointermove",()=>{if(!raf)raf=requestAnimationFrame(frame)},{passive:true})}
document.addEventListener("visibilitychange",()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0}else if(!raf&&!reduce)raf=requestAnimationFrame(frame)});
})();
