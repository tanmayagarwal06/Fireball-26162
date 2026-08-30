/**
 * Single HTTP entry point for the whole application.
 *
 * Every request to the FastAPI backend goes through `apiRequest`. Components
 * never call fetch() directly, which keeps the base URL, query serialisation
 * and error normalisation in one place.
 */

const FALLBACK_BASE_URL = 'http://127.0.0.1:8000';

/**
 * Backend origin. Override with VITE_API_BASE_URL in frontend/.env.local.
 * The backend enables CORS for all origins, so the browser calls it directly
 * and no dev proxy is needed.
 */
export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || FALLBACK_BASE_URL
).replace(/\/+$/, '');

/** Values accepted in a query object. null/undefined entries are dropped. */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/**
 * Normalised failure for any backend call.
 *
 * `status` is null when the request never reached the server (backend down,
 * DNS failure, connection refused), which is the single most common failure
 * during development and deserves a distinct message.
 */
export class ApiError extends Error {
  readonly status: number | null;
  readonly url: string;
  readonly detail: unknown;

  constructor(message: string, options: { status: number | null; url: string; detail?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.url = options.url;
    this.detail = options.detail;
  }

  /** True when the server could not be reached at all. */
  get isNetworkFailure(): boolean {
    return this.status === null;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Serialise a query object, skipping null, undefined and empty strings so that
 * an unset filter never sends a parameter the backend would try to apply.
 */
export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) return '';

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    search.append(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

export interface RequestOptions {
  query?: QueryParams;
  /** Pass an AbortSignal so React can cancel in-flight requests on unmount. */
  signal?: AbortSignal;
}

/**
 * Extract FastAPI's `{"detail": ...}` payload when present, so the UI can show
 * the server's own message instead of a generic status line.
 */
async function readErrorDetail(response: Response): Promise<{ message: string; detail: unknown }> {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const body: unknown = await response.json();

    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) {
        return { message: detail, detail };
      }
      return { message: fallback, detail };
    }

    return { message: fallback, detail: body };
  } catch {
    return { message: fallback, detail: undefined };
  }
}

/**
 * Perform a GET request against the backend and decode the JSON body.
 *
 * The return type is asserted rather than validated at runtime. That is a
 * deliberate trade-off: the backend serves a fixed local mock dataset, so a
 * schema validator would add a dependency and runtime cost for no real safety
 * gain. If the backend later fronts live FIRMS ingestion, add validation here —
 * this function is the only place it would need to go.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}${buildQueryString(options.query)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (cause) {
    // Re-throw cancellations untouched so callers can ignore them.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    throw new ApiError(
      `Cannot reach the backend at ${API_BASE_URL}. Start it with "python -m uvicorn app:app --reload --port 8000" from the backend directory.`,
      { status: null, url, detail: cause },
    );
  }

  if (!response.ok) {
    const { message, detail } = await readErrorDetail(response);
    throw new ApiError(message, { status: response.status, url, detail });
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ApiError('The backend returned a malformed JSON response.', {
      status: response.status,
      url,
      detail: cause,
    });
  }
}

/** Turn any thrown value into a message safe to render in the UI. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
