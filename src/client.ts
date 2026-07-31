import { HttpError, normalizeRequestError } from "@/error.ts";
import { resolveURL } from "@/helpers.ts";
import { InterceptorManager } from "@/interceptor.ts";
import { executeWithRetry } from "@/retry.ts";
import type {
  ClientOptions,
  HttpAdapter,
  HttpMethod,
  HttpResponse,
  InterceptorInput,
  RequestConfig,
  RequestHandler,
  RequestMiddleware,
  RequestPlugin,
  RequestResolver,
} from "./types.ts";
type UrlRequestConfig<TBody = unknown> = Omit<RequestConfig<TBody>, "url" | "method">;
type MethodRequestConfig<TBody = unknown> = Omit<RequestConfig<TBody>, "method">;

/**
 * 请求核心客户端，负责默认配置、拦截器、适配器、重试和错误标准化的调度。
 *
 * @remarks
 * 业务代码通常通过 {@link createHttpClient} 创建实例。直接构造时不会自动安装业务响应
 * 解包拦截器，也不会自动提供 10 秒超时默认值。
 *
 * @example
 * ```ts
 * const client = new RequestClient(new FetchAdapter(), {
 *   baseURL: "https://api.example.com",
 *   timeout: 10_000,
 * });
 * ```
 */
export class RequestClient {
  readonly #requestInterceptors = new InterceptorManager<RequestConfig>();
  readonly #responseInterceptors = new InterceptorManager<HttpResponse<unknown>>();
  readonly #requestResolvers: RequestResolver[] = [];
  readonly #requestMiddlewares: RequestMiddleware[] = [];
  readonly #pluginCleanups = new Map<RequestPlugin, () => void>();
  readonly #oncePluginCleanups = new Map<RequestPlugin, () => void>();
  readonly #defaults: ClientOptions;
  #onceConsumption?: Promise<void>;

  /**
   * 创建请求客户端。
   *
   * @param adapter - 实际执行 HTTP 请求的底层适配器。
   * @param options - 全局默认配置；单次请求中的同名配置优先级更高。
   */
  constructor(
    readonly adapter: HttpAdapter,
    defaults: ClientOptions = {},
  ) {
    this.#defaults = defaults;
  }

  /**
   * 注册请求拦截器。
   *
   * @param interceptor - 接收并可修改最终请求配置的拦截器。
   * @returns 卸载函数；卸载后该拦截器不再参与后续请求。
   */
  useRequestInterceptor(interceptor: InterceptorInput<RequestConfig>): () => void {
    return this.#requestInterceptors.use(interceptor);
  }

  /**
   * 注册响应拦截器。
   *
   * @param interceptor - 接收标准响应或请求错误的拦截器。
   * @returns 卸载函数；卸载后该拦截器不再参与后续请求。
   * @remarks `rejected` 返回有效响应时可以把失败链恢复为成功链。TODO
   */
  useResponseInterceptor<T = unknown>(interceptor: InterceptorInput<HttpResponse<T>>): () => void {
    return this.#responseInterceptors.use(interceptor as InterceptorInput<HttpResponse>);
  }

  /**
   * 注册可在适配器执行前短路请求的解析器。
   *
   * @param resolver - 返回标准响应或 `undefined` 的请求解析器。
   * @returns 幂等卸载函数。
   * @remarks 解析器按注册顺序执行，第一个返回响应的解析器终止后续查找。
   */
  useRequestResolver(resolver: RequestResolver): () => void {
    this.#requestResolvers.push(resolver);
    return () => {
      const index = this.#requestResolvers.indexOf(resolver);
      if (index >= 0) this.#requestResolvers.splice(index, 1);
    };
  }

  /**
   * 注册包裹完整请求过程的中间件。
   *
   * @param middleware - 可在调用 next 前后复用、缓存或转换请求结果的中间件。
   * @returns 幂等卸载函数。
   * @remarks 中间件按注册顺序从外到内执行，响应拦截器仍会为每个调用单独运行。
   */
  useRequestMiddleware(middleware: RequestMiddleware): () => void {
    this.#requestMiddlewares.push(middleware);
    return () => {
      const index = this.#requestMiddlewares.indexOf(middleware);
      if (index >= 0) this.#requestMiddlewares.splice(index, 1);
    };
  }

