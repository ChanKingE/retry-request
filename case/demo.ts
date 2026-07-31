import {
  AxiosAdapter,
  BusinessError,
  FetchAdapter,
  HttpError,
  NetworkError,
  TimeoutError,
  UniAppAdapter,
  createHttpClient,
  createLoggerPlugin,
  createMockPlugin,
  createRequest,
  httpClient,
  isAbortError,
  type AxiosInstanceLike,
  type AxiosRequestConfigLike,
  type HttpAdapter,
  type RequestConfig,
  type UniRequest,
} from "../src/index.ts";

interface User {
  id: string;
  name: string;
  enabled: boolean;
}

interface CreateUserInput {
  name: string;
}

interface UpdateUserInput {
  name?: string;
  enabled?: boolean;
}

interface PageQuery {
  page: number;
  roles: string[];
}

/** 运行覆盖核心客户端、插件、错误处理和适配器的完整示例。 */
async function runDemo(): Promise<void> {
  console.log("默认客户端使用 FetchAdapter：", httpClient.adapter instanceof FetchAdapter);

  const mock = createDemoMock();
  const client = createHttpClient({
    baseURL: "https://api.example.com",
    timeout: 5_000,
    withCredentials: true,
    headers: { "x-client-version": "1.0.0" },
    meta: { application: "request-demo", environment: "local" },
  });

  const removeMock = client.use(mock);
  const removeLogger = client.use(
    createLoggerPlugin({
      logger: {
        debug: (...values) => console.log("[demo debug]", ...values),
        error: (...values) => console.error("[demo error]", ...values),
      },
    }),
  );
  const removeTrace = client.useRequestInterceptor({
    fulfilled(config) {
      return {
        ...config,
        headers: { ...config.headers, "x-trace-id": "demo-trace-id" },
        meta: { ...config.meta, intercepted: true },
      };
    },
  });
  const removeResponseObserver = client.useResponseInterceptor({
    fulfilled(response) {
      console.log(`[observer] ${response.status} ${response.config.url}`);
      return response;
    },
  });

  try {
    await demonstrateRequestMethods(client);
    await demonstrateBaseURL(client);
    await demonstrateMockMatchers(client);
    await demonstrateRetry(client);
    await demonstrateCancellation(client);
    await demonstrateErrors(client);
    await demonstrateAdapters();

    console.log(
      "Mock 请求历史：",
      mock.history.map((record) => ({
        method: record.config.method,
        url: record.config.url,
        matched: record.matched,
      })),
    );
    mock.reset();
    console.log("重置后的 Mock 请求数：", mock.history.length);
  } finally {
    removeResponseObserver();
    removeTrace();
    removeLogger();
    removeMock();
  }
}

/** 创建涵盖字符串、正则和函数 URL 匹配方式的 Mock 插件。 */
function createDemoMock(): ReturnType<typeof createMockPlugin> {
  return createMockPlugin({
    delay: 0,
    routes: [
      {
        method: "GET",
        url: "https://api.example.com/users/1",
        response: { code: 0, data: { id: "1", name: "Alice", enabled: true } },
      },
      {
        method: "GET",
        url: /^https:\/\/api\.example\.com\/users$/,
        response: (config) => ({
          code: 0,
          data: {
            items: [{ id: "1", name: "Alice", enabled: true }],
            query: config.params,
          },
        }),
      },
      {
        method: "POST",
        url: "https://api.example.com/users",
        response: (config) => ({
          code: 0,
          data: {
            id: "2",
            name: (config.data as CreateUserInput).name,
            enabled: true,
          },
        }),
        status: 201,
        headers: { "x-mock-created": "true" },
      },
      {
        method: "PUT",
        url: "https://api.example.com/users/1",
        response: (config) => ({
          code: 0,
          data: { id: "1", name: (config.data as UpdateUserInput).name, enabled: true },
        }),
      },
      {
        method: "PATCH",
        url: "https://api.example.com/users/1",
        response: (config) => ({
          code: 0,
          data: { id: "1", name: "Alice", ...(config.data as UpdateUserInput) },
        }),
      },
      {
        method: "DELETE",
        url: "https://api.example.com/users/1",
        response: { code: 0, data: { deleted: true } },
      },
      {
        method: "POST",
        url: "https://api.example.com/jobs",
        response: (config) => ({ code: 0, data: { accepted: true, payload: config.data } }),
      },
      {
        method: "GET",
        url: "https://staging.example.com/v2/users/1",
        response: { code: 0, data: { source: "request-baseURL" } },
      },
      {
        method: "GET",
        url: "/health",
        response: { code: 0, data: { healthy: true } },
      },
      {
        method: "GET",
        url: "https://external.example.com/status",
        response: { code: 0, data: { external: true } },
      },
      {
        method: ["GET", "DELETE"],
        url: (url, config) =>
          url === "https://api.example.com/features/demo" && config.meta?.feature === "demo",
        response: (config) => ({
          code: 0,
          data: { method: config.method, meta: config.meta },
        }),
      },
      {
        method: "GET",
        url: "https://api.example.com/retry",
        response: { message: "temporary unavailable" },
        status: 503,
        once: true,
      },
      {
        method: "GET",
        url: "https://api.example.com/retry",
        response: { code: 0, data: { recovered: true } },
      },
      {
        method: "GET",
        url: /^https:\/\/api\.example\.com\/slow\//,
        response: { code: 0, data: { finished: true } },
        delay: 100,
      },
      {
        method: "GET",
        url: "https://api.example.com/business-error",
        response: { code: 1001, message: "业务校验失败", data: { field: "name" } },
      },
      {
        method: "GET",
        url: "https://api.example.com/http-error",
        response: { message: "service unavailable" },
        status: 503,
      },
    ],
  });
}

