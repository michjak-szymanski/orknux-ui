import { refusalsIn } from '../i18n/refusals';
import { t } from '../i18n';

/**
 * Thin wrapper over the orknux-server API. Requests always carry the session
 * cookie; in development Vite proxies /api and /graphql to the server.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * What the server called this refusal, where it said: the exception's own
     * class name, less `Exception`. It is what a Polish sentence is looked up
     * under, and it is undefined for anything that did not come back as a
     * mapped GraphQL error.
     */
    readonly code?: string,
    /** The values that refusal's sentence puts into itself, by name. */
    readonly arguments_?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PageOf<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

interface GraphQlError {
  message: string;
  /**
   * What the server put beside the sentence so a client can say it in its own
   * language: `code`, and `arguments` where the sentence carries values. Every
   * `…ExceptionResolver` sends them; anything else - a validation error out of
   * graphql-java, a field that threw - sends neither, which is why both are
   * optional and why `message` is still what is shown when they are absent.
   */
  extensions?: { code?: string; arguments?: Record<string, unknown> };
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<GraphQlError>;
}

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await request('/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status);
  }

  const payload = (await response.json()) as GraphQlResponse<T>;
  const failed = payload.errors?.[0];
  if (failed !== undefined) {
    /*
     * The English sentence is carried alongside the code, not replaced by it.
     *
     * It is what a screen shows for any refusal the catalogue has no Polish
     * for, which is most of them at any moment - so a language nobody has
     * finished translating shows correct English rather than a bare
     * `WorkspaceNameTaken`.
     */
    throw new ApiError(
      refusal(failed),
      response.status,
      failed.extensions?.code,
      failed.extensions?.arguments,
    );
  }
  if (payload.data === undefined) {
    throw new ApiError(t('Response contained no data'), response.status);
  }

  return payload.data;
}

/**
 * A refusal in the reader's language, or the server's English where there is
 * none.
 *
 * Here rather than at every `catch`: a page catches an `ApiError` and prints
 * `cause.message` in about ninety places, and a translation that had to be
 * asked for at each of them would be missing from the ninety-first.
 */
function refusal(failed: GraphQlError): string {
  const code = failed.extensions?.code;
  if (code === undefined) return failed.message;
  const said = refusalsIn()[code];
  if (said === undefined) return failed.message;
  const values = failed.extensions?.arguments ?? {};
  return said.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in values)) return whole;
    const value = values[name];
    /*
     * A list is joined the way the English joined it. Several refusals name
     * everything that is still using a thing, and `String(['a','b'])` is
     * `a,b` - a list with the spaces taken out, which reads as a typo.
     */
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}
