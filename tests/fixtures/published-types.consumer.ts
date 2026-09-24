import type {
  ClientOptions,
  InterceptorRequestOptions,
  RequestOptions,
} from "../../dist/index.mjs";

const clientOptions = {
  baseURL: "https://api.example.test",
  headers: { authorization: "Bearer token" },
} satisfies ClientOptions;

const interceptedOptions = {
  url: "/users",
  method: "GET" as const,
  headers: {},
  data: {},
  params: {},
} satisfies InterceptorRequestOptions;

const requestOptions: RequestOptions = interceptedOptions;

export { clientOptions, interceptedOptions, requestOptions };
