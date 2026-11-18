import { apiUrl } from "./base-url";
import type {
  ApiClient,
  ClientRequestOptions,
  FormValue,
  HttpMethod,
} from "./client-types";
import { apiFetch } from "./http";
import { toQueryString } from "./query-string";

type CallArgs = {
  param?: Record<string, string | number>;
  query?: Record<string, unknown>;
  json?: unknown;
  form?: Record<string, FormValue | FormValue[]>;
};

const METHODS: Record<string, HttpMethod> = {
  $get: "get",
  $post: "post",
  $put: "put",
  $patch: "patch",
  $delete: "delete",
};

function buildPath(segments: string[], param: CallArgs["param"]): string {
  return segments
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const value = param?.[segment.slice(1)];
      if (value === undefined) {
        throw new Error(`Missing path parameter "${segment.slice(1)}"`);
      }
      return encodeURIComponent(String(value));
    })
    .join("/");
}

function buildBody(args: CallArgs): BodyInit | undefined {
  if (args.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(args.form)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        form.append(key, item);
      }
    }
    return form;
  }
  return args.json === undefined ? undefined : JSON.stringify(args.json);
}

export function buildRequest(
  segments: string[],
  method: HttpMethod,
  args: CallArgs = {},
  options: ClientRequestOptions = {},
): [string, RequestInit] {
  const url =
    apiUrl(buildPath(segments, args.param)) + toQueryString(args.query);
  const headers = new Headers(options.init?.headers);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return [
    url,
    {
      ...options.init,
      method: method.toUpperCase(),
      headers,
      body: buildBody(args),
    },
  ];
}

function node(segments: string[]): unknown {
  return new Proxy(() => undefined, {
    get(_target, key) {
      // Not a promise, and no symbol-keyed lookups become path segments.
      if (typeof key === "symbol" || key === "then") return undefined;
      const method = METHODS[key];
      if (method) {
        return (args?: CallArgs, options?: ClientRequestOptions) =>
          apiFetch(...buildRequest(segments, method, args, options));
      }
      return node([...segments, key]);
    },
  });
}

/**
 * Typed API client with the Hono client's call shape, built from the OpenAPI
 * spec: `client.task[":id"].$get({ param: { id } })` returns a `Response`
 * whose `json()` is typed with the endpoint's success body.
 */
export const client = node([]) as ApiClient;
