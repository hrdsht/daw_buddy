'use strict';

import * as DSP from './dsp';
import { el, svgIcon } from './dom';
import {
  transposeMidiBytes,
  remapMidiToScale,
  calculateShortestSemitoneShift,
  transposeChordName
} from './miditranspose';
import {
  getPitchDeltaSemitones,
  renderPitchShiftedAudio,
  pitchShiftedToWavBytes
} from './audiotranspose';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface KeyMatcherState {
  file: { name: string; size: number; isMidi: boolean; rawBytes?: Uint8Array; audioBuffer?: AudioBuffer } | null;
  sourceKey: string;
  sourceTonic: string;
  sourceTonicPc: number;
  sourceScale: string;
  sourceDegrees: number[];
  sourceProgression: any | null;
  targetTonic: string;
  targetTonicPc: number;
  targetScale: string;
  targetDegrees: number[];
  semitoneShift: number;
  midiMode: 'chromatic' | 'modal';
  transposedMidiBytes: Uint8Array | null;
  transposedAudioWav: Uint8Array | null;
  isProcessing: boolean;
}

export function createInitialKeyMatcherState(defaultTonic = 'G', defaultScale = 'major'): KeyMatcherState {
  const targetTonic = defaultTonic;
  const targetTonicPc = NOTE_NAMES.indexOf(targetTonic) >= 0 ? NOTE_NAMES.indexOf(targetTonic) : 7;
  const targetScale = defaultScale;
  const targetDegrees = (DSP.SCALES as any)[targetScale.toLowerCase()] || DSP.SCALES.major;

  return {
    file: null,
    sourceKey: 'C maj',
    sourceTonic: 'C',
    sourceTonicPc: 0,
    sourceScale: 'major',
    sourceDegrees: DSP.SCALES.major,
    sourceProgression: null,
    targetTonic,
    targetTonicPc,
    targetScale,
    targetDegrees,
    semitoneShift: 0,
    midiMode: 'modal',
    transposedMidiBytes: null,
    transposedAudioWav: null,
    isProcessing: false
  };
}

/**
 * Creates an interactive Root Key (Tonic) selector bar.
 */
export function renderRootKeySelector(
  currentTonic: string,
  onSelect: (note: string) => void
): HTMLElement {
  const container = el('div', 'scale-root-selector');
  container.append(el('div', 'scale-root-selector__label', 'Root Key / Tonic:'));

  NOTE_NAMES.forEach((note: string) => {
    const isCur = note.toUpperCase() === currentTonic.toUpperCase();
    const btn = el('button', `scale-root-btn ${isCur ? 'is-active' : ''}`, note);
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(note);
    });
    container.append(btn);
  });

  return container;
}

/**
 * Renders the complete Key & Scale Matcher & Transposer component.
 */
