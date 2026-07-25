import { HttpError, NetworkError, TimeoutError } from "../error.ts";
import { resolveURL } from "../helpers.ts";
import type { HttpAdapter, HttpMethod, HttpResponse, RequestConfig } from "../types.ts";

/** `uni.request` 成功回调的最小兼容结果。 */
export interface UniRequestSuccessResult<T = unknown> {
  /** 服务端返回的数据。 */
  data: T;
  /** HTTP 状态码。 */
  statusCode: number;
  /** HTTP 响应头。 */
  header?: Record<string, unknown>;
  /** 服务端返回的 Cookie 列表。 */
  cookies?: string[];
}

/** `uni.request` 失败回调的最小兼容结果。 */
export interface UniRequestFailResult {
  /** UniApp 提供的错误消息。 */
  errMsg?: string;
  /** 部分平台提供的错误码。 */
  errno?: string | number;
  /** 允许不同平台携带额外错误信息。 */
  [key: string]: unknown;
}

/** 适配器依赖的最小 `RequestTask` 接口。 */
export interface UniRequestTask {
  /** 中断当前网络请求。 */
  abort(): void;
}

/** 传递给 `uni.request` 的最小兼容配置。 */
export interface UniRequestOptions {
  url: string;
  baseURL?: string;
  data?: unknown;
  header?: Record<string, string>;
  method?: HttpMethod;
  timeout?: number;
  dataType?: string;
  responseType?: "text" | "arraybuffer";
  sslVerify?: boolean;
  withCredentials?: boolean;
  success(result: UniRequestSuccessResult): void;
  fail(result: UniRequestFailResult): void;
}

/** 可注入到适配器的 `uni.request` 函数签名。 */
export type UniRequest = (options: UniRequestOptions) => UniRequestTask;

/** UniApp 适配器配置。 */
export interface UniAppAdapterOptions {
  /**
   * 自定义 `uni.request` 实现。
   *
   * @defaultValue 当前运行环境中的 `globalThis.uni.request`
   */
  request?: UniRequest;
  /**
   * 透传给每次 `uni.request` 的平台专属选项。
   *
   * @remarks `url`、`data`、`header`、`method`、`timeout`、回调等受控字段会被适配器覆盖。
   */
  requestOptions?: Record<string, unknown>;
  /** UniApp 响应数据解析类型。@defaultValue `json` */
  dataType?: string;
  /** UniApp 响应数据类型。@defaultValue `text` */
  responseType?: "text" | "arraybuffer";
  /** 是否验证 SSL 证书；具体平台支持情况由 UniApp 决定。 */
  sslVerify?: boolean;
}

/**
 * 使用 `uni.request` 实现的 HTTP 适配器。
 *
 * @remarks
 * 查询参数统一追加到 URL，请求体传给 `uni.request` 的 `data`。适配器使用回调模式以获取
 * `RequestTask`，从而将 `AbortSignal` 和超时同步到 `RequestTask.abort()`。
 *
 * @example
 * ```ts
 * const client = createHttpClient({
 *   adapter: new UniAppAdapter(),
 * });
 * ```
 */
export class UniAppAdapter implements HttpAdapter {
  readonly #request?: UniRequest;
  readonly #options: Omit<UniAppAdapterOptions, "request">;

  /**
   * 创建 UniApp 请求适配器。
   *
   * @param options - 可注入的 request 函数及 UniApp 默认响应配置。
   */
  constructor(options: UniAppAdapterOptions = {}) {
    const { request, ...requestOptions } = options;
    this.#request = request;
    this.#options = requestOptions;
  }

  /**
   * 使用 `uni.request` 执行一次请求。
   *
   * @typeParam T - 期望的响应体类型。
   * @param config - 已完成客户端默认值合并和请求拦截的配置。
   * @returns 标准化的完整 HTTP 响应。
   * @throws {@link HttpError} HTTP 状态码大于等于 400。
   * @throws {@link TimeoutError} UniApp 报告超时或本地超时计时器触发。
   * @throws {@link NetworkError} `uni.request` 不可用或进入失败回调。
   * @throws AbortError 外部 AbortSignal 主动取消请求。
   */
  request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
    const request = this.#request ?? resolveGlobalRequest();
    if (!request) {
      return Promise.reject(new NetworkError("uni.request is not available", { config }));
    }
    if (config.signal?.aborted) return Promise.reject(getAbortReason(config.signal));

    return new Promise((resolve, reject) => {
      let task: UniRequestTask | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let abortRequested = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        config.signal?.removeEventListener("abort", abortFromSignal);
      };
      const resolveOnce = (response: HttpResponse<T>) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abortFromSignal = () => {
        abortRequested = true;
        task?.abort();
        rejectOnce(getAbortReason(config.signal));
      };

      config.signal?.addEventListener("abort", abortFromSignal, { once: true });

      try {
        task = request({
          ...this.#options.requestOptions,
          url: appendParams(resolveURL(config.baseURL, config.url), config.params),
          data: config.data,
          header: config.headers,
          method: config.method ?? "GET",
          timeout: config.timeout,
          dataType: this.#options.dataType ?? "json",
          responseType: this.#options.responseType ?? "text",
          sslVerify: this.#options.sslVerify,
          withCredentials: config.withCredentials,
          success: (result) => {
            const response: HttpResponse<T> = {
              data: result.data as T,
              status: result.statusCode,
              statusText: getStatusText(result.statusCode),
              headers: normalizeHeaders(result.header),
              config,
            };
            if (result.statusCode >= 400) {
              rejectOnce(
                new HttpError(
                  response.statusText || `HTTP ${result.statusCode}`,
                  result.statusCode,
                  response,
                ),
              );
              return;
            }
            resolveOnce(response);
          },
          fail: (result) => {
            const message = result.errMsg ?? "uni.request failed";
            if (/timeout/i.test(message)) {
              rejectOnce(new TimeoutError(message, { cause: result, config }));
              return;
            }
            rejectOnce(new NetworkError(message, { cause: result, config }));
          },
        });

        if (abortRequested) task.abort();
        if (config.timeout !== undefined && config.timeout > 0 && !settled) {
          timer = setTimeout(() => {
            task?.abort();
            rejectOnce(new TimeoutError(undefined, { config }));
          }, config.timeout);
        }
      } catch (error) {
        rejectOnce(new NetworkError("uni.request failed", { cause: error, config }));
      }
    });
  }
}

function resolveGlobalRequest(): UniRequest | undefined {
  const runtime = globalThis as typeof globalThis & {
    uni?: { request?: UniRequest };
  };
  const request = runtime.uni?.request;
  return request?.bind(runtime.uni);
}

function appendParams(url: string, params: unknown): string {
  if (params === undefined || params === null) return url;
  if (typeof params !== "object") {
    throw new TypeError("Request params must be an object");
  }

  const entries: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  if (entries.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${entries.join("&")}`;
}

function normalizeHeaders(headers?: Record<string, unknown>): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function getAbortReason(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    408: "Request Timeout",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return statusTexts[status] ?? "";
}
