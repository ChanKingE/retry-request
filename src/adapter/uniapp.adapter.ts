import { HttpError, NetworkError, TimeoutError } from "@/error.ts";
import { getAbortReason } from "@/helpers.ts";
import type { HttpAdapter, HttpMethod, HttpResponse, RequestConfig } from "@/types.ts";

/** UniApp `uni.request` 支持的请求体数据。 */
export type UniRequestData = string | Record<string, unknown> | ArrayBuffer;

/** `uni.request` 成功回调结果。 */
export interface UniRequestSuccessResult<T = unknown> {
  /** 服务端返回的数据。 */
  data: T;
  /** HTTP 状态码。 */
  statusCode: number;
  /** HTTP 响应头。 */
  header?: unknown;
  /** 服务端返回的 Cookie 列表。 */
  cookies?: string[];
}

/** `uni.request` 通用回调结果。 */
export interface UniGeneralCallbackResult {
  /** UniApp 提供的错误消息。 */
  errMsg?: string;
  /** 部分平台提供的错误码。 */
  errno?: string | number;
  /** 允许不同平台携带额外错误信息。 */
  [key: string]: unknown;
}

/** `uni.request` 失败回调结果。 */
export type UniRequestFailResult = UniGeneralCallbackResult;

/** `uni.request` 返回的请求任务。 */
export interface UniRequestTask {
  /** 中断当前网络请求。 */
  abort(): void;
  /** 监听 HTTP Response Header 事件。 */
  onHeadersReceived?(callback: (result: unknown) => void): void;
  /** 取消监听 HTTP Response Header 事件。 */
  offHeadersReceived?(callback: (result: unknown) => void): void;
}

/** 传递给 `uni.request` 的兼容配置。 */
export interface UniRequestOptions {
  /** 资源 URL。 */
  url: string;
  /** 请求参数或请求体。 */
  data?: UniRequestData;
  /** 请求头，header 中不能设置 Referer。 */
  header?: Record<string, string>;
  /** 请求方法。 */
  method?: UniRequestMethod;
  /** 超时时间，单位为毫秒。 */
  timeout?: number;
  /** 设为 json 时，UniApp 会尝试对返回数据执行 JSON.parse。 */
  dataType?: string;
  /** 响应数据类型，常用值为 text、arraybuffer。 */
  responseType?: string;
  /** 是否验证 SSL 证书。 */
  sslVerify?: boolean;
  /** 跨域请求时是否携带凭证。 */
  withCredentials?: boolean;
  /** DNS 解析时优先使用 IPv4。 */
  firstIpv4?: boolean;
  /** 开启 HTTP/2。 */
  enableHttp2?: boolean;
  /** 开启 QUIC。 */
  enableQuic?: boolean;
  /** 开启缓存。 */
  enableCache?: boolean;
  /** 开启 HttpDNS 服务。 */
  enableHttpDNS?: boolean;
  /** HttpDNS 服务商 ID。 */
  httpDNSServiceId?: string;
  /** 开启 transfer-encoding chunked。 */
  enableChunked?: boolean;
  /** Wi-Fi 下使用移动网络发送请求。 */
  forceCellularNetwork?: boolean;
  /** 是否允许在 headers 中编辑 Cookie。 */
  enableCookie?: boolean;
  /** 是否开启云加速。 */
  cloudCache?: object | boolean;
  /** 控制当前请求是否延时至首屏内容渲染后发送。 */
  defer?: boolean;
  /** 成功回调。 */
  success?: (result: UniRequestSuccessResult) => void;
  /** 失败回调。 */
  fail?: (result: UniRequestFailResult) => void;
  /** 完成回调，成功或失败都会执行。 */
  complete?: (result: UniGeneralCallbackResult) => void;
}

/** UniApp `uni.request` 接受的方法；适配器入口仍由 RequestConfig 的 HttpMethod 约束。 */
export type UniRequestMethod = HttpMethod | "OPTIONS" | "HEAD" | "TRACE" | "CONNECT";

type ControlledUniRequestOption =
  | "url"
  | "data"
  | "header"
  | "method"
  | "timeout"
  | "withCredentials"
  | "success"
  | "fail"
  | "complete";

/** 适配器可透传给 `uni.request` 的平台专属选项。 */
export type UniRequestPlatformOptions = Omit<UniRequestOptions, ControlledUniRequestOption>;

/** 适配器实际传给 `uni.request` 的配置，受控回调由适配器保证存在。 */
export type UniResolvedRequestOptions = Omit<UniRequestOptions, "success" | "fail" | "complete"> &
  Required<Pick<UniRequestOptions, "success" | "fail" | "complete">>;

/** 可注入到适配器的 `uni.request` 函数签名。 */
export type UniRequest = (options: UniResolvedRequestOptions) => UniRequestTask;

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
   * @remarks `url`、`data`、`header`、`method`、`timeout`、凭证和回调等受控字段会被适配器覆盖。
   */
  requestOptions?: UniRequestPlatformOptions;
  /** UniApp 响应数据解析类型。@defaultValue `json` */
  dataType?: string;
  /** UniApp 响应数据类型，常用值为 `text`、`arraybuffer`。@defaultValue `text` */
  responseType?: string;
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
          url: appendParams(config.url, config.params),
          data: config.data as UniRequestData | undefined,
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
          complete: () => undefined,
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

function normalizeHeaders(headers?: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
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
