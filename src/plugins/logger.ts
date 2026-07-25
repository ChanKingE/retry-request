import type { RequestPlugin } from "@/types.ts";

/** 日志插件配置。 */
export interface LoggerPluginOptions {
  /**
   * 自定义日志实现，只要求提供 `debug` 和 `error`。
   *
   * @defaultValue 全局 `console`
   */
  logger?: Pick<Console, "debug" | "error">;
}

/**
 * 创建记录请求、响应和错误的日志插件。
 *
 * @param options - 日志输出配置。
 * @returns 可通过 `client.use` 安装的插件。
 * @remarks 请求与成功响应使用 `debug`，失败使用 `error`；清理插件会卸载两个拦截器。
 *
 * @example
 * ```ts
 * const removeLogger = client.use(createLoggerPlugin());
 * removeLogger();
 * ```
 */
export function createLoggerPlugin(options: LoggerPluginOptions = {}): RequestPlugin {
  const logger = options.logger ?? console;
  return {
    name: "logger",
    setup(client) {
      const removeRequest = client.useRequestInterceptor({
        fulfilled(config) {
          logger.debug(`[Request] ${config.method ?? "GET"} ${config.url}`, config);
          return config;
        },
      });
      const removeResponse = client.useResponseInterceptor({
        fulfilled(response) {
          logger.debug(`[Response] ${response.status} ${response.config.url}`, response.data);
          return response;
        },
        rejected(error) {
          logger.error("[Request error]", error);
          throw error;
        },
      });
      return () => {
        removeRequest();
        removeResponse();
      };
    },
  };
}
