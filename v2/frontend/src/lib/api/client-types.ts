// Turns the OpenAPI `paths` map into the Hono-style client shape the fetchers
// use: `client.task[":id"].$put({ param, json })`.
import type { extraPaths } from "@/api/extra-paths";
import type { paths } from "@/api/schema";

type AllPaths = paths & extraPaths;
type PathKey = keyof AllPaths & string;

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 206;

type JsonOf<R> = R extends { content: { "application/json": infer B } }
  ? B
  : R extends { content: { [type: string]: infer B } }
    ? B
    : unknown;

type ResponsesOf<Op> = Op extends { responses: infer R } ? R : never;

type BodyForStatus<Op, S> =
  ResponsesOf<Op> extends infer R
    ? S extends keyof R
      ? JsonOf<R[S]>
      : never
    : never;

type SuccessBody<Op> = BodyForStatus<
  Op,
  Extract<keyof ResponsesOf<Op>, SuccessStatus>
>;

/** A fetch `Response` whose `json()` resolves to the documented success body. */
export type ClientResponse<Body> = Omit<Response, "json"> & {
  json(): Promise<Body>;
};

type QueryValue = string | number | boolean | null | undefined;

// Query strings are text on the wire, so every documented value also accepts
// its string form, like the Hono client did.
type QueryInput<Q> = {
  [K in keyof Q]: Q[K] | QueryValue | readonly QueryValue[];
};

type ParametersOf<Op> = Op extends { parameters: infer P } ? P : never;

type ParamArg<Op> =
  ParametersOf<Op> extends { path: infer P }
    ? [P] extends [never]
      ? unknown
      : { param: P }
    : unknown;

type QueryOf<P> = P extends { query?: infer Q } ? NonNullable<Q> : never;

type QueryArg<Op> = [QueryOf<ParametersOf<Op>>] extends [never]
  ? unknown
  : // `{}` fits only when `query` is optional.
    {} extends Pick<ParametersOf<Op>, "query" & keyof ParametersOf<Op>>
    ? { query?: QueryInput<QueryOf<ParametersOf<Op>>> }
    : { query: QueryInput<QueryOf<ParametersOf<Op>>> };

type BodyContent<Op> = Op extends { requestBody?: infer B }
  ? NonNullable<B> extends { content: infer C }
    ? C
    : never
  : never;

export type FormValue = string | Blob;

type BodyArg<Op> = [BodyContent<Op>] extends [never]
  ? unknown
  : BodyContent<Op> extends { "application/json": infer J }
    ? Op extends { requestBody: unknown }
      ? { json: J }
      : { json?: J }
    : BodyContent<Op> extends { "multipart/form-data": infer F }
      ? { form: { [K in keyof F]: FormValue } }
      : unknown;

export type EndpointArgs<Op> = ParamArg<Op> & QueryArg<Op> & BodyArg<Op>;

export type ClientRequestOptions = {
  init?: RequestInit;
  headers?: HeadersInit;
};

type IsEmptyArgs<A> = keyof A extends never ? true : false;

export type Endpoint<Op> = {
  // Kept on the type so the Infer* helpers can read them back.
  readonly __op?: Op;
} & (true extends IsEmptyArgs<EndpointArgs<Op>>
  ? (
      args?: EndpointArgs<Op>,
      options?: ClientRequestOptions,
    ) => Promise<ClientResponse<SuccessBody<Op>>>
  : (
      args: EndpointArgs<Op>,
      options?: ClientRequestOptions,
    ) => Promise<ClientResponse<SuccessBody<Op>>>);

type PathItemEndpoints<Item> = {
  [
    M in HttpMethod as Item extends { [K in M]: infer Op }
      ? [Op] extends [never]
        ? never
        : [undefined] extends [Op]
          ? never
          : `$${M}`
      : never
  ]: Item extends { [K in M]: infer Op } ? Endpoint<Op> : never;
};

type StripSlash<P> = P extends `/${infer Rest}` ? Rest : P;

type Head<P> = P extends `${infer H}/${string}` ? H : P extends "" ? never : P;

type Tail<P, H extends string> = P extends `${H}/${infer T}`
  ? T
  : P extends H
    ? ""
    : never;

type SegmentKey<S> = S extends `{${infer Name}}` ? `:${Name}` : S;

// Builds one node of the client tree from the remaining suffixes of every
// path that shares `Prefix`; "" marks a path that ends here.
type ClientNode<Prefix extends string, Rest extends string> = {
  [H in Head<Rest> as SegmentKey<H>]: ClientNode<
    Prefix extends "" ? H : `${Prefix}/${H}`,
    Tail<Rest, H>
  >;
} & ("" extends Rest
  ? `/${Prefix}` extends PathKey
    ? PathItemEndpoints<AllPaths[`/${Prefix}`]>
    : unknown
  : unknown);

export type ApiClient = ClientNode<"", StripSlash<PathKey>>;

type OpOf<E> = E extends { readonly __op?: infer Op } ? Op : never;

/** Request argument object of an endpoint, e.g. `InferRequestType<typeof client.task.$post>["json"]`. */
export type InferRequestType<E> = EndpointArgs<OpOf<E>>;

/** Success body of an endpoint, or the body for one status code. */
export type InferResponseType<
  E,
  Status extends number = SuccessStatus,
> = BodyForStatus<OpOf<E>, Status>;
