import { FetchAdapter } from "./adapter/fetch.adapter.ts";
import { RequestClient } from "./client.ts";
import { createResponseEnvelopeInterceptor } from "./helpers.ts";
import type { ClientOptions } from "./types.ts";

/**
 * 创建请求客户端。
 * 默认使用 FetchAdapter、10 秒超时，并解包 `{ code, data, message }` 响应。
 *
 * @param options - 客户端默认配置、自定义适配器及业务响应解包选项。
 * @returns 已完成默认响应拦截器安装的 RequestClient 实例。
 *
 * @example
 * ```ts
 * const client = createHttpClient({
 *   baseURL: "https://api.example.com",
 *   timeout: 5_000,
 * });
 * ```
 */
export function createHttpClient(options: ClientOptions = {}): RequestClient {
  const {
    adapter = new FetchAdapter(),
    responseEnvelope,
    timeout = 10_000,
    ...clientOptions
  } = options;
  const client = new RequestClient(adapter, { ...clientOptions, timeout });
  if (responseEnvelope !== false) {
    client.useResponseInterceptor(createResponseEnvelopeInterceptor(responseEnvelope));
  }
  return client;
}

/**
 * 开箱即用的默认请求客户端。
 *
 * @remarks 使用当前运行环境的原生 fetch、10 秒超时和标准业务响应解包规则。
 */
export const httpClient = createHttpClient();

export * from "./adapter/index.ts";
export * from "./client.ts";
export * from "./error.ts";
export * from "./helpers.ts";
export * from "./interceptor.ts";
export * from "./plugins/logger.ts";
export * from "./plugins/mock/index.ts";
export * from "./retry.ts";
export * from "./types.ts";
