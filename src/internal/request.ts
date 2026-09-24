/**
 * 仅供请求核心与适配器共享的纯工具，避免工厂模块和客户端模块互相依赖。
 */

/**
 * 将任意 AbortSignal 原因规范为 AbortError，并保留原始原因。
 */
export function getAbortReason(signal?: AbortSignal): Error {
  const error = new Error("Request aborted", { cause: signal?.reason });
  error.name = "AbortError";
  return error;
}

/** 将相对 URL 与基地址拼接。 */
export function resolveURL(baseURL: string = "", url: string): string {
  if (!baseURL || /^(?:[a-z]+:)?\/\//i.test(url)) return url;
  return `${baseURL.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

/**
 * 将查询参数追加到 URL 的查询段，并保留 URL hash 在末尾。
 */
export function appendQueryParams(url: string, params: unknown): string {
  if (params === undefined || params === null) return url;

  const entries: string[] = [];
  const append = (key: string, value: unknown) => {
    entries.push(`${encodeQueryComponent(key)}=${encodeQueryComponent(String(value))}`);
  };

  if (typeof URLSearchParams !== "undefined" && params instanceof URLSearchParams) {
    params.forEach((value, key) => append(key, value));
  } else if (typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item) => append(key, item));
      else append(key, value);
    }
  } else {
    throw new TypeError("Request params must be an object or URLSearchParams");
  }

  const query = entries.join("&");
  if (!query) return url;

  const hashIndex = url.indexOf("#");
  const requestURL = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  return `${requestURL}${requestURL.includes("?") ? "&" : "?"}${query}${hash}`;
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
