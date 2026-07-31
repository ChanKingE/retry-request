import type { HttpMethod, RequestConfig, RequestPlugin } from "@/types.ts";

/** URL 匹配器：字符串精确匹配、正则匹配，或自定义同步/异步判断函数。 */
export type MockUrlMatcher =
  | string
  | RegExp
  | ((url: string, config: RequestConfig) => boolean | Promise<boolean>);

/** Mock 路由可直接返回的响应体类型。 */
export type MockResponseValue =
  | object
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

/** 根据最终请求配置动态生成 Mock 响应体的函数。 */
export type MockResponseFactory<T = MockResponseValue> = (config: RequestConfig) => T | Promise<T>;

/**
 * 可通过 `config.mock` 直接指定的 Mock 响应。
 *
 * @remarks `config.mock` 为普通对象或函数时会直接作为响应体返回；为
 * {@link MockRoute} 时会跳过路由匹配并按该路由生成响应。
 */
export type InlineMockResponse<T = MockResponseValue> = T | MockResponseFactory<T>;

/**
 * 一条 Mock 路由规则。
 *
 * @typeParam T - Mock 响应体类型。
 */
export interface MockRoute<T = MockResponseValue> {
  /** URL 匹配规则。字符串匹配针对合并 baseURL 后的完整 URL；作为 `config.mock` 使用时不参与匹配。 */
  url: MockUrlMatcher;
  /** 允许的请求方法；省略时匹配所有方法。 */
  method?: HttpMethod | readonly HttpMethod[];
  /** 静态响应体，或接收最终请求配置的响应体工厂。 */
  response: T | MockResponseFactory<T>;
  /** Mock HTTP 状态码。@defaultValue `200` */
  status?: number;
  /** Mock HTTP 状态描述。@defaultValue 成功状态为 `OK`，错误状态为 `Mock Error` */
  statusText?: string;
  /** Mock 响应头。@defaultValue `{}` */
  headers?: Record<string, string>;
  /** 当前路由额外等待时间，单位为毫秒；优先级高于插件全局 delay。 */
  delay?: number;
  /** 是否只匹配一次。@defaultValue `false` */
  once?: boolean;
}

/** 单次请求可直接指定的 Mock 配置。 */
export type MockConfig = InlineMockResponse | MockRoute;

declare module "@/types.ts" {
  interface RequestConfigExtensions {
    /** 单次请求的内联 Mock 响应或 Mock 路由；优先级高于 `meta.mock`。 */
    mock?: MockConfig;
  }
}

/** Mock 插件的创建配置。 */
export interface MockPluginOptions {
  /** 按数组顺序匹配的路由规则。 */
  routes: readonly MockRoute[];
  /** 所有路由的默认延迟，单位为毫秒。@defaultValue `0` */
  delay?: number;
}

/** Mock 插件记录的请求历史。 */
export interface MockRequestRecord {
  /** 请求发生时的 Unix 时间戳。 */
  timestamp: number;
  /** 请求的最终配置快照。 */
  config: RequestConfig;
  /** 是否命中了 Mock 路由。 */
  matched: boolean;
  /** 命中的路由；未匹配时为空。 */
  route?: MockRoute;
}

/** 带请求历史与状态重置能力的 Mock 插件。 */
export interface MockPlugin extends RequestPlugin {
  /** 当前插件实例记录的只读请求历史。 */
  readonly history: readonly MockRequestRecord[];
  /** 清空历史并恢复所有 `once` 路由。 */
  reset(): void;
}
