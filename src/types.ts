import type { RequestError } from "@/error.ts";

interface ClientMeta {
  [key: string]: unknown;
}

/**
 * 单次请求配置的业务扩展点。
 *
 * @remarks
 * 业务项目可通过 TypeScript 模块声明合并增加自定义字段，例如：
 *
 * ```ts
 * declare module "@chan98/request" {
 *   interface RequestConfigExtensions {
 *     withToken?: boolean;
 *   }
 * }
 * ```
 */
export interface RequestConfigExtensions {}

/**
 * 客户端支持的 HTTP 请求方法。
 *
 * @remarks
 * 当前只开放业务接口最常用的方法。重试模块将 `GET`、`HEAD`、`OPTIONS`、`PUT`、`DELETE`
 * 视为幂等方法；`POST` 和 `PATCH` 默认不会自动重试。
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/** 传递给自定义 `retryable` 函数的当前重试上下文。 */
export interface RetryContext {
  /**
   * 当前失败对应的重试序号，从 `0` 开始。
   *
   * @example 首次请求失败时为 `0`，第一次重试失败时为 `1`。
   */
  attempt: number;
  /** 本次请求使用的 HTTP 方法。 */
  method: HttpMethod;
}

/**
 * 单次请求的重试策略。
 *
 * @example
 * ```ts
 * const retry: RetryPolicy = {
 *   max: 3,
 *   delay: 500,
 *   backoff: "exponential",
 * };
 * ```
 */
export interface RetryPolicy {
  /**
   * 首次请求失败后允许重试的最大次数。
   *
   * @remarks 小数会向下取整，负数按 `0` 处理。
   */
  max: number;
  /**
   * 每次重试前的基础等待时间，单位为毫秒。
   *
   * @defaultValue `1000`
   */
  delay?: number;
  /**
   * 等待时间计算方式。
   *
   * - `fixed`：每次均等待 `delay`。
   * - `exponential`：依次等待 `delay * 2^attempt`。
   *
   * @defaultValue `fixed`
   */
  backoff?: "fixed" | "exponential";
  /**
   * 是否允许 `POST`、`PATCH` 等非幂等请求重试。
   *
   * @defaultValue `false`
   * @remarks 开启前应确认服务端支持幂等键，避免重复创建或重复写入。
   */
  retryNonIdempotent?: boolean;
  /**
   * 判断当前错误是否可以重试。
   *
   * @param error - 已被客户端标准化的请求错误。
   * @param context - 当前失败次数和 HTTP 方法。
   * @returns `true` 表示继续重试，`false` 表示立即抛出错误。
   * @defaultValue {@link defaultRetryable}
   */
  retryable?: (error: RequestError, context: RetryContext) => boolean;
}

/**
 * 单次请求的完整配置。
 *
 * @typeParam TBody - 查询参数类型，具体可用结构由当前适配器决定。
 * @typeParam TData - 请求体类型。
 */
export interface RequestConfig<TBody = Record<string, unknown>> extends RequestConfigExtensions {
  /** 请求地址。相对地址会与客户端的 `baseURL` 拼接。 */
  url: string;
  /**
   * 本次请求使用的基地址，仅用于相对 URL。
   *
   * @remarks
   * 优先级高于 {@link ClientOptions["baseURL"]}。传入空字符串可为本次请求关闭客户端的
   * 全局基地址；绝对 URL 和以 `//` 开头的协议相对 URL 不会拼接任何基地址。
   */
  baseURL?: string;
  /** HTTP 方法。@defaultValue `GET` */
  method?: HttpMethod;
  /** 查询参数；`undefined` 和 `null` 字段不会进入最终 URL。 */
  params?: Partial<TBody>;
  /** 请求体；普通对象由 FetchAdapter 自动序列化为 JSON。 */
  data?: Partial<TBody>;
  /** 单次请求头，同名字段覆盖客户端默认请求头。 */
  headers?: Record<string, string>;
  /** 超时时间，单位为毫秒；覆盖客户端默认值。 */
  timeout?: number;
  /**
   * 本次请求使用的重试次数或完整策略。
   *
   * @remarks
   * 数字写法等价于 `{ max: value }`，优先级高于 {@link ClientOptions['retry']}。
   * 请求级策略会整体覆盖客户端策略，不会按字段合并；传入 `0` 可关闭本次请求的全局重试。
   */
  retry?: number | RetryPolicy;
  /** 是否跨域携带 Cookie，由当前适配器映射到底层请求 API。 */
  withCredentials?: boolean;
  /**
   * 用于主动取消请求的信号。
   *
   * @remarks 信号同时传给适配器并用于中断重试等待。
   */
  signal?: AbortSignal;
  /**
   * 供拦截器和插件读写的单次请求上下文。
   *
   * @remarks 与客户端全局 meta 浅合并，并覆盖全局上下文中的同名键。
   */
  meta?: ClientMeta;
}

