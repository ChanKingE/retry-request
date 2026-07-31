import { HttpError, NetworkError, TimeoutError } from "@/error.ts";
import { getAbortReason } from "@/helpers.ts";
import type { HttpAdapter, HttpMethod, HttpResponse, RequestConfig } from "@/types.ts";

/** AxiosAdapter 传给 Axios 实例的最小请求配置。 */
export interface AxiosRequestConfigLike {
  url: string;
  baseURL?: string;
  method?: HttpMethod;
  params?: unknown;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  withCredentials?: boolean;
  signal?: AbortSignal;
}

/** Axios 响应头对象的最小兼容结构。 */
export interface AxiosHeadersLike {
  /** AxiosHeaders 可通过 toJSON 输出普通对象。 */
  toJSON?(): Record<string, unknown>;
  [key: string]: unknown;
}

/** AxiosAdapter 依赖的最小 Axios 响应结构。 */
export interface AxiosResponseLike<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers?: AxiosHeadersLike | Record<string, unknown>;
}

/** AxiosAdapter 依赖的最小 Axios 实例接口。 */
export interface AxiosInstanceLike {
  /** Axios 实例的默认配置；Axios create() 通常会在此暴露 baseURL。 */
  defaults?: unknown;
  /** 使用完整配置执行请求。 */
  request<T = unknown>(config: AxiosRequestConfigLike): Promise<AxiosResponseLike<T>>;
}

/** Axios 拒绝值的最小兼容结构。 */
export interface AxiosErrorLike extends Error {
  /** Axios 错误码，例如 ECONNABORTED、ETIMEDOUT、ERR_CANCELED。 */
  code?: string;
  /** Axios 是否识别该错误的标记。 */
  isAxiosError?: boolean;
  /** HTTP 已返回但状态校验失败时携带的响应。 */
  response?: AxiosResponseLike;
}

/** Axios 适配器配置。 */
export interface AxiosAdapterOptions {
  /**
   * 透传给每次 Axios 请求的额外配置。
   *
   * @remarks URL、方法、参数、请求体、请求头、超时、凭证和 signal 会被单次 RequestConfig 覆盖。
   */
  [key: string]: unknown;
}

/**
 * 将 Axios 实例适配为统一 HttpAdapter 的实现。
 *
 * @remarks
 * 该类使用结构化类型，不直接依赖 `axios` 包。调用方可传入 `axios.create()` 返回的实例，
 * Axios 实例自身的 defaults 和拦截器仍然正常生效。
 *
 * @example
 * ```ts
 * import axios from "axios";
 *
 * const client = createHttpClient({
 *   adapter: new AxiosAdapter(axios.create()),
 * });
 * ```
 */
export class AxiosAdapter implements HttpAdapter {
  /**
   * 创建 Axios 适配器。
   *
   * @param instance - Axios 实例或满足 AxiosInstanceLike 的兼容对象。
   * @param options - 透传给每次 Axios 请求的额外配置。
   */
  constructor(
    readonly instance: AxiosInstanceLike,
    readonly options: AxiosAdapterOptions = {},
  ) {
    this.instance.defaults = options;
  }

  /**
   * 使用 Axios 实例执行一次请求。
   *
   * @typeParam T - 期望的响应体类型。
   * @param config - 已完成客户端默认值合并和请求拦截的配置。
   * @returns 标准化的完整 HTTP 响应。
   * @throws {@link HttpError} HTTP 状态码大于等于 400。
   * @throws {@link TimeoutError} Axios 报告请求超时。
   * @throws {@link NetworkError} 请求未获得 HTTP 响应或 Axios 同步执行失败。
   * @throws AbortError 请求被 AbortSignal 或 Axios 取消。
   */
  async request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
    if (config.signal?.aborted) throw getAbortReason(config.signal);
    const defaults = this.instance.defaults as AxiosAdapterOptions;
    const baseURL = config.baseURL ?? (defaults?.baseURL as string) ?? "";
    const url = config.url.replace(new RegExp(`^${baseURL}`, "i"), "");

    try {
      const response = await this.instance.request<T>({
        ...this.options,
        ...config,
        url,
        baseURL,
        method: config.method ?? "GET",
        params: config.params,
        data: config.data,
        headers: config.headers,
        timeout: config.timeout,
        withCredentials: config.withCredentials,
        signal: config.signal,
      });
      const normalized = normalizeResponse(response, config);
      if (normalized.status >= 400) {
        throw new HttpError(
          normalized.statusText || `HTTP ${normalized.status}`,
          normalized.status,
          normalized,
        );
      }
      return normalized;
    } catch (error) {
      throw normalizeAxiosError(error, config);
    }
  }
}

function normalizeAxiosError(error: unknown, config: RequestConfig): Error {
  if (
    error instanceof HttpError ||
    error instanceof TimeoutError ||
    error instanceof NetworkError
  ) {
    return error;
  }

  if (!isErrorLike(error)) {
    return new NetworkError("Axios request failed", { cause: error, config });
  }

  if (config.signal?.aborted || error.code === "ERR_CANCELED" || error.name === "CanceledError") {
    return getAbortReason(config.signal);
  }
  if (
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    /timeout/i.test(error.message)
  ) {
    return new TimeoutError(error.message, { cause: error, config });
  }
  if (error.response && typeof error.response.status === "number") {
    const response = normalizeResponse(error.response, config);
    return new HttpError(
      error.message || response.statusText || `HTTP ${response.status}`,
      response.status,
      response,
      { cause: error },
    );
  }
  return new NetworkError(error.message || "Axios request failed", { cause: error, config });
}

function normalizeResponse<T>(
  response: AxiosResponseLike<T>,
  config: RequestConfig,
): HttpResponse<T> {
  return {
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: normalizeHeaders(response.headers),
    config,
  };
}

function normalizeHeaders(
  headers?: AxiosHeadersLike | Record<string, unknown>,
): Record<string, string> {
  if (!headers) return {};
  const source = typeof headers.toJSON === "function" ? headers.toJSON() : headers;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value),
    ]),
  );
}

function isErrorLike(error: unknown): error is AxiosErrorLike {
  return error instanceof Error;
}
