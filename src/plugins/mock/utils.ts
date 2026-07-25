import type { RequestConfig } from "@/types.ts";

/**
 * 创建适合写入 Mock 历史的浅层请求快照。
 *
 * @param config - 当前请求配置。
 * @returns 复制 headers 和 meta 后的请求配置，避免调用方后续修改污染历史记录。
 */
export function snapshotRequestConfig(config: RequestConfig): RequestConfig {
  return {
    ...config,
    headers: { ...config.headers },
    meta: config.meta ? { ...config.meta } : undefined,
  };
}

/**
 * 等待 Mock 响应延迟，并响应请求取消信号。
 *
 * @param delay - 等待时间，单位为毫秒；小于等于 `0` 时立即完成。
 * @param signal - 可选的请求取消信号。
 * @returns 延迟完成后兑现的 Promise。
 * @throws signal 已取消或等待期间被取消时，抛出 signal 的取消原因。
 */
export function waitForMockDelay(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (delay <= 0) return Promise.resolve();

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
