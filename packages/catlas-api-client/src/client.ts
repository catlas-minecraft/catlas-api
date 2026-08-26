import createClient from "openapi-fetch";
import type { components, paths } from "./generated.ts";

export type World = components["schemas"]["World"];
export type Viewport = components["schemas"]["Viewport"];
export type ViewportNode = components["schemas"]["ViewportNode"];
export type ViewportWay = components["schemas"]["ViewportWay"];
export type ViewportWayNode = components["schemas"]["ViewportWayNode"];
export type Point = components["schemas"]["Point"];

/** A Catlas bbox is ordered as minX, minZ, maxX, maxZ. */
export type BBox = readonly [number, number, number, number];

export type CatlasFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CatlasApiOptions = {
  readonly baseUrl?: string;
  readonly credentials?: RequestCredentials;
  readonly fetch?: CatlasFetch;
};

export type ViewportRequestOptions = {
  readonly signal?: AbortSignal;
};

export type RequestOptions = ViewportRequestOptions;

export class CatlasApiError extends Error {
  readonly status: number;
  readonly response: Response | undefined;
  readonly detail?: unknown;

  constructor(
    message: string,
    options: { status?: number; response?: Response; detail?: unknown } = {},
  ) {
    super(message, { cause: options.response ?? options.detail });
    this.name = "CatlasApiError";
    this.status = options.status ?? 0;
    this.response = options.response;
    this.detail = options.detail;
  }
}

export class CatlasNetworkError extends Error {
  constructor(message = "Could not reach the Catlas API.", cause?: unknown) {
    super(message, { cause });
    this.name = "CatlasNetworkError";
  }
}

export type CatlasApi = {
  readonly listWorlds: (options?: RequestOptions) => Promise<World[]>;
  readonly getWorld: (worldSlug: string, options?: RequestOptions) => Promise<World>;
  readonly loadViewport: (
    worldSlug: string,
    bbox: BBox,
    options?: ViewportRequestOptions,
  ) => Promise<Viewport>;
};

type ApiResult<T> = {
  readonly data?: T;
  readonly error?: unknown;
  readonly response: Response;
};

const errorDetail = (error: unknown): string | undefined => {
  if (typeof error === "string" && error.length > 0) return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") return error.message;
    if ("detail" in error && typeof error.detail === "string") return error.detail;
    try {
      return JSON.stringify(error);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const unwrap = async <T>(result: ApiResult<T>): Promise<T> => {
  if (result.response.ok && result.error === undefined && result.data !== undefined) {
    return result.data;
  }

  const detail = errorDetail(result.error);
  const status = result.response.status;
  const statusText = result.response.statusText || "Unknown error";
  throw new CatlasApiError(detail || `Catlas API request failed (${status} ${statusText}).`, {
    detail: result.error,
    response: result.response,
    status,
  });
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");

const request = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CatlasApiError || isAbortError(error)) throw error;
    throw new CatlasNetworkError(undefined, error);
  }
};

export const createCatlasApi = (options: CatlasApiOptions = {}): CatlasApi => {
  const client = options.fetch
    ? createClient<paths>({
        baseUrl: options.baseUrl ?? "/api",
        credentials: options.credentials ?? "same-origin",
        fetch: options.fetch as (input: Request) => Promise<Response>,
      })
    : createClient<paths>({
        baseUrl: options.baseUrl ?? "/api",
        credentials: options.credentials ?? "same-origin",
      });

  return {
    listWorlds: (requestOptions = {}) =>
      request(() =>
        (requestOptions.signal
          ? client.GET("/worlds", { signal: requestOptions.signal })
          : client.GET("/worlds")
        ).then((result) => unwrap<World[]>(result)),
      ),
    getWorld: (worldSlug, requestOptions = {}) =>
      request(() =>
        (requestOptions.signal
          ? client.GET("/worlds/{worldSlug}", {
              params: { path: { worldSlug } },
              signal: requestOptions.signal,
            })
          : client.GET("/worlds/{worldSlug}", { params: { path: { worldSlug } } })
        ).then((result) => unwrap<World>(result)),
      ),
    loadViewport: (worldSlug, bbox, requestOptions = {}) =>
      request(() =>
        (requestOptions.signal
          ? client.GET("/worlds/{worldSlug}/viewport", {
              params: {
                path: { worldSlug },
                query: { bbox: bbox.join(","), includeRelations: false },
              },
              signal: requestOptions.signal,
            })
          : client.GET("/worlds/{worldSlug}/viewport", {
              params: {
                path: { worldSlug },
                query: { bbox: bbox.join(","), includeRelations: false },
              },
            })
        ).then((result) => unwrap<Viewport>(result)),
      ),
  };
};