export function renderKeyMatcherComponent(
  container: HTMLElement,
  matcherState: KeyMatcherState,
  onUpdate: () => void,
  playSynthNote: (pc: number, oct: number, freq: number, dur: number) => void
): void {
  const card = el('div', 'key-matcher-card');

  // Header
  const head = el('div', 'key-matcher-header');
  const title = el('div', 'key-matcher-title');
  title.append(svgIcon('music', '', 18));
  title.append(document.createTextNode('Key & Scale Matcher & Transposer'));
  title.append(el('span', 'key-matcher-badge', matcherState.file?.isMidi ? 'MIDI Transposer' : 'Audio Pitch-Shift'));
  head.append(title);
  card.append(head);

  // Recalculate shortest semitone delta
  matcherState.semitoneShift = calculateShortestSemitoneShift(
    matcherState.sourceTonicPc,
    matcherState.targetTonicPc
  );

  // Comparison Grid: Source -> Target
  const comparison = el('div', 'key-matcher-comparison');

  // Source Column
  const srcCol = el('div', 'key-matcher-col');
  srcCol.append(el('div', 'key-matcher-col__label', 'Detected Source'));
  const srcVal = el('div', 'key-matcher-col__val', `🎹 ${matcherState.sourceTonic} ${matcherState.sourceScale}`);
  srcCol.append(srcVal);

  if (matcherState.sourceProgression && matcherState.sourceProgression.summary) {
    srcCol.append(el('div', 'key-matcher-col__progression', matcherState.sourceProgression.summary));
    if (matcherState.sourceProgression.romanSummary) {
      srcCol.append(el('div', 'key-matcher-col__roman', `Analysis: ${matcherState.sourceProgression.romanSummary}`));
    }
  }
  comparison.append(srcCol);

  // Arrow / Delta
  const arrowCol = el('div', 'key-matcher-arrow');
  const shiftText = matcherState.semitoneShift >= 0 ? `+${matcherState.semitoneShift}` : `${matcherState.semitoneShift}`;
  arrowCol.innerHTML = `<div>➔</div><div style="font-size:12px;font-weight:700;color:var(--accent);">${shiftText} st</div>`;
  comparison.append(arrowCol);

  // Target Column
  const targetCol = el('div', 'key-matcher-col');
  targetCol.append(el('div', 'key-matcher-col__label', 'Target Destination'));
  const targetVal = el('div', 'key-matcher-col__val', `🎯 ${matcherState.targetTonic} ${matcherState.targetScale}`);
  targetCol.append(targetVal);

  if (matcherState.sourceProgression && matcherState.sourceProgression.segments) {
    const isModal = matcherState.midiMode === 'modal';
    const isTargetMajor = matcherState.targetScale === 'major' || matcherState.targetScale === 'lydian' || matcherState.targetScale === 'mixolydian';

    const shiftedChords = matcherState.sourceProgression.segments.map((seg: any) => {
      if (isModal) {
        // Remap root degree to target degree
        const srcDeg = (seg.rootPc - matcherState.sourceTonicPc + 12) % 12;
        const degIdx = matcherState.sourceDegrees.indexOf(srcDeg);
        const mappedDeg = degIdx >= 0 && degIdx < matcherState.targetDegrees.length
          ? matcherState.targetDegrees[degIdx]
          : (srcDeg + matcherState.semitoneShift + 12) % 12;
        const newRootPc = (matcherState.targetTonicPc + mappedDeg) % 12;
        const newRootName = NOTE_NAMES[newRootPc];
        const newRoman = DSP.getRomanNumeral(newRootPc, seg.quality, matcherState.targetTonicPc, !isTargetMajor);
        return { name: `${newRootName}`, roman: newRoman };
      } else {
        const transposedName = transposeChordName(seg.chord, matcherState.semitoneShift);
        const newRootPc = (seg.rootPc + matcherState.semitoneShift + 12) % 12;
        const newRoman = DSP.getRomanNumeral(newRootPc, seg.quality, matcherState.targetTonicPc, !isTargetMajor);
        return { name: transposedName, roman: newRoman };
      }
    });

    targetCol.append(el('div', 'key-matcher-col__progression', shiftedChords.map((c: any) => c.name).join(' → ')));
    targetCol.append(el('div', 'key-matcher-col__roman', `Transposed: ${shiftedChords.map((c: any) => c.roman).join(' – ')}`));
  }
  comparison.append(targetCol);

  card.append(comparison);

  // Controls Section
  const controls = el('div', 'key-matcher-controls');

  // Target Key Root Selector
  const targetRootRow = renderRootKeySelector(matcherState.targetTonic, (newTonic) => {
    matcherState.targetTonic = newTonic;
    matcherState.targetTonicPc = NOTE_NAMES.indexOf(newTonic);
    onUpdate();
  });
  controls.append(targetRootRow);

  // Target Scale Selector Row
  const scaleRow = el('div', 'key-matcher-row');
  scaleRow.append(el('span', 'key-matcher-col__label', 'Target Scale:'));

  const commonScales = [
    { id: 'major', label: 'Major (Ionian)' },
    { id: 'minor', label: 'Natural Minor (Aeolian)' },
    { id: 'dorian', label: 'Dorian' },
    { id: 'mixolydian', label: 'Mixolydian' },
    { id: 'phrygian', label: 'Phrygian' },
    { id: 'lydian', label: 'Lydian' },
    { id: 'harmonicMinor', label: 'Harmonic Minor' }
  ];

  const scaleSelect = el('select', 'input input--sm') as HTMLSelectElement;
  commonScales.forEach((sc) => {
    const opt = document.createElement('option');
    opt.value = sc.id;
    opt.textContent = sc.label;
    if (sc.id.toLowerCase() === matcherState.targetScale.toLowerCase()) opt.selected = true;
    scaleSelect.appendChild(opt);
  });

  scaleSelect.addEventListener('change', () => {
    matcherState.targetScale = scaleSelect.value;
    matcherState.targetDegrees = (DSP.SCALES as any)[matcherState.targetScale] || DSP.SCALES.major;
    onUpdate();
  });
  scaleRow.append(scaleSelect);

  // If MIDI: Transpose Mode Selector (Chromatic vs Modal Remap)
  if (matcherState.file?.isMidi) {
    const modeLabel = el('span', 'key-matcher-col__label', 'MIDI Mode:');
    modeLabel.style.marginLeft = '12px';
    scaleRow.append(modeLabel);

    const chromaticBtn = el('button', `pill pill--sm ${matcherState.midiMode === 'chromatic' ? 'pill--solid' : ''}`, 'Chromatic Shift');
    chromaticBtn.title = 'Transposes all chords and notes by exact semitones, preserving chord intervals';
    chromaticBtn.addEventListener('click', () => {
      matcherState.midiMode = 'chromatic';
      onUpdate();
    });

    const modalBtn = el('button', `pill pill--sm ${matcherState.midiMode === 'modal' ? 'pill--solid' : ''}`, 'Harmonic Scale Remap');
    modalBtn.title = 'Harmonically maps chord degrees and notes to the target scale (e.g. A# minor to G major)';
    modalBtn.addEventListener('click', () => {
      matcherState.midiMode = 'modal';
      onUpdate();
    });

    scaleRow.append(chromaticBtn, modalBtn);
  }

  controls.append(scaleRow);
  card.append(controls);

  // Actions & Drag Tile
  const actionsRow = el('div', 'key-matcher-row');
  actionsRow.style.marginTop = '10px';

  if (matcherState.file?.isMidi && matcherState.file.rawBytes) {
    // Generate Transposed MIDI bytes
    const transposedBytes = matcherState.midiMode === 'modal'
      ? remapMidiToScale(
          matcherState.file.rawBytes,
          matcherState.sourceTonicPc,
          matcherState.sourceDegrees,
          matcherState.targetTonicPc,
          matcherState.targetDegrees
        )
      : transposeMidiBytes(matcherState.file.rawBytes, matcherState.semitoneShift);

    matcherState.transposedMidiBytes = transposedBytes;

    const outName = `Transposed_${matcherState.targetTonic}_${matcherState.targetScale}_${matcherState.file.name}`;

    // Audition Transposed Chords
    const auditionBtn = el('button', 'pill pill--sm', '▶ Audition Transposed Chords');
    auditionBtn.addEventListener('click', () => {
      if (matcherState.sourceProgression?.segments) {
        matcherState.sourceProgression.segments.forEach((seg: any, idx: number) => {
          setTimeout(() => {
            const chordRootPc = (seg.rootPc + matcherState.semitoneShift + 12) % 12;
            playSynthNote(chordRootPc, 4, 440, 0.5);
            playSynthNote((chordRootPc + (matcherState.targetScale === 'major' ? 4 : 3)) % 12, 4, 440, 0.5);
            playSynthNote((chordRootPc + 7) % 12, 4, 440, 0.5);
          }, idx * 600);
        });
      } else {
        playSynthNote(matcherState.targetTonicPc, 4, 440, 0.6);
      }
    });
    actionsRow.append(auditionBtn);

    // Drag Transposed MIDI to DAW
    const dragTile = el('div', 'key-matcher-drag-tile');
    dragTile.draggable = true;
    dragTile.append(svgIcon('download', '', 18));
    dragTile.append(document.createTextNode(`⬇ Drag Transposed MIDI (${matcherState.targetTonic} ${matcherState.targetScale}) to DAW`));
    dragTile.title = 'Drag directly into Ableton, FL Studio, Logic, Reaper, etc.';

    dragTile.addEventListener('dragstart', async (e: DragEvent) => {
      e.preventDefault();
      if ((window as any).api?.dragMidi) {
        await (window as any).api.dragMidi(outName, Array.from(transposedBytes));
      }
    });

    actionsRow.append(dragTile);
  } else if (matcherState.file?.audioBuffer) {
    // Audio Pitch Shift Handling
    const audioBuf = matcherState.file.audioBuffer;
    const outWavName = `Pitched_${matcherState.targetTonic}_${matcherState.file.name.replace(/\.[^/.]+$/, '')}.wav`;

    const pitchBtn = el('button', 'pill pill--solid', '⚡ Render Pitch Shift');
    pitchBtn.addEventListener('click', async () => {
      pitchBtn.textContent = 'Rendering...';
      try {
        const rendered = await renderPitchShiftedAudio(audioBuf, matcherState.semitoneShift);
        const wavBytes = pitchShiftedToWavBytes(rendered);
        matcherState.transposedAudioWav = wavBytes;

        // Play brief audition
        const aCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = aCtx.createBufferSource();
        src.buffer = rendered;
        src.connect(aCtx.destination);
        src.start(0);
        setTimeout(() => aCtx.close(), 4000);

        pitchBtn.textContent = '✔ Rendered & Auditioned!';
        onUpdate();
      } catch (err: any) {
        pitchBtn.textContent = 'Error rendering';
        console.error(err);
      }
    });
    actionsRow.append(pitchBtn);

    if (matcherState.transposedAudioWav) {
      const dragAudioTile = el('div', 'key-matcher-drag-tile');
      dragAudioTile.draggable = true;
      dragAudioTile.append(svgIcon('download', '', 18));
      dragAudioTile.append(document.createTextNode(`⬇ Drag Pitched Sample (${matcherState.targetTonic}) to DAW`));
      dragAudioTile.addEventListener('dragstart', async (e: DragEvent) => {
        e.preventDefault();
        if ((window as any).api?.dragAudio) {
          await (window as any).api.dragAudio(outWavName, Array.from(matcherState.transposedAudioWav!));
        }
      });
      actionsRow.append(dragAudioTile);
    }
  }

  card.append(actionsRow);
  container.append(card);
}
