import { HttpError, TimeoutError, isAbortError } from "@/error.ts";
import { appendQueryParams, getAbortReason } from "@/internal/request.ts";
import type { HttpAdapter, HttpResponse, RequestOptions } from "@/types.ts";

/**
 * 使用浏览器或 Node.js 原生 `fetch` 完成请求的默认适配器。
 *
 * @remarks
 * 适配器负责查询参数序列化、请求体转换、响应体解析、超时与外部取消信号合并。
 * JSON 响应按 `content-type` 解析，204/205 或空响应体返回 `undefined`。
 *
 * @example
 * ```ts
 * const adapter = new FetchAdapter();
 * const response = await adapter.request<User>({
 *   url: "/api/user",
 *   method: "GET",
 * });
 * ```
 */
export class FetchAdapter implements HttpAdapter {
  /**
   * 使用原生 fetch 执行一次请求。
   *
   * @typeParam T - 期望的响应体类型。
   * @param config - 已完成默认值合并和请求拦截的配置。
   * @returns 标准化的完整 HTTP 响应。
   * @throws {@link HttpError} 响应状态不在 200-299 范围内。
   * @throws {@link TimeoutError} 内部超时控制器取消请求。
   * @throws AbortError 外部 AbortSignal 主动取消请求。
   */
  async request<T>(config: RequestOptions): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeout = config.timeout;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 用同一个内部控制器合并外部取消信号与超时取消。
    const abortFromSignal = () => controller.abort(config.signal?.reason);
    if (config.signal?.aborted) abortFromSignal();
    else config.signal?.addEventListener("abort", abortFromSignal, { once: true });

    if (timeout !== undefined && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
    }

    try {
      const headers = new Headers(config.headers);
      const method = config.method ?? "GET";
      const body =
        method === "GET" || method === "HEAD" ? undefined : createBody(config.data, headers);
      const response = await fetch(appendQueryParams(config.url, config.params), {
        method,
        headers,
        body,
        credentials: config.withCredentials ? "include" : "same-origin",
        signal: controller.signal,
      });
      const result: HttpResponse<T> = {
        data: (await readBody(response)) as T,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        config,
      };

      if (!response.ok) {
        throw new HttpError(
          response.statusText || `HTTP ${response.status}`,
          response.status,
          result,
        );
      }
      return result;
    } catch (error) {
      if (timedOut && isAbortError(error)) {
        throw new TimeoutError(undefined, { cause: error, config });
      }
      if (config.signal?.aborted) throw getAbortReason(config.signal);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      config.signal?.removeEventListener("abort", abortFromSignal);
    }
  }
}

function createBody(
  data: unknown,
  headers: Headers,
): NonNullable<Parameters<typeof fetch>[1]>["body"] {
  if (data === undefined || data === null) return undefined;
  if (
    typeof data === "string" ||
    data instanceof Blob ||
    data instanceof FormData ||
    data instanceof URLSearchParams ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data)
  ) {
    return data as NonNullable<Parameters<typeof fetch>[1]>["body"];
  }

  // 对普通对象默认使用 JSON；FormData 等原生请求体保持原样。
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(data);
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    contentType === "application/json" ||
    (contentType?.startsWith("application/") && contentType.endsWith("+json"))
  ) {
    return JSON.parse(text);
  }
  return text;
}
