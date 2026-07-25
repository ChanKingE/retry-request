import type { HttpResponse, RequestConfig } from "./types.ts";

/**
 * 表示请求未获得可用 HTTP 响应的传输层错误。
 *
 * @remarks 常见原因包括断网、DNS 解析失败、连接拒绝和浏览器 CORS 阻断。
 */
export class NetworkError extends Error {
  /** 触发错误的最终请求配置，未知时为空。 */
  readonly config?: RequestConfig;

  /**
   * 创建网络错误。
   *
   * @param message - 面向调用方的错误消息。
   * @param options - 原始异常和请求配置。
   */
  constructor(
    message = "Network error",
    options: { cause?: unknown; config?: RequestConfig } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "NetworkError";
    this.config = options.config;
  }
}

/** 表示请求执行时间超过 `RequestConfig.timeout` 的错误。 */
export class TimeoutError extends Error {
  /** 触发超时的最终请求配置，未知时为空。 */
  readonly config?: RequestConfig;

  /**
   * 创建超时错误。
   *
   * @param message - 错误消息。@defaultValue `Request timeout`
   * @param options - 原始异常和请求配置。
   */
  constructor(
    message = "Request timeout",
    options: { cause?: unknown; config?: RequestConfig } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "TimeoutError";
    this.config = options.config;
  }
}

/**
 * 表示服务端已经返回响应，但 HTTP 状态码大于等于 400。
 *
 * @typeParam T - 错误响应体类型。
 */
export class HttpError<T = unknown> extends Error {
  /** HTTP 状态码。 */
  readonly status: number;
  /** 包含响应体、响应头和请求配置的完整响应。 */
  readonly response?: HttpResponse<T>;

  /**
   * 创建 HTTP 错误。
   *
   * @param message - HTTP 状态描述或自定义消息。
   * @param status - HTTP 状态码。
   * @param response - 可选的完整响应。
   * @param options - 可选的原始异常。
   */
  constructor(
    message: string,
    status: number,
    response?: HttpResponse<T>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.response = response;
  }
}

/** 表示 HTTP 请求成功，但业务状态码不符合成功条件。 */
export class BusinessError extends Error {
  /** 转换为字符串后的业务状态码。 */
  readonly code: string;
  /** 业务响应 `data` 字段中的错误详情。 */
  readonly details?: unknown;

  /**
   * 创建业务错误。
   *
   * @param message - 业务错误消息。
   * @param code - 业务状态码。
   * @param details - 可选的业务错误详情。
   * @param options - 可选的原始异常。
   */
  constructor(message: string, code: string, details?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BusinessError";
    this.code = code;
    this.details = details;
  }
}

/** 客户端能够识别和标准化的四类请求错误联合类型。 */
export type RequestError = NetworkError | TimeoutError | HttpError | BusinessError;

/**
 * 判断未知值是否已经是标准请求错误。
 *
 * @param error - 待检查的未知值。
 * @returns 命中四种标准错误类之一时返回 `true`。
 */
export function isRequestError(error: unknown): error is RequestError {
  return (
    error instanceof NetworkError ||
    error instanceof TimeoutError ||
    error instanceof HttpError ||
    error instanceof BusinessError
  );
}

/**
 * 判断未知值是否为 AbortController 产生的取消错误。
 *
 * @param error - 待检查的未知值。
 * @returns 当值为 `Error` 且 `name === "AbortError"` 时返回 `true`。
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 将 Fetch、Axios 风格错误或未知异常转换为统一错误。
 * 主动取消错误会保持原样，方便调用方通过 name 判断。
 *
 * @param error - 适配器、拦截器或重试流程抛出的未知异常。
 * @param config - 与错误关联的最终请求配置。
 * @returns 已标准化的错误；标准错误和 AbortError 会原样返回。
 */
export function normalizeRequestError(error: unknown, config?: RequestConfig): Error {
  if (isRequestError(error) || isAbortError(error)) return error;

  if (isRecord(error)) {
    const message = typeof error.message === "string" ? error.message : "Request failed";
    if (error.code === "ECONNABORTED" || /timeout/i.test(message)) {
      return new TimeoutError(message, { cause: error, config });
    }

    const response = error.response;
    if (isRecord(response) && typeof response.status === "number") {
      return new HttpError(message, response.status, response as unknown as HttpResponse, {
        cause: error,
      });
    }
  }

  const message = error instanceof Error ? error.message : "Network error";
  return new NetworkError(message, { cause: error, config });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
