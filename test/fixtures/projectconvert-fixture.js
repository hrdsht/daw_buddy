'use strict';

/**
 * Shared inputs for the project converter: the TypeScript tests
 * (test/projectconvert.test.js) and the Rust parity check
 * (scripts/rust-parity.js) build exactly the same projects from here.
 */

/** 16-bit mono WAV where sample i = (i % 1000) * 10, so offsets are checkable. */
function rampWav(sampleRate, seconds) {
  const frames = Math.round(sampleRate * seconds);
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) buf.writeInt16LE((i % 1000) * 10, 44 + i * 2);
  return buf;
}

function alsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0">
  <LiveSet>
    <Tracks>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="Drums &amp; Perc" /><UserName Value="" /></Name>
        <AutomationEnvelopes><Envelopes>
          <AutomationEnvelope Id="0">
            <EnvelopeTarget><PointeeId Value="100" /></EnvelopeTarget>
            <Automation><Events>
              <FloatEvent Id="1" Time="-63072000" Value="1" />
              <FloatEvent Id="2" Time="4" Value="1" />
              <FloatEvent Id="3" Time="8" Value="0.25" />
            </Events></Automation>
          </AutomationEnvelope>
          <AutomationEnvelope Id="1">
            <EnvelopeTarget><PointeeId Value="102" /></EnvelopeTarget>
            <Automation><Events>
              <BoolEvent Id="4" Time="-63072000" Value="true" />
              <BoolEvent Id="5" Time="9" Value="false" />
              <BoolEvent Id="6" Time="9.5" Value="true" />
            </Events></Automation>
          </AutomationEnvelope>
          <AutomationEnvelope Id="2">
            <EnvelopeTarget><PointeeId Value="999" /></EnvelopeTarget>
            <Automation><Events><FloatEvent Id="7" Time="0" Value="0.1" /><FloatEvent Id="8" Time="4" Value="0.9" /></Events></Automation>
          </AutomationEnvelope>
          <AutomationEnvelope Id="3">
            <EnvelopeTarget><PointeeId Value="101" /></EnvelopeTarget>
            <Automation><Events><FloatEvent Id="9" Time="-63072000" Value="0.3" /></Events></Automation>
          </AutomationEnvelope>
        </Envelopes></AutomationEnvelopes>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.5" /><AutomationTarget Id="100"><LockEnvelope Value="0" /></AutomationTarget></Volume>
            <Pan><Manual Value="-0.25" /><AutomationTarget Id="101" /></Pan>
            <Speaker><Manual Value="true" /><AutomationTarget Id="102" /></Speaker>
          </Mixer>
          <MainSequencer>
            <ClipSlotList />
            <Sample>
              <ArrangerAutomation>
                <Events>
                  <AudioClip Id="0" Time="4">
                    <CurrentStart Value="4" /><CurrentEnd Value="8" />
                    <Loop><LoopStart Value="1" /><LoopEnd Value="5" /><StartRelative Value="0" /><LoopOn Value="false" /></Loop>
                    <Name Value="Unwarped" />
                    <SampleRef><FileRef><RelativePath Value="Samples/Imported/ramp.wav" /><Path Value="/no/such/place/ramp.wav" /></FileRef></SampleRef>
                    <IsWarped Value="false" />
                    <SampleVolume Value="1" />
                  </AudioClip>
                  <AudioClip Id="1" Time="8">
                    <CurrentStart Value="8" /><CurrentEnd Value="10" />
                    <Loop><LoopStart Value="2" /><LoopEnd Value="6" /><StartRelative Value="0" /><LoopOn Value="false" /></Loop>
                    <Name Value="Warped" />
                    <SampleRef><FileRef><Path Value="C:/old/drive/ramp.wav" /></FileRef></SampleRef>
                    <IsWarped Value="true" />
                    <WarpMarkers><WarpMarker Id="0" SecTime="0" BeatTime="0" /><WarpMarker Id="1" SecTime="4" BeatTime="8" /></WarpMarkers>
                    <SampleVolume Value="0.5" />
                  </AudioClip>
                </Events>
              </ArrangerAutomation>
            </Sample>
          </MainSequencer>
        </DeviceChain>
      </AudioTrack>
      <MidiTrack Id="2">
        <Name><EffectiveName Value="Keys" /><UserName Value="Lead Keys" /></Name>
        <AutomationEnvelopes><Envelopes>
          <AutomationEnvelope Id="0">
            <EnvelopeTarget><PointeeId Value="201" /></EnvelopeTarget>
            <Automation><Events>
              <FloatEvent Id="1" Time="-63072000" Value="0" />
              <FloatEvent Id="2" Time="0" Value="-1" />
              <FloatEvent Id="3" Time="4" Value="1" />
            </Events></Automation>
          </AutomationEnvelope>
        </Envelopes></AutomationEnvelopes>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="1" /><AutomationTarget Id="200" /></Volume>
            <Pan><Manual Value="0" /><AutomationTarget Id="201" /></Pan>
            <Speaker><Manual Value="false" /><AutomationTarget Id="202" /></Speaker>
          </Mixer>
          <MainSequencer>
            <ClipSlotList>
              <ClipSlot><ClipSlot><Value><MidiClip Id="9" Time="0"><CurrentStart Value="0"/><CurrentEnd Value="4"/></MidiClip></Value></ClipSlot></ClipSlot>
            </ClipSlotList>
            <ClipTimeable>
              <ArrangerAutomation>
                <Events>
                  <MidiClip Id="0" Time="0">
                    <CurrentStart Value="0" /><CurrentEnd Value="10" />
                    <Loop><LoopStart Value="0" /><LoopEnd Value="4" /><StartRelative Value="0" /><LoopOn Value="true" /></Loop>
                    <Name Value="Riff" />
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="0">
                          <Notes>
                            <MidiNoteEvent Time="0" Duration="1" Velocity="100" IsEnabled="true" />
                            <MidiNoteEvent Time="3.5" Duration="1" Velocity="90" IsEnabled="true" />
                            <MidiNoteEvent Time="2" Duration="1" Velocity="90" IsEnabled="false" />
                          </Notes>
                          <MidiKey Value="60" />
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Events>
              </ArrangerAutomation>
            </ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
      <ReturnTrack Id="3"><Name><EffectiveName Value="A-Reverb" /></Name></ReturnTrack>
    </Tracks>
    <MainTrack>
      <DeviceChain>
        <Mixer>
          <Tempo><Manual Value="120" /></Tempo>
          <TimeSignature><Manual Value="200" /></TimeSignature>
        </Mixer>
      </DeviceChain>
    </MainTrack>
    <Locators><Locators>
      <Locator Id="0"><Time Value="0" /><Name Value="Intro" /></Locator>
      <Locator Id="1"><Time Value="8" /><Name Value="Drop" /></Locator>
    </Locators></Locators>
  </LiveSet>
</Ableton>`;
}

module.exports = { rampWav, alsXml };
