/**
 * Thin wrapper over the orknux-server API. Requests always carry the session
 * cookie; in development Vite proxies /api and /graphql to the server.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
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
  const message = payload.errors?.[0]?.message;
  if (message !== undefined) {
    throw new ApiError(message, response.status);
  }
  if (payload.data === undefined) {
    throw new ApiError('Response contained no data', response.status);
  }

  return payload.data;
}