  /**
   * 安装请求插件。
   *
   * @param plugin - 实现 `setup` 的插件对象。
   * @returns 插件清理函数。
   * @remarks 重复安装同一个对象引用时不会重复执行 setup，而是返回已有清理函数。
   */
  use(plugin: RequestPlugin): () => void {
    const existingCleanup = this.#pluginCleanups.get(plugin);
    if (existingCleanup) return existingCleanup;

    const teardown = plugin.setup(this) ?? (() => undefined);
    const cleanup = () => {
      teardown();
      this.#pluginCleanups.delete(plugin);
    };
    this.#pluginCleanups.set(plugin, cleanup);
    return cleanup;
  }

  /**
   * 安装仅供下一次请求使用的插件。
   *
   * @param plugin - 实现 `setup` 的插件对象，安装规则与 {@link use} 相同。
   * @returns 幂等清理函数；可在插件被消费前主动取消注册。
   * @remarks
   * 插件会参与下一次请求的完整生命周期，并在请求成功或失败后自动卸载。并发请求会等待
   * 该次消费完成，避免同一个一次性插件被多个请求重复使用。
   */
  once(plugin: RequestPlugin): () => void {
    const existingCleanup = this.#oncePluginCleanups.get(plugin);
    if (existingCleanup) return existingCleanup;

    const removePlugin = this.use(plugin);
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      this.#oncePluginCleanups.delete(plugin);
      removePlugin();
    };
    this.#oncePluginCleanups.set(plugin, cleanup);
    return cleanup;
  }

  /**
   * 使用完整配置发起请求。
   *
   * @typeParam T - 调用方最终获得的响应数据类型。
   * @typeParam TBody - 查询参数或请求体类型。
   * @param config - 单次请求配置。
   * @returns 经过响应拦截器处理后的 `response.data`。
   * @throws {@link NetworkError} 网络或其他未知传输错误。
   * @throws {@link TimeoutError} 请求超时。
   * @throws {@link HttpError} HTTP 状态码大于等于 400。
   * @throws {@link BusinessError} 已安装的业务响应拦截器判定业务失败。
   * @remarks 主动取消产生的 `AbortError` 保持原样，不会转换为 NetworkError。
   */
  async request<T, TBody = unknown>(config: RequestConfig<TBody>): Promise<T> {
    while (this.#onceConsumption) await this.#onceConsumption;

    const onceCleanups = [...this.#oncePluginCleanups.values()];
    let finishOnceConsumption: (() => void) | undefined;
    if (onceCleanups.length > 0) {
      this.#oncePluginCleanups.clear();
      this.#onceConsumption = new Promise((resolve) => {
        finishOnceConsumption = resolve;
      });
    }

    const initialConfig = this.#applyDefaults(config);

    try {
      const interceptedConfig = await this.#requestInterceptors.run(initialConfig);
      const finalConfig = {
        ...interceptedConfig,
        url: resolveURL(interceptedConfig.baseURL, interceptedConfig.url),
      };

      const responsePromise = this.#runRequestMiddlewares(finalConfig, () =>
        // 每次失败先标准化错误，再由重试策略判断是否可恢复。
        executeWithRetry(
          async () => {
            try {
              const response =
                (await this.#resolveRequest(finalConfig)) ??
                (await this.adapter.request<T>(finalConfig));
              if (response.status >= 400) {
                throw new HttpError(
                  response.statusText || `HTTP ${response.status}`,
                  response.status,
                  response,
                );
              }
              return response as HttpResponse;
            } catch (error) {
              throw normalizeRequestError(error, finalConfig);
            }
          },
          finalConfig.retry,
          finalConfig.method ?? "GET",
          finalConfig.signal,
        ),
      );

      const response = await this.#responseInterceptors.run(responsePromise);

      return response.data as T;
    } catch (error) {
      if (error instanceof Error) throw normalizeRequestError(error, initialConfig);
      throw error;
    } finally {
      try {
        for (const cleanup of onceCleanups) cleanup();
      } finally {
        if (finishOnceConsumption) {
          this.#onceConsumption = undefined;
          finishOnceConsumption();
        }
      }
    }
  }

  /**
   * 发起 GET 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TParams - 查询参数类型。
   * @param url - 请求地址。
   * @param config - 除 URL 和方法外的配置覆盖项；查询参数通过 `config.params` 传入。
   * @returns 响应数据。
   */
  get<T, TParams = unknown>(config: MethodRequestConfig<TParams>): Promise<T>;
  get<T, TParams = unknown>(url: string, config?: UrlRequestConfig<TParams>): Promise<T>;
  get<T, TParams = unknown>(
    urlOrConfig: string | MethodRequestConfig<TParams>,
    config?: UrlRequestConfig<TParams>,
  ): Promise<T> {
    return this.request<T, TParams>(normalizeUrlMethodRequest("GET", urlOrConfig, config));
  }

  /**
   * 发起 DELETE 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TParams - 查询参数类型。
   * @param url - 请求地址。
   * @param config - 除 URL 和方法外的配置覆盖项；查询参数通过 `config.params` 传入。
   * @returns 响应数据。
   */
  delete<T, TParams = unknown>(config: MethodRequestConfig<TParams>): Promise<T>;
  delete<T, TParams = unknown>(url: string, config?: UrlRequestConfig<TParams>): Promise<T>;
  delete<T, TParams = unknown>(
    urlOrConfig: string | MethodRequestConfig<TParams>,
    config?: UrlRequestConfig<TParams>,
  ): Promise<T> {
    return this.request<T, TParams>(normalizeUrlMethodRequest("DELETE", urlOrConfig, config));
  }

  /**
   * 发起 HEAD 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TParams - 查询参数类型。
   * @param url - 请求地址。
   * @param config - 除 URL 和方法外的配置覆盖项；查询参数通过 `config.params` 传入。
   * @returns 响应数据。
   */
  head<T, TParams = unknown>(config: MethodRequestConfig<TParams>): Promise<T>;
  head<T, TParams = unknown>(url: string, config?: UrlRequestConfig<TParams>): Promise<T>;
  head<T, TParams = unknown>(
    urlOrConfig: string | MethodRequestConfig<TParams>,
    config?: UrlRequestConfig<TParams>,
  ): Promise<T> {
    return this.request<T, TParams>(normalizeUrlMethodRequest("HEAD", urlOrConfig, config));
  }

  /**
   * 发起 OPTIONS 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TParams - 查询参数类型。
   * @param url - 请求地址。
   * @param config - 除 URL 和方法外的配置覆盖项；查询参数通过 `config.params` 传入。
   * @returns 响应数据。
   */
  options<T, TParams = unknown>(config: MethodRequestConfig<TParams>): Promise<T>;
  options<T, TParams = unknown>(url: string, config?: UrlRequestConfig<TParams>): Promise<T>;
  options<T, TParams = unknown>(
    urlOrConfig: string | MethodRequestConfig<TParams>,
    config?: UrlRequestConfig<TParams>,
  ): Promise<T> {
    return this.request<T, TParams>(normalizeUrlMethodRequest("OPTIONS", urlOrConfig, config));
  }

  /**
   * 发起 POST 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TData - 请求体类型。
   * @param url - 请求地址。
   * @param data - 请求体。
   * @param config - 其他单次请求配置。
   * @returns 响应数据。
   * @remarks POST 默认不会重试，除非策略显式设置 `retryNonIdempotent: true`。
   */
  post<T, TData = unknown>(config: MethodRequestConfig<TData>): Promise<T>;
  post<T, TData = unknown>(url: string, data?: TData, config?: UrlRequestConfig<TData>): Promise<T>;
  post<T, TData = unknown>(
    urlOrConfig: string | MethodRequestConfig<TData>,
    data?: TData,
    config?: UrlRequestConfig<TData>,
  ): Promise<T> {
    return this.request<T, TData>(normalizeDataMethodRequest("POST", urlOrConfig, data, config));
  }

  /**
   * 发起 PUT 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TData - 请求体类型。
   * @param url - 请求地址。
   * @param data - 请求体。
   * @param config - 其他单次请求配置。
   * @returns 响应数据。
   */
  put<T, TData = unknown>(config: MethodRequestConfig<TData>): Promise<T>;
  put<T, TData = unknown>(url: string, data?: TData, config?: UrlRequestConfig<TData>): Promise<T>;
  put<T, TData = unknown>(
    urlOrConfig: string | MethodRequestConfig<TData>,
    data?: TData,
    config?: UrlRequestConfig<TData>,
  ): Promise<T> {
    return this.request<T, TData>(normalizeDataMethodRequest("PUT", urlOrConfig, data, config));
  }

  /**
   * 发起 PATCH 请求。
   *
   * @typeParam T - 响应数据类型。
   * @typeParam TData - 请求体类型。
   * @param url - 请求地址。
   * @param data - 请求体。
   * @param config - 其他单次请求配置。
   * @returns 响应数据。
   * @remarks PATCH 默认不会重试，除非策略显式设置 `retryNonIdempotent: true`。
   */
  patch<T, TData = unknown>(config: MethodRequestConfig<TData>): Promise<T>;
  patch<T, TData = unknown>(
    url: string,
    data?: TData,
    config?: UrlRequestConfig<TData>,
  ): Promise<T>;
  patch<T, TData = unknown>(
    urlOrConfig: string | MethodRequestConfig<TData>,
    data?: TData,
    config?: UrlRequestConfig<TData>,
  ): Promise<T> {
    return this.request<T, TData>(normalizeDataMethodRequest("PATCH", urlOrConfig, data, config));
  }

  #applyDefaults<TBody>(config: RequestConfig<TBody>): RequestConfig {
    const baseURL = config.baseURL ?? this.#defaults.baseURL;
    const timeout = config.timeout ?? this.#defaults.timeout;
    const retry = config.retry ?? this.#defaults.retry;
    const withCredentials = config.withCredentials ?? this.#defaults.withCredentials;
    const headers = { ...this.#defaults.headers, ...config.headers };
    const meta = { ...this.#defaults.meta, ...config.meta };

    return {
      ...config,
      baseURL,
      url: config.url,
      method: normalizeMethod(config.method),
      timeout,
      retry,
      withCredentials,
      headers,
      meta,
    };
  }

  async #resolveRequest(config: RequestConfig): Promise<HttpResponse | undefined> {
    for (const resolver of this.#requestResolvers) {
      const response = await resolver(config);
      if (response !== undefined) return response;
    }
    return undefined;
  }

  #runRequestMiddlewares(config: RequestConfig, handler: RequestHandler): Promise<HttpResponse> {
    const middlewares = [...this.#requestMiddlewares];
    const dispatch = (index: number): Promise<HttpResponse> => {
      const middleware = middlewares[index];
      return middleware ? middleware(config, () => dispatch(index + 1)) : handler();
    };
    return dispatch(0);
  }
}

function normalizeMethod(method?: HttpMethod): HttpMethod {
  return method ?? "GET";
}

function normalizeUrlMethodRequest<TBody>(
  method: HttpMethod,
  urlOrConfig: string | MethodRequestConfig<TBody>,
  config?: UrlRequestConfig<TBody>,
): RequestConfig<TBody> {
  if (typeof urlOrConfig !== "string") return { ...urlOrConfig, method };
  return { ...config, url: urlOrConfig, method };
}

function normalizeDataMethodRequest<TBody>(
  method: HttpMethod,
  urlOrConfig: string | MethodRequestConfig<TBody>,
  data?: TBody,
  config?: UrlRequestConfig<TBody>,
): RequestConfig<TBody> {
  if (typeof urlOrConfig !== "string") return { ...urlOrConfig, method };
  return { ...config, url: urlOrConfig, method, data };
}