/** 演示完整 request 方法以及 GET、POST、PUT、PATCH、DELETE 快捷方法。 */
async function demonstrateRequestMethods(
  client: ReturnType<typeof createHttpClient>,
): Promise<void> {
  const user = await client.get<User>("/users/1");
  const page = await client.get<{ items: User[]; query: PageQuery }, PageQuery>("/users", {
    params: {
      page: 1,
      roles: ["admin", "owner"],
    },
  });
  const created = await client.post<User, CreateUserInput>("/users", { name: "Bob" });
  const replaced = await client.put<User, UpdateUserInput>("/users/1", { name: "Carol" });
  const patched = await client.patch<User, UpdateUserInput>("/users/1", { enabled: false });
  const deleted = await client.delete<{ deleted: boolean }, { force: boolean }>("/users/1", {
    params: { force: true },
  });
  const job = await client.request<
    { accepted: boolean; payload: { name: string } },
    { dryRun?: boolean; name?: string }
  >({
    url: "/jobs",
    method: "POST",
    params: { dryRun: true },
    data: { name: "daily-report" },
    headers: { "x-job-source": "demo" },
    timeout: 2_000,
    meta: { module: "jobs" },
  });

  console.log("请求方法结果：", { user, page, created, replaced, patched, deleted, job });
}

/** 演示请求级 baseURL 优先级、空字符串关闭全局地址以及绝对 URL。 */
async function demonstrateBaseURL(client: ReturnType<typeof createHttpClient>): Promise<void> {
  const requestBase = await client.get<{ source: string }>("/users/1", {
    baseURL: "https://staging.example.com/v2",
  });
  const withoutBase = await client.get<{ healthy: boolean }>("/health", {
    baseURL: "",
  });
  const absolute = await client.get<{ external: boolean }>("https://external.example.com/status");
  console.log("baseURL 结果：", { requestBase, withoutBase, absolute });
}

/** 演示函数匹配器读取合并后的全局 meta 与请求 meta。 */
async function demonstrateMockMatchers(client: ReturnType<typeof createHttpClient>): Promise<void> {
  const result = await client.get<{ method: string; meta: Record<string, unknown> }>(
    "/features/demo",
    { meta: { feature: "demo", environment: "request" } },
  );
  console.log("函数 Mock 匹配结果：", result);
}

/** 演示幂等 GET 在首次 503 后自动重试并恢复。 */
async function demonstrateRetry(client: ReturnType<typeof createHttpClient>): Promise<void> {
  const result = await client.get<{ recovered: boolean }>("/retry", {
    retry: { max: 1, delay: 0, backoff: "fixed" },
  });
  console.log("重试结果：", result);
}

