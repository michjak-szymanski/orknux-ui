import { ApiError, request } from './client';

/**
 * Asks for a reset link.
 *
 * Resolves to the one sentence the server answers with, which is the same
 * sentence whether or not that address belongs to an account - so nothing here
 * branches on it, and nothing here should start.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const response = await request('/api/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After') ?? '0');
    throw new ApiError(
      seconds > 0
        ? `Too many attempts. Try again in ${seconds} seconds.`
        : 'Too many attempts. Try again in a little while.',
      429,
    );
  }
  if (!response.ok) {
    throw new ApiError(`Could not ask for a link (status ${response.status})`, response.status);
  }

  return ((await response.json()) as { message: string }).message;
}

/**
 * Follows the link and sets the password. Resolves to the username it belonged
 * to, which the sign-in form is then filled in with.
 *
 * The server's own sentence does not survive Boot's error page, so the wording
 * for a refusal is written here. There is only one thing a 400 can mean by the
 * time this is called: the length is checked before sending, so what is left is
 * a link that has been used, has expired, or was never issued.
 */
export async function completePasswordReset(token: string, password: string): Promise<string> {
  const response = await request('/api/password-reset/complete', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });

  if (response.status === 400) {
    throw new ApiError('That link is no longer valid. Ask for a new one from the sign-in page.', 400);
  }
  if (response.status === 429) {
    throw new ApiError('Too many attempts. Try again in a little while.', 429);
  }
  if (!response.ok) {
    throw new ApiError(`Could not set the password (status ${response.status})`, response.status);
  }

  return ((await response.json()) as { username: string }).username;
}

/**
 * The shortest password the server will take.
 *
 * Checked here as well as there so somebody is told before they submit, not
 * because this is where the rule lives - it lives in the server, and this number
 * follows it.
 */
export const SHORTEST_PASSWORD = 12;
