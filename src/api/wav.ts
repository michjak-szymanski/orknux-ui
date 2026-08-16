/**
 * Turns whatever the browser recorded into a WAV whisper will accept.
 *
 * `MediaRecorder` produces webm/opus on Chrome and mp4/aac on Safari — neither
 * of which whisper.cpp decodes: its `/inference` answers 400 to anything that is
 * not PCM WAV. The browser can already decode both, so the conversion belongs
 * here rather than as ffmpeg on a server that would then need it installed.
 *
 * 16 kHz mono, which is what whisper resamples to anyway; sending 48 kHz stereo
 * would be three times the bytes for the same transcript.
 */
const RATE = 16000;

export async function toWav(recorded: Blob): Promise<Blob> {
  const bytes = await recorded.arrayBuffer();

  // Decoded at whatever it was recorded at, then rendered again at the rate
  // whisper wants: `OfflineAudioContext` is the resampler every browser ships.
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(bytes);
  void decoder.close();

  const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
  const offline = new OfflineAudioContext(1, frames, RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return new Blob([encode(rendered.getChannelData(0))], { type: 'audio/wav' });
}

/** The 44-byte header everything understands, then 16-bit samples. */
function encode(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const text = (at: number, said: string) => {
    for (let index = 0; index < said.length; index += 1) view.setUint8(at + index, said.charCodeAt(index));
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  // 1 is PCM; 1 channel; the rate, then bytes per second and per frame.
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Clamped before scaling: a sample past ±1 wraps to the opposite extreme
  // otherwise, which is heard as a click on every loud syllable.
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}
