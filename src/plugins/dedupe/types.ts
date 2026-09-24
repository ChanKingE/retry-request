import type { RequestOptions, RequestPlugin } from "@/types.ts";

/** 根据最终请求配置生成去重键；返回 undefined 可跳过当前请求。 */
export type DedupeKeyGenerator = (config: RequestOptions) => string | undefined;

declare module "@/types.ts" {
  interface RequestOptionsExtensions {
    /** 单次请求的去重配置；优先级高于插件初始化参数。 */
    dedupe?: DedupePluginOptions;
  }
}

/** 重复请求合并插件配置。 */
export interface DedupePluginOptions {
  /**
   * 相同请求复用首次请求 Promise 的时间窗口，单位为毫秒。
   *
   * @remarks 可通过 `config.dedupe.windowMs` 为单次请求覆盖。
   * @defaultValue `2000`
   */
  windowMs?: number;
  /** 请求成功后继续在窗口内复用结果；默认只合并进行中的请求。@defaultValue `false` */
  cacheSettled?: boolean;
  /**
   * 自定义去重键生成器。
   *
   * @remarks 默认仅为 GET/HEAD 生成键，并包含最终地址及会影响响应的请求配置；可通过
   * `config.dedupe.createKey` 为单次请求覆盖。
   */
  createKey?: DedupeKeyGenerator;
}

/** 可通过 `client.use` 安装的重复请求合并插件。 */
export interface DedupePlugin extends RequestPlugin {}
