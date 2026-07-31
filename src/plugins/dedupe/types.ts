import type { RequestConfig, RequestPlugin } from "@/types.ts";

/** 根据最终请求配置生成去重键；返回 undefined 可跳过当前请求。 */
export type DedupeKeyGenerator = (config: RequestConfig) => string | undefined;

declare module "@/types.ts" {
  interface RequestConfigExtensions {
    /** 单次请求的去重配置；优先级高于 `meta.dedupe`。 */
    dedupe?: DedupePluginOptions;
  }
}

/** 重复请求合并插件配置。 */
export interface DedupePluginOptions {
  /**
   * 相同请求复用首次请求 Promise 的时间窗口，单位为毫秒。
   *
   * @remarks 可通过 `config.dedupe.windowMs` 为单次请求覆盖；兼容旧的 `config.meta.dedupe.windowMs`。
   * @defaultValue `2000`
   */
  windowMs?: number;
  /**
   * 自定义去重键生成器。
   *
   * @remarks 默认键包含 HTTP 方法、合并 baseURL 后的地址、params 和 data；可通过
   * `config.dedupe.createKey` 为单次请求覆盖；兼容旧的 `config.meta.dedupe.createKey`。
   */
  createKey?: DedupeKeyGenerator;
}

/** 可通过 `client.use` 安装的重复请求合并插件。 */
export interface DedupePlugin extends RequestPlugin {}
