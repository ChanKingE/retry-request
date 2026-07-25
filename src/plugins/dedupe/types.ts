import type { RequestConfig, RequestPlugin } from "../../types.ts";

/** 根据最终请求配置生成去重键；返回 undefined 可跳过当前请求。 */
export type DedupeKeyGenerator = (config: RequestConfig) => string | undefined;

/** 重复请求合并插件配置。 */
export interface DedupePluginOptions {
  /**
   * 相同请求复用首次请求 Promise 的时间窗口，单位为毫秒。
   *
   * @defaultValue `2000`
   */
  windowMs?: number;
  /**
   * 自定义去重键生成器。
   *
   * @remarks 默认键包含 HTTP 方法、合并 baseURL 后的地址、params 和 data。
   */
  createKey?: DedupeKeyGenerator;
}

/** 可通过 `client.use` 安装的重复请求合并插件。 */
export interface DedupePlugin extends RequestPlugin {}
