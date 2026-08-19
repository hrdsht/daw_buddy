const k2 = require('../src/renderer/key2');
const NOTES = k2.NOTES;

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
function spectrum(samples, offset, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[offset+i] || 0;
    re[i] = s * 0.5*(1-Math.cos(2*Math.PI*i/(N-1)));
  }
  fft(re, im);
  const half = N/2, mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// OLD method: round each bin to the nearest semitone
function oldChroma(mag, binHz) {
  const c = new Float64Array(12);
  const lo = Math.max(1, Math.floor(65/binHz));
  const hi = Math.min(mag.length-1, Math.ceil(2000/binHz));
  for (let b = lo; b <= hi; b++) {
    const hz = b*binHz;
    const midi = 69 + 12*Math.log2(hz/440);
    c[((Math.round(midi)%12)+12)%12] += mag[b];
  }
  const s = c.reduce((a,b)=>a+b,0);
  return s ? c.map(v=>v/s) : c;
}

// Synthesise a raga performance on A#: tanpura drone + melodic phrases
const sr = 44100;
function midiHz(m){ return 440*Math.pow(2,(m-69)/12); }
function render(tonicMidi, degrees, seconds) {
  const n = sr*seconds, x = new Float32Array(n);
  // tanpura: tonic + fifth, low, continuous
  for (let i = 0; i < n; i++) {
    const t = i/sr;
    x[i] += Math.sin(2*Math.PI*midiHz(tonicMidi-12)*t)*0.30;
    x[i] += Math.sin(2*Math.PI*midiHz(tonicMidi-12+7)*t)*0.20;
    x[i] += Math.sin(2*Math.PI*midiHz(tonicMidi)*t)*0.15;
  }
  // melody wandering the scale, with harmonics
  let pos = 0;
  while (pos < n) {
    const dur = Math.floor(sr*(0.25+Math.random()*0.5));
    const deg = degrees[Math.floor(Math.random()*degrees.length)];
    const oct = Math.random() < 0.4 ? 12 : 0;
    const f = midiHz(tonicMidi + deg + oct);
    for (let i = 0; i < dur && pos+i < n; i++) {
      const env = Math.min(1,i/1500)*Math.exp(-i/(sr*0.9));
      const t = (pos+i)/sr;
      x[pos+i] += (Math.sin(2*Math.PI*f*t)*0.5
                 + Math.sin(2*Math.PI*f*2*t)*0.22
                 + Math.sin(2*Math.PI*f*3*t)*0.12) * env * 0.5;
    }
    pos += dur;
  }
  return x;
}



const TONICS = [
  [34, 'A#1 — deep bass tonic, 58 Hz'],
  [46, 'A#2 — 117 Hz'],
  [58, 'A#3 — 233 Hz']
];

for (const [tonicMidi, label] of TONICS) {
const audio = render(tonicMidi, k2.SCALES.bhairav, 20);
console.log('######## ' + label + ' ########');
for (const N of [4096, 16384]) {
  const binHz = sr/N;
  const hop = N/2;
  const oldAcc = new Float64Array(12);
  const newAcc = new Float64Array(12);
  const frames = [];
  let count = 0;

  for (let off = 0; off + N < audio.length; off += hop) {
    const mag = spectrum(audio, off, N);
    const o = oldChroma(mag, binHz);
    const nw = k2.chromaFromSpectrum(mag, binHz);
    for (let i = 0; i < 12; i++) { oldAcc[i] += o[i]; newAcc[i] += nw[i]; }
    frames.push(Float64Array.from(nw));
    count++;
  }
  for (let i = 0; i < 12; i++) { oldAcc[i] /= count; newAcc[i] /= count; }

  const oldK = k2.krumhansl(oldAcc);
  const newK = k2.analyseKey(newAcc, frames);

  console.log('=== FFT ' + N + '  (' + binHz.toFixed(2) + ' Hz per bin) ===');
  console.log('  old chroma → Krumhansl:  ' + oldK.tonic + ' ' + oldK.mode);
  console.log('  new chroma → tonic:      ' + newK.tonic + '  (conf ' + newK.tonicConfidence.toFixed(2) + ')  scale: ' + newK.scale);
  const strongestOld = NOTES[oldAcc.indexOf(Math.max(...oldAcc))];
  const strongestNew = NOTES[newAcc.indexOf(Math.max(...newAcc))];
  console.log('  strongest pitch class:   old says ' + strongestOld + ', new says ' + strongestNew + '   (truth: A#)');
  console.log('');
}
}
