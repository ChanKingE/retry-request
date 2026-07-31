import { getAbortReason, resolveURL } from "@/helpers.ts";
import type { HttpResponse, RequestConfig } from "@/types.ts";
import type { DedupeKeyGenerator, DedupePlugin, DedupePluginOptions } from "./types.ts";

const DEFAULT_WINDOW_MS = 2_000;
const MAX_WINDOW_MS = 2_147_483_647;
const unsupported = Symbol("unsupported");

interface DedupeEntry {
  readonly promise: Promise<HttpResponse>;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * 创建在指定时间窗口内合并相同请求的插件。
 *
 * @param options - 去重窗口和自定义键配置。
 * @returns 可通过 `client.use` 安装的插件。
 * @remarks 默认按 HTTP 方法、完整地址、查询参数和请求体判断是否相同。
 *
 * @example
 * ```ts
 * client.use(createDedupePlugin({ windowMs: 5_000 }));
 * ```
 */
export function createDedupePlugin(options: DedupePluginOptions = {}): DedupePlugin {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  validateWindow(windowMs);
  const createKey = options.createKey ?? createDefaultDedupeKey;
  const entries = new Map<string, DedupeEntry>();

  return {
    name: "dedupe",
    setup(client) {
      const removeMiddleware = client.useRequestMiddleware((config, next) => {
        const requestOptions = resolveDedupeOptions(
          config.dedupe ?? config.meta?.dedupe,
          windowMs,
          createKey,
        );
        if (requestOptions.windowMs === 0) return next();

        const key = requestOptions.createKey(config);
        if (key === undefined) return next();

        const existing = entries.get(key);
        if (existing) return reuseResponse(existing.promise, config);

        const promise = Promise.resolve().then(next);
        const entry: DedupeEntry = {
          promise,
          timer: setTimeout(() => {
            if (entries.get(key) === entry) entries.delete(key);
          }, requestOptions.windowMs),
        };
        entries.set(key, entry);
        return promise;
      });

      return () => {
        removeMiddleware();
        for (const entry of entries.values()) clearTimeout(entry.timer);
        entries.clear();
      };
    },
  };
}

function resolveDedupeOptions(
  value: unknown,
  defaultWindowMs: number,
  defaultCreateKey: DedupeKeyGenerator,
): Required<DedupePluginOptions> {
  if (!isRecord(value)) {
    return { windowMs: defaultWindowMs, createKey: defaultCreateKey };
  }

  const requestWindowMs = value.windowMs === undefined ? defaultWindowMs : value.windowMs;
  validateWindow(requestWindowMs as number);
  return {
    windowMs: requestWindowMs as number,
    createKey:
      typeof value.createKey === "function"
        ? (value.createKey as DedupeKeyGenerator)
        : defaultCreateKey,
  };
}

/** 为常见的结构化请求参数生成稳定去重键。 */
export function createDefaultDedupeKey(config: RequestConfig): string | undefined {
  try {
    const serialized = stableSerialize([
      config.method ?? "GET",
      resolveURL(config.baseURL, config.url),
      config.params,
      config.data,
    ]);
    return serialized === unsupported ? undefined : serialized;
  } catch {
    return undefined;
  }
}

function validateWindow(windowMs: number): void {
  if (!Number.isFinite(windowMs) || windowMs < 0 || windowMs > MAX_WINDOW_MS) {
    throw new RangeError(`windowMs must be between 0 and ${MAX_WINDOW_MS}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableSerialize(
  value: unknown,
  ancestors = new Set<object>(),
): string | typeof unsupported {
  if (value === null) return "null";

  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "string":
      return `string:${JSON.stringify(value)}`;
    case "boolean":
      return `boolean:${value}`;
    case "number":
      return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
    case "bigint":
      return `bigint:${value.toString()}`;
    case "symbol":
    case "function":
      return unsupported;
  }

  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    const entries = [...value.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    );
    return stableSerialize(entries, ancestors);
  }
  if (ancestors.has(value)) return unsupported;

  ancestors.add(value);
  let result: string | typeof unsupported;
  if (Array.isArray(value)) {
    const items = value.map((item) => stableSerialize(item, ancestors));
    result = items.includes(unsupported) ? unsupported : `array:[${items.join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      result = unsupported;
    } else {
      const fields: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const serialized = stableSerialize((value as Record<string, unknown>)[key], ancestors);
        if (serialized === unsupported) {
          result = unsupported;
          ancestors.delete(value);
          return result;
        }
        fields.push(`${JSON.stringify(key)}:${serialized}`);
      }
      result = `object:{${fields.join(",")}}`;
    }
  }
  ancestors.delete(value);
  return result;
}

function reuseResponse(
  promise: Promise<HttpResponse>,
  config: RequestConfig,
): Promise<HttpResponse> {
  const response = promise.then((value) => ({ ...value, config }));
  const { signal } = config;
  if (!signal) return response;
  if (signal.aborted) return Promise.reject(getAbortReason(signal));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(getAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    response.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
