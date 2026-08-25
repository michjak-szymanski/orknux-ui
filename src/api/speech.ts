import { t } from '../i18n';
/**
 * Text to speech, for reading an answer aloud.
 *
 * REST rather than GraphQL because what comes back is audio: a JSON field would
 * mean base64 for bytes the browser is about to hand straight to an `Audio`.
 *
 * Which model reads is the workspace's setting, so nothing here chooses one —
 * this only says which workspace is asking, and what to read.
 */
export async function speak(workspaceId: string, text: string): Promise<Blob> {
  const answer = await fetch(`/api/workspaces/${workspaceId}/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    credentials: 'include',
  });

  if (!answer.ok) {
    /*
     * The refusal is JSON where the answer would have been audio. Read as text
     * first: a proxy or a gateway in front of this answers HTML, and calling
     * `.json()` on that throws something about a syntax error rather than
     * saying what went wrong.
     */
    const said = await answer.text().catch(() => '');
    const reason = (() => {
      try {
        return (JSON.parse(said) as { error?: string }).error;
      } catch {
        return undefined;
      }
    })();
    throw new Error(reason ?? t('That could not be read aloud.'));
  }

  return answer.blob();
}
