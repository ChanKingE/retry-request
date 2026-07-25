import { HttpError, NetworkError, TimeoutError, type RequestError } from "@/error.ts";
import type { HttpMethod, RetryPolicy } from "@/types.ts";

const IDEMPOTENT_METHODS = new Set<HttpMethod>(["GET", "PUT", "DELETE"]);

/**
 * 按策略执行并重试异步操作。
 * 非幂等请求只有显式开启 retryNonIdempotent 后才会进入重试循环。
 *
 * @typeParam T - 操作成功时返回的值类型。
 * @param operation - 每次尝试时重新调用的异步操作。
 * @param policy - 重试次数、完整策略或 `undefined`。
 * @param method - 用于判断请求是否幂等的 HTTP 方法。
 * @param signal - 可选取消信号；取消时也会终止重试等待。
 * @returns 首次成功尝试的返回值。
 * @throws 最后一次失败的原始错误，或取消重试等待时的 signal reason。
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  policy: number | RetryPolicy | undefined,
  method: HttpMethod,
  signal?: AbortSignal,
): Promise<T> {
  const resolved = resolveRetryPolicy(policy);
  if (!resolved || (!IDEMPOTENT_METHODS.has(method) && !resolved.retryNonIdempotent)) {
    return operation();
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= resolved.maxRetries ||
        !resolved.retryable?.(error as RequestError, { attempt, method })
      ) {
        throw error;
      }

      const baseDelay = resolved.delay ?? 1_000;
      const delay = resolved.backoff === "exponential" ? baseDelay * 2 ** attempt : baseDelay;
      await wait(delay, signal);
    }
  }
}

/**
 * 默认的可重试错误判断函数。
 *
 * @param error - 已标准化的请求错误。
 * @returns 网络错误、超时错误、HTTP 408、429 或 5xx 时返回 `true`。
 */
export function defaultRetryable(error: RequestError): boolean {
  return (
    error instanceof NetworkError ||
    error instanceof TimeoutError ||
    (error instanceof HttpError &&
      (error.status === 408 || error.status === 429 || error.status >= 500))
  );
}

function resolveRetryPolicy(policy: number | RetryPolicy | undefined): RetryPolicy | undefined {
  if (policy === undefined) return undefined;
  const resolved = typeof policy === "number" ? { maxRetries: policy } : policy;
  return {
    ...resolved,
    maxRetries: Math.max(0, Math.floor(resolved.maxRetries)),
    retryable: resolved.retryable ?? defaultRetryable,
  };
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  if (delay <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(finish, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
