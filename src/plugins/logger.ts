import type { HttpResponse, RequestOptions, RequestPlugin } from "@/types.ts";

/** 日志插件配置。 */
export interface LoggerPluginOptions {
  /**
   * 自定义日志实现，只要求提供 `debug` 和 `error`。
   *
   * @remarks 可通过 `config.logger.logger` 为单次请求覆盖。
   * @defaultValue 全局 `console`
   */
  logger?: Pick<Console, "debug" | "error">;
  /**
   * 除内置敏感字段外额外脱敏的请求或响应头名称，不区分大小写。
   *
   * @defaultValue `[]`
   */
  redactHeaders?: readonly string[];
  /** 是否在请求日志中记录 `data` 请求体。@defaultValue `false` */
  logRequestBody?: boolean;
  /** 是否在响应日志和错误响应中记录 `data` 响应体。@defaultValue `false` */
  logResponseBody?: boolean;
}

const DEFAULT_REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

declare module "@/types.ts" {
  interface RequestOptionsExtensions {
    /** 单次请求的日志配置；优先级高于插件初始化参数。 */
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
  const defaultOptions = normalizeLoggerOptions(options);
  return {
    name: "logger",
    setup(client) {
      const removeRequest = client.useRequestInterceptor({
        fulfilled(config) {
          const loggerOptions = resolveLoggerOptions(config, defaultOptions);
          loggerOptions.logger.debug(
            `[Request] ${config.method ?? "GET"} ${config.url}`,
            sanitizeRequest(config, loggerOptions),
          );
          return config;
        },
      });
      const removeResponse = client.useResponseInterceptor({
        fulfilled(response) {
          const loggerOptions = resolveLoggerOptions(response.config, defaultOptions);
          loggerOptions.logger.debug(
            `[Response] ${response.status} ${response.config.url}`,
            loggerOptions.logResponseBody ? response.data : undefined,
          );
          return response;
        },
        rejected(error, latestResponse) {
          const config = getErrorConfig(error, latestResponse);
          const loggerOptions = resolveLoggerOptions(config, defaultOptions);
          loggerOptions.logger.error("[Request error]", sanitizeError(error, loggerOptions));
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

interface ResolvedLoggerOptions {
  logger: Pick<Console, "debug" | "error">;
  redactedHeaders: Set<string>;
  logRequestBody: boolean;
  logResponseBody: boolean;
}

function normalizeLoggerOptions(options: LoggerPluginOptions): ResolvedLoggerOptions {
  return {
    logger: isLogger(options.logger) ? options.logger : console,
    redactedHeaders: new Set([
      ...DEFAULT_REDACTED_HEADERS,
      ...(options.redactHeaders ?? []).map((header) => header.toLowerCase()),
    ]),
    logRequestBody: options.logRequestBody ?? false,
    logResponseBody: options.logResponseBody ?? false,
  };
}

function resolveLoggerOptions(
  config: RequestOptions | undefined,
  defaults: ResolvedLoggerOptions,
): ResolvedLoggerOptions {
  const requestLogger = config?.logger;
  if (!isRecord(requestLogger)) return defaults;
  return {
    logger: isLogger(requestLogger.logger) ? requestLogger.logger : defaults.logger,
    redactedHeaders: new Set([
      ...defaults.redactedHeaders,
      ...toStringArray(requestLogger.redactHeaders).map((header) => header.toLowerCase()),
    ]),
    logRequestBody:
      typeof requestLogger.logRequestBody === "boolean"
        ? requestLogger.logRequestBody
        : defaults.logRequestBody,
    logResponseBody:
      typeof requestLogger.logResponseBody === "boolean"
        ? requestLogger.logResponseBody
        : defaults.logResponseBody,
  };
}

function sanitizeRequest(
  config: RequestOptions,
  options: ResolvedLoggerOptions,
): Record<string, unknown> {
  const { data, headers, ...request } = config;
  return {
    ...request,
    headers: sanitizeHeaders(headers, options),
    ...(options.logRequestBody ? { data } : {}),
  };
}

function sanitizeError(error: unknown, options: ResolvedLoggerOptions): unknown {
  if (!isRecord(error)) return error;
  const { config, response, details: errorDetails, data, body, ...details } = error;
  return {
    ...details,
    ...(error instanceof Error ? { name: error.name, message: error.message } : {}),
    ...(isRecord(config)
      ? { config: sanitizeRequest(config as unknown as RequestOptions, options) }
      : {}),
    ...(isRecord(response) ? { response: sanitizeResponse(response, options) } : {}),
    ...(options.logResponseBody && errorDetails !== undefined ? { details: errorDetails } : {}),
    ...(options.logResponseBody && data !== undefined ? { data } : {}),
    ...(options.logResponseBody && body !== undefined ? { body } : {}),
  };
}

function sanitizeResponse(
  response: Record<string, unknown>,
  options: ResolvedLoggerOptions,
): Record<string, unknown> {
  const { data, headers, config, ...result } = response;
  return {
    ...result,
    ...(headers ? { headers: sanitizeHeaders(headers, options) } : {}),
    ...(isRecord(config)
      ? { config: sanitizeRequest(config as unknown as RequestOptions, options) }
      : {}),
    ...(options.logResponseBody ? { data } : {}),
  };
}

function sanitizeHeaders(headers: unknown, options: ResolvedLoggerOptions): unknown {
  if (!isRecord(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      options.redactedHeaders.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ]),
  );
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getErrorConfig(
  error: unknown,
  latestResponse: HttpResponse | undefined,
): RequestOptions | undefined {
  if (latestResponse) return latestResponse.config;
  if (isRecord(error)) {
    const response = error.response;
    if (isRecord(response) && isRecord(response.config)) {
      return response.config as unknown as RequestOptions;
    }
    if (isRecord(error.config)) return error.config as unknown as RequestOptions;
  }
  return undefined;
}

function isLogger(value: unknown): value is Pick<Console, "debug" | "error"> {
  return isRecord(value) && typeof value.debug === "function" && typeof value.error === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