/**
 * 适配器返回的标准响应结构。
 *
 * @typeParam T - 响应体类型。
 * @remarks `RequestClient.request` 最终只返回 `data`，响应拦截器处理的是完整结构。
 */
export interface HttpResponse<T = unknown> {
  /** 已解析的响应体。 */
  data: T;
  /** HTTP 状态码。 */
  status: number;
  /** HTTP 状态描述。 */
  statusText: string;
  /** 标准化为字符串键值的响应头。 */
  headers: Record<string, string>;
  /** 实际发送给适配器的最终请求配置。 */
  config: RequestConfig;
}

/**
 * HTTP 底层适配器契约，可用于接入 Fetch、Axios、小程序请求 API 或测试 Mock。
 */
export interface HttpAdapter {
  /**
   * 执行一次 HTTP 请求。
   *
   * @typeParam T - 响应体类型。
   * @param config - 已合并客户端默认值并经过请求拦截器的配置。
   * @returns 包含响应体、状态、响应头及原配置的标准响应。
   * @throws 适配器可抛出原生错误，RequestClient 会在外层统一标准化。
   */
  request<T>(config: RequestConfig): Promise<HttpResponse<T>>;
  /**
   * 可选的按请求标识取消能力。
   *
   * @remarks 当前核心客户端优先使用 `AbortSignal`，不会主动调用此方法。
   */
  abort?(requestId: string): void;
}

/**
 * Promise 风格的拦截器。
 *
 * @typeParam T - 成功链中传递的值类型。
 * @typeParam E - 失败处理器接收的错误类型。
 * @remarks 返回值会传给下一个拦截器；抛出的错误会进入后续失败处理器。
 */
export interface Interceptor<T, E = unknown> {
  /** 成功处理器，可以同步或异步转换当前值。 */
  fulfilled?: (value: T) => T | Promise<T>;
  /**
   * 失败处理器；返回 `T` 可恢复链，继续抛出则保持失败状态。
   *
   * @param error - 当前失败链中的错误。
   * @param value - 失败前最近一次成功产生的 `T`；链在产生任何值前失败时为 `undefined`。
   * @returns 用于恢复拦截器链的 `T`，也可以返回 Promise。
   */
  rejected?: (error: E, value: T | undefined) => T | Promise<T>;
}

/** 直接作为成功处理器注册的函数式拦截器。 */
export type InterceptorFulfilled<T> = (value: T) => T | Promise<T>;

/** 可注册的拦截器入参，函数会被直接作为 `fulfilled` 处理。 */
export type InterceptorInput<T, E = unknown> = Interceptor<T, E> | InterceptorFulfilled<T>;

/**
 * 在进入底层适配器前尝试直接解析请求的函数。
 *
 * @param config - 已合并默认值并经过请求拦截器的最终配置。
 * @returns 标准响应表示请求已被处理；`undefined` 表示交给后续解析器或适配器。
 * @remarks Mock 等需要短路真实网络请求的插件可使用该扩展点。
 */
export type RequestResolver = (
  config: RequestConfig,
) => HttpResponse | undefined | Promise<HttpResponse | undefined>;

/** 执行当前请求链中的下一个中间件，最终进入请求解析器或底层适配器。 */
export type RequestHandler = () => Promise<HttpResponse>;

