import { toWav } from './wav';

/**
 * Speech to text, for the microphone in a chat.
 *
 * REST rather than GraphQL because what goes up is a recording: a multipart
 * upload is what a browser's recorder produces, and putting the same bytes
 * through a JSON field would mean base64 both ways for no gain.
 *
 * Which model does it is the workspace's setting, so nothing here chooses one —
 * this only says which workspace is asking.
 */
export async function transcribe(workspaceId: string, audio: Blob): Promise<string> {
  /*
   * Converted before it goes.
   *
   * A browser records webm/opus, or mp4/aac on Safari, and whisper.cpp decodes
   * neither — its endpoint answers 400 to anything that is not PCM WAV. The
   * browser can decode what it just recorded, so the conversion happens where
   * the audio already is rather than as ffmpeg on a server.
   */
  const wav = await toWav(audio);

  const form = new FormData();
  // Named, because most of these servers pick a decoder from the extension.
  form.append('audio', wav, 'speech.wav');

  const answer = await fetch(`/api/workspaces/${workspaceId}/transcription`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  const said = (await answer.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!answer.ok) {
    throw new Error(said?.error ?? 'That could not be transcribed.');
  }
  return said?.text ?? '';
}


