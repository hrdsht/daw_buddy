// Minimal feature extractor to test which distinctions actually hold up.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len/2; k++) {
        const ar=re[i+k], ai=im[i+k];
        const br=re[i+k+len/2]*cr - im[i+k+len/2]*ci;
        const bi=re[i+k+len/2]*ci + im[i+k+len/2]*cr;
        re[i+k]=ar+br; im[i+k]=ai+bi;
        re[i+k+len/2]=ar-br; im[i+k+len/2]=ai-bi;
        const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr;
      }
    }
  }
}

function features(x, sr) {
  const N = 4096;
  const re = new Float64Array(N), im = new Float64Array(N);
  // window around the loudest point
  let peakIdx = 0, peak = 0;
  for (let i=0;i<x.length;i++){ const a=Math.abs(x[i]); if(a>peak){peak=a;peakIdx=i;} }
  const start = Math.max(0, peakIdx - 256);
  for (let i=0;i<N;i++){
    const s = x[start+i] || 0;
    re[i] = s * 0.5*(1-Math.cos(2*Math.PI*i/(N-1)));
    im[i] = 0;
  }
  fft(re, im);
  const half = N/2, binHz = sr/N;
  const mag = new Float64Array(half);
  let total=0;
  for(let i=0;i<half;i++){ mag[i]=Math.hypot(re[i],im[i]); total+=mag[i]; }

  let centroidNum=0, low150=0, low120=0;
  for(let i=0;i<half;i++){
    const hz=i*binHz;
    centroidNum += hz*mag[i];
    if(hz<150) low150+=mag[i];
    if(hz<120) low120+=mag[i];
  }
  const centroid = total>0 ? centroidNum/total : 0;

  // RMS / crest
  let sum=0; for(let i=0;i<x.length;i++) sum+=x[i]*x[i];
  const rms=Math.sqrt(sum/x.length);
  const crest = rms>0 ? 20*Math.log10(peak/rms) : 0;

  // zero crossing rate
  let zc=0; for(let i=1;i<x.length;i++) if(Math.sign(x[i])!==Math.sign(x[i-1])) zc++;
  const zcr = zc/(x.length/sr);

  // T60 from the peak
  const target = peak * Math.pow(10,-60/20);
  let t60 = x.length;
  for(let i=peakIdx;i<x.length;i++){
    let win=0; const w=Math.min(256,x.length-i);
    for(let k=0;k<w;k++) win=Math.max(win,Math.abs(x[i+k]));
    if(win<target){ t60=i-peakIdx; break; }
  }

  // active duration above -40dB
  const floor = peak*Math.pow(10,-40/20);
  let active=0; for(let i=0;i<x.length;i++) if(Math.abs(x[i])>floor) active++;

  return {
    centroid: Math.round(centroid),
    lowRatio150: total>0 ? low150/total : 0,
    lowRatio120: total>0 ? low120/total : 0,
    crestDb: crest,
    zcr: Math.round(zcr),
    t60ms: (t60/sr)*1000,
    activeMs: (active/sr)*1000
  };
}
module.exports = { features };