/**
 * 包裹完整请求执行过程的中间件。
 *
 * @param config - 已合并默认值并经过请求拦截器的最终配置。
 * @param next - 执行后续中间件、重试及底层请求。
 * @returns 标准响应；可以直接返回缓存中的 Promise 来合并重复请求。
 */
export type RequestMiddleware = (
  config: RequestConfig,
  next: RequestHandler,
) => Promise<HttpResponse>;

/** 创建客户端时使用的全局配置。 */
export interface ClientOptions {
  /**
   * 所有请求默认使用的基地址，仅用于相对 URL。
   *
   * @remarks 单次请求可通过 {@link RequestConfig.baseURL} 覆盖该值。
   */
  baseURL?: string;
  /** 默认超时时间，单位为毫秒。工厂函数中的默认值为 `10000`。 */
  timeout?: number;
  /**
   * 所有请求默认使用的重试次数或完整策略。
   *
   * @remarks
   * 单次请求可通过 {@link RequestConfig.retry} 整体覆盖该值；请求未提供 `retry` 时才会继承
   * 此配置。数字写法等价于 `{ max: value }`。
   */
  retry?: number | RetryPolicy;
  /** 是否默认跨域携带 Cookie。@defaultValue `false` */
  withCredentials?: boolean;
  /** 每次请求都会合并的默认请求头。 */
  headers?: Record<string, string>;
  /**
   * 提供给所有请求、拦截器和插件的全局上下文。
   *
   * @remarks 单次请求的 meta 会浅合并到该对象，并覆盖同名键。
   */
  meta?: ClientMeta;
  /** 自定义适配器。@defaultValue {@link FetchAdapter} */
  adapter?: HttpAdapter;
  /**
   * 标准业务响应解包配置。
   *
   * @remarks 设为 `false` 可关闭；省略时按 `{ code, data, message }` 和成功码 `0` 解包。
   */
  responseEnvelope?: false | ResponseEnvelopeOptions;
}

/** `{ code, data, message }` 业务响应结构的字段映射。 */
export interface ResponseEnvelopeOptions {
  /** 判定业务成功的 code。比较时双方都会转换为字符串。@defaultValue `0` */
  successCode?: string | number;
  /** 业务状态码字段名。@defaultValue `code` */
  codeKey?: string;
  /** 成功数据及错误详情字段名。@defaultValue `data` */
  dataKey?: string;
  /** 业务错误消息字段名。@defaultValue `message` */
  messageKey?: string;
}

/** 可安装到客户端并返回清理函数的扩展插件。 */
export interface RequestPlugin {
  /** 用于日志、诊断和插件识别的名称。 */
  name: string;
  /**
   * 安装插件。
   *
   * @param client - 插件可使用的最小客户端接口。
   * @returns 可选清理函数，用于卸载插件注册的拦截器或外部资源。
   */
  setup: (client: RequestClientLike) => void | (() => void);
}

/**
 * 插件可依赖的最小客户端接口。
 *
 * @remarks 使用窄接口避免插件绑定 RequestClient 的内部实现。
 */
export interface RequestClientLike {
  /**
   * 注册请求拦截器。
   *
   * @param interceptor - 插件提供的请求拦截器。
   * @returns 对应拦截器的卸载函数。
   */
  useRequestInterceptor(interceptor: InterceptorInput<RequestConfig>): () => void;
  /**
   * 注册响应拦截器。
   *
   * @param interceptor - 插件提供的响应拦截器。
   * @returns 对应拦截器的卸载函数。
   */
  useResponseInterceptor(interceptor: InterceptorInput<HttpResponse>): () => void;
  /**
   * 注册请求解析器。
   *
   * @param resolver - 可在适配器执行前直接返回响应的解析器。
   * @returns 对应解析器的卸载函数。
   */
  useRequestResolver(resolver: RequestResolver): () => void;
  /**
   * 注册包裹完整请求执行过程的中间件。
   *
   * @param middleware - 可复用或短路后续请求执行的中间件。
   * @returns 对应中间件的卸载函数。
   */
  useRequestMiddleware(middleware: RequestMiddleware): () => void;
}