/** 演示直接 AbortSignal 和 createRequest 共享取消控制器。 */
async function demonstrateCancellation(client: ReturnType<typeof createHttpClient>): Promise<void> {
  const controller = new AbortController();
  const directRequest = client.get("/slow/direct", { signal: controller.signal });
  controller.abort();
  await reportExpectedError("AbortSignal 取消", directRequest);

  const pending = createRequest(client);
  const profile = pending.execute({ url: "/slow/profile" });
  const permissions = pending.execute({ url: "/slow/permissions" });
  pending.abort();
  const results = await Promise.allSettled([profile, permissions]);
  console.log(
    "共享取消结果：",
    results.map((result) =>
      result.status === "rejected" && isAbortError(result.reason) ? "AbortError" : result.status,
    ),
  );
}

/** 演示业务、HTTP、网络、超时以及取消错误的分类处理。 */
async function demonstrateErrors(client: ReturnType<typeof createHttpClient>): Promise<void> {
  await reportExpectedError("业务错误", client.get("/business-error"));
  await reportExpectedError("HTTP 错误", client.get("/http-error"));

  const fallbackAdapter: HttpAdapter = {
    async request<T>(config: RequestConfig) {
      return {
        data: { source: "real-adapter", url: config.url } as T,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    },
  };
  const fallbackClient = createHttpClient({ adapter: fallbackAdapter, responseEnvelope: false });
  fallbackClient.use(createMockPlugin({ routes: [] }));
  console.log("Mock 未匹配，执行适配器：", await fallbackClient.get("/not-mocked"));

  const networkAdapter: HttpAdapter = {
    async request(config: RequestConfig) {
      throw new NetworkError("演示网络不可用", { config });
    },
  };
  const networkClient = createHttpClient({ adapter: networkAdapter, responseEnvelope: false });
  await reportExpectedError("网络错误", networkClient.get("/network-error"));

  const timeoutAdapter: HttpAdapter = {
    async request(config: RequestConfig) {
      throw new TimeoutError("演示请求超时", { config });
    },
  };
  const timeoutClient = createHttpClient({ adapter: timeoutAdapter, responseEnvelope: false });
  await reportExpectedError("超时错误", timeoutClient.get("/timeout"));
}

/** 将未知错误收窄为请求包定义的标准错误类型。 */
async function reportExpectedError(label: string, request: Promise<unknown>): Promise<void> {
  try {
    await request;
  } catch (error) {
    if (error instanceof BusinessError) {
      console.log(label, { type: error.name, code: error.code, details: error.details });
    } else if (error instanceof HttpError) {
      console.log(label, { type: error.name, status: error.status });
    } else if (error instanceof TimeoutError || error instanceof NetworkError) {
      console.log(label, { type: error.name, message: error.message });
    } else if (isAbortError(error)) {
      console.log(label, { type: error.name });
    } else {
      throw error;
    }
  }
}

/** 使用本地结构化桩演示 AxiosAdapter 与 UniAppAdapter，执行时不访问网络。 */
async function demonstrateAdapters(): Promise<void> {
  const axiosInstance: AxiosInstanceLike = {
    async request<T>(config: AxiosRequestConfigLike) {
      return {
        data: { runtime: "axios", url: config.url } as T,
        status: 200,
        statusText: "OK",
        headers: { "x-adapter": "axios" },
      };
    },
  };
  const axiosClient = createHttpClient({
    adapter: new AxiosAdapter(axiosInstance, {
      requestConfig: { responseType: "json", maxRedirects: 3 },
    }),
    responseEnvelope: false,
  });
  const axiosResult = await axiosClient.get<{ runtime: string; url: string }>("/axios-demo");

  const uniRequest: UniRequest = (options) => {
    const timer = setTimeout(() => {
      options.success({
        data: { runtime: "uniapp", url: options.url },
        statusCode: 200,
        header: { "x-adapter": "uniapp" },
      });
    }, 0);
    return { abort: () => clearTimeout(timer) };
  };
  const uniClient = createHttpClient({
    baseURL: "https://uni.example.com",
    adapter: new UniAppAdapter({
      request: uniRequest,
      dataType: "json",
      responseType: "text",
      sslVerify: true,
      requestOptions: { enableHttp2: true },
    }),
    responseEnvelope: false,
  });
  const uniResult = await uniClient.get<{ runtime: string; url: string }>("/uni-demo", {
    params: { platform: "app" },
  });

  console.log("适配器结果：", { axiosResult, uniResult });
}

await runDemo();
