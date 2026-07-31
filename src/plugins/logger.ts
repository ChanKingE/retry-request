import type { HttpResponse, RequestConfig, RequestPlugin } from "@/types.ts";

/** 日志插件配置。 */
export interface LoggerPluginOptions {
  /**
   * 自定义日志实现，只要求提供 `debug` 和 `error`。
   *
   * @remarks 可通过 `config.logger.logger` 为单次请求覆盖；兼容旧的 `config.meta.logger.logger`。
   * @defaultValue 全局 `console`
   */
  logger?: Pick<Console, "debug" | "error">;
}

declare module "@/types.ts" {
  interface RequestConfigExtensions {
    /** 单次请求的日志配置；优先级高于 `meta.logger`。 */
    logger?: LoggerPluginOptions;
  }
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
  const defaultLogger = options.logger ?? console;
  return {
    name: "logger",
    setup(client) {
      const removeRequest = client.useRequestInterceptor({
        fulfilled(config) {
          const logger = resolveLogger(config, defaultLogger);
          logger.debug(`[Request] ${config.method ?? "GET"} ${config.url}`, config);
          return config;
        },
      });
      const removeResponse = client.useResponseInterceptor({
        fulfilled(response) {
          const logger = resolveLogger(response.config, defaultLogger);
          logger.debug(`[Response] ${response.status} ${response.config.url}`, response.data);
          return response;
        },
        rejected(error, latestResponse) {
          const logger = resolveLogger(getErrorConfig(error, latestResponse), defaultLogger);
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

function resolveLogger(
  config: RequestConfig | undefined,
  defaultLogger: Pick<Console, "debug" | "error">,
): Pick<Console, "debug" | "error"> {
  const requestLogger = config?.logger ?? config?.meta?.logger;
  if (!isRecord(requestLogger)) return defaultLogger;
  const logger = requestLogger.logger;
  return isLogger(logger) ? logger : defaultLogger;
}

function getErrorConfig(
  error: unknown,
  latestResponse: HttpResponse | undefined,
): RequestConfig | undefined {
  if (latestResponse) return latestResponse.config;
  if (isRecord(error)) {
    const response = error.response;
    if (isRecord(response) && isRecord(response.config)) {
      return response.config as unknown as RequestConfig;
    }
    if (isRecord(error.config)) return error.config as unknown as RequestConfig;
  }
  return undefined;
}

function isLogger(value: unknown): value is Pick<Console, "debug" | "error"> {
  return isRecord(value) && typeof value.debug === "function" && typeof value.error === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
