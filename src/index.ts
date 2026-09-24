import { createHttpClient } from "@/helpers.ts";

/**
 * 开箱即用的默认请求客户端。
 *
 * @remarks 使用当前运行环境的原生 fetch、10 秒超时；默认不解包业务响应。
 */
export const httpClient = createHttpClient();

export * from "./adapter/index.ts";
export * from "./client.ts";
export * from "./error.ts";
export * from "./helpers.ts";
export * from "./interceptor.ts";
export * from "./plugins/dedupe/index.ts";
export * from "./plugins/logger.ts";
export * from "./plugins/mock/index.ts";
export * from "./retry.ts";
export * from "./types.ts";
