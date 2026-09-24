import { FetchAdapter } from "@/adapter/fetch.adapter.ts";
import { RequestClient } from "@/client.ts";
import { BusinessError } from "@/error.ts";
import type {
  ClientOptions,
  HttpResponse,
  Interceptor,
  RequestOptions,
  ResponseEnvelopeOptions,
} from "@/types.ts";

export { getAbortReason, resolveURL } from "@/internal/request.ts";

/**
 * 创建请求客户端。
 * 默认使用 FetchAdapter、10 秒超时；可按需启用业务响应解包。
 *
 * @param options - 客户端默认配置及自定义适配器。
 * @param responseEnvelope - 默认 false；设为 true 使用标准字段映射，或传入自定义字段映射。
 * @returns 按需安装业务响应解包拦截器的 RequestClient 实例。
 *
 * @example
 * ```ts
 * const client = createHttpClient({
 *   baseURL: "https://api.example.com",
 *   timeout: 5_000,
 * });
 * ```
 */
export function createHttpClient(
  options: ClientOptions = {},
  responseEnvelope: boolean | ResponseEnvelopeOptions = false,
): RequestClient {
  const { adapter = new FetchAdapter(), timeout = 10_000, ...clientOptions } = options;
  const client = new RequestClient(adapter, { ...clientOptions, timeout });
  if (responseEnvelope) {
    client.useResponseInterceptor(
      createResponseEnvelopeInterceptor(responseEnvelope === true ? undefined : responseEnvelope),
    );
  }
  return client;
}

/**
 * 创建共享同一个 AbortController 的一次性请求执行器。
 * 适合在组件卸载或路由切换时统一取消相关请求。
 *
 * @param client - 用于执行请求的客户端。
 * @returns `execute` 与 `abort` 组成的控制对象。每次 execute 都会注入同一个 signal。
 * @remarks 调用 abort 后该控制器不可复用，需要重新调用 createRequest。
 *
 * @example
 * ```ts
 * const pending = createRequest(client);
 * const promise = pending.execute<User>({ url: "/profile" });
 * pending.abort();
 * ```
 */
export function createRequest(client: RequestClient): {
  /**
   * 使用共享 signal 发起请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TParams - 查询参数类型。
   * @typeParam TData - 请求体类型。
   * @param config - 请求配置；传入的 signal 会被共享 signal 覆盖。
   */
  execute: <T, TBody = unknown>(config: RequestOptions<TBody>) => Promise<T>;
  /**
   * 取消所有由该控制对象发起且尚未完成的请求。
   *
   * @param reason - 可选取消原因；省略时运行环境通常产生 AbortError。
   */
  abort: (reason?: unknown) => void;
} {
  const controller = new AbortController();
  return {
    execute: <T, TBody = unknown>(config: RequestOptions<TBody>) =>
      client.request<T, TBody>({ ...config, signal: controller.signal }),
    abort: (reason?: unknown) => controller.abort(reason),
  };
}

/**
 * 创建标准业务响应解包拦截器。
 *
 * @param options - 成功码及 code、data、message 字段名映射。
 * @returns 可直接注册到 RequestClient 的响应拦截器。
 * @throws {@link BusinessError} 响应包含 code 字段且 code 不等于成功值。
 * @remarks 不含 code 字段的对象、基本类型和空响应保持原样。
 *
 * @example
 * ```ts
 * client.useResponseInterceptor(
 *   createResponseEnvelopeInterceptor({ successCode: 200 }),
 * );
 * ```
 */
export function createResponseEnvelopeInterceptor(
  options: ResponseEnvelopeOptions = {},
): Interceptor<HttpResponse> {
  const successCode = String(options.successCode ?? 0);
  const codeKey = options.codeKey ?? "code";
  const dataKey = options.dataKey ?? "data";
  const messageKey = options.messageKey ?? "message";

  return {
    fulfilled(response) {
      // 没有业务 code 的普通响应不做任何转换。
      if (!isRecord(response.data) || !(codeKey in response.data)) return response;
      const code = String(response.data[codeKey]);
      if (code !== successCode) {
        const message = response.data[messageKey];
        throw new BusinessError(
          typeof message === "string" ? message : "Business error",
          code,
          response.data[dataKey],
        );
      }
      return { ...response, data: response.data[dataKey] };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
