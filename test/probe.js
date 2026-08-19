const { features } = require('../src/main/lib/features');
const sr = 44100;
function make(kind){
  const n = sr*2, x = new Float32Array(n);
  const env=(i,tau)=>Math.exp(-i/(sr*tau));
  for(let i=0;i<n;i++){
    const t=i/sr;
    if(kind==='kick'){
      const f=110*Math.exp(-i/(sr*0.03))+45;
      x[i]=Math.sin(2*Math.PI*f*t)*env(i,0.12);
    } else if(kind==='sub'){
      x[i]=Math.sin(2*Math.PI*45*t)*(i<sr*1.2?1:0)*0.9;
    } else if(kind==='pluckBass'){
      const s=Math.sin(2*Math.PI*70*t)+0.4*Math.sin(2*Math.PI*140*t)+0.2*Math.sin(2*Math.PI*210*t);
      x[i]=s*env(i,0.05)*0.5;
    } else if(kind==='reeseBass'){
      const s=Math.sin(2*Math.PI*60*t)+0.6*Math.sin(2*Math.PI*121*t)+0.5*Math.sin(2*Math.PI*242*t)+0.35*Math.sin(2*Math.PI*900*t);
      x[i]=s*(i<sr*1.4?1:0)*0.35;
    } else if(kind==='hihat'){
      x[i]=(Math.random()*2-1)*env(i,0.02)*0.7;
    } else if(kind==='snare'){
      x[i]=((Math.random()*2-1)*0.7+Math.sin(2*Math.PI*190*t)*0.5)*env(i,0.09);
    } else if(kind==='pad'){
      x[i]=(Math.sin(2*Math.PI*220*t)+0.5*Math.sin(2*Math.PI*330*t)+0.4*Math.sin(2*Math.PI*440*t))*0.3*Math.min(1,i/(sr*0.4));
    }
  }
  return x;
}
const rows=['kick','snare','hihat','sub','pluckBass','reeseBass','pad'];
console.log('source      centroid  low<150  crest   zcr    T60ms   activeMs');
for(const k of rows){
  const f=features(make(k),sr);
  console.log(
    k.padEnd(12),
    String(f.centroid).padStart(6),
    (f.lowRatio150*100).toFixed(0).padStart(7)+'%',
    f.crestDb.toFixed(1).padStart(6),
    String(f.zcr).padStart(6),
    f.t60ms.toFixed(0).padStart(7),
    f.activeMs.toFixed(0).padStart(9)
  );
}
