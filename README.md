# request

一个面向 TypeScript 应用的请求封装包。它通过“适配器 + 客户端 + 拦截器 + 插件”分离底层
HTTP 实现与业务调用，并统一处理超时、重试、取消和错误类型。

## 特性

- `request`、`get`、`post`、`put`、`patch`、`delete` 统一 API
- 请求参数、请求体和响应数据的泛型约束
- 默认使用原生 `fetch`，支持注入自定义 `HttpAdapter`
- 请求和响应拦截器按注册顺序执行，并支持卸载
- 统一的网络、超时、HTTP、业务错误
- 幂等请求重试、固定或指数退避
- 基于 `AbortController` 的请求取消
- 可清理的插件生命周期，以及内置请求去重、日志、Mock 插件
- 默认解包 `{ code, data, message }` 业务响应

## 快速开始

```ts
import { httpClient } from "request";

interface User {
  id: string;
  name: string;
}

const user = await httpClient.get<User>("/api/users/1");
```

默认客户端使用 `FetchAdapter`，超时时间为 10 秒。对于包含 `code` 字段的响应，`code === 0`
时返回 `data`，否则抛出 `BusinessError`；不包含 `code` 的普通响应保持原样。

## 创建客户端

```ts
import { createHttpClient } from "request";

const client = createHttpClient({
  baseURL: "https://api.example.com",
  timeout: 5_000,
  retry: { max: 2, delay: 500 },
  withCredentials: true,
  headers: {
    "x-client-version": "1.0.0",
  },
  meta: {
    application: "admin",
  },
});
```

| 配置               | 类型                               | 默认值         | 说明                   |
| ------------------ | ---------------------------------- | -------------- | ---------------------- |
| `baseURL`          | `string`                           | 无             | 相对 URL 的请求基地址  |
| `timeout`          | `number`                           | `10000`        | 超时时间，单位为毫秒   |
| `retry`            | `number \| RetryPolicy`            | 无             | 默认重试次数或策略     |
| `withCredentials`  | `boolean`                          | `false`        | 是否跨域携带 Cookie    |
| `headers`          | `Record<string, string>`           | `{}`           | 默认请求头             |
| `meta`             | `Record<string, unknown>`          | 无             | 全局插件与拦截器上下文 |
| `adapter`          | `HttpAdapter`                      | `FetchAdapter` | 自定义底层请求适配器   |
| `responseEnvelope` | `false \| ResponseEnvelopeOptions` | 标准字段映射   | 业务响应解包配置       |

单次请求也可以通过 `baseURL` 覆盖客户端的全局基地址；传入空字符串可仅为该请求关闭
全局基地址。绝对 URL 不会与任何 `baseURL` 拼接。

```ts
await client.get("/users", undefined, {
  baseURL: "https://staging-api.example.com",
});

await client.get("/health", undefined, { baseURL: "" });
```

关闭自动业务响应解包：

```ts
const client = createHttpClient({ responseEnvelope: false });
```

后端字段名不同时可自定义映射：

```ts
const client = createHttpClient({
  responseEnvelope: {
    successCode: "SUCCESS",
    codeKey: "status",
    dataKey: "result",
    messageKey: "errorMessage",
  },
});
```

## 请求方法

```ts
// GET 查询参数会被追加到 URL；数组会生成同名的多个参数。
const users = await client.get<User[], { page: number; role: string[] }>("/users", {
  page: 1,
  role: ["admin", "owner"],
});

const created = await client.post<User, CreateUserInput>("/users", {
  name: "Alice",
});

const updated = await client.put<User, UpdateUserInput>("/users/1", {
  name: "Bob",
});

await client.patch("/users/1", { enabled: true });

await client.delete("/users/1", {
  params: { force: true },
});
```

需要完整控制时使用 `request`：

```ts
const result = await client.request<Result, Query, Payload>({
  url: "/jobs",
  method: "POST",
  params: { dryRun: true },
  data: { name: "daily-report" },
  headers: { "x-trace-id": traceId },
  timeout: 30_000,
  meta: { source: "scheduler" },
});
```

普通对象请求体会自动序列化为 JSON 并设置 `content-type: application/json`。字符串、`Blob`、
`FormData`、`URLSearchParams`、`ArrayBuffer` 和 TypedArray 会作为原生请求体传递。

客户端全局 `meta` 会与单次请求的 `meta` 浅合并，同名键以单次请求为准：

```ts
const client = createHttpClient({
  meta: { application: "admin", source: "global" },
});

await client.get("/users", undefined, {
  meta: { requestId: "req-1", source: "page" },
});

// 最终 meta：
// { application: "admin", requestId: "req-1", source: "page" }
```

## 扩展请求配置

业务项目需要给 `RequestConfig` 增加字段时，扩展 `RequestConfigExtensions` 即可。扩展后的字段会
出现在 `request`、`get`、`post` 等单次请求配置、请求拦截器、插件和适配器接收到的最终
`config` 中。

```ts
declare module "@chan98/request" {
  interface RequestConfigExtensions {
    withToken?: boolean;
  }
}

client.useRequestInterceptor({
  fulfilled(config) {
    if (config.withToken === false) return config;
    return {
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${getToken()}`,
      },
    };
  },
});

await client.get("/public-profile", undefined, { withToken: false });
```

## 拦截器

```ts
const removeAuth = client.useRequestInterceptor({
  async fulfilled(config) {
    const token = await getToken();
    return {
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${token}`,
      },
    };
  },
});

const removeReporter = client.useResponseInterceptor({
  fulfilled(response) {
    reportSuccess(response.config.url);
    return response;
  },
  rejected(error, latestResponse) {
    reportError(error);
    // 请求已经产生过响应时，可从 latestResponse 读取最近一次成功值。
    console.log(latestResponse?.config.url);
    throw error;
  },
});

// 不再需要时卸载，避免重复注册。
removeAuth();
removeReporter();
```

拦截器按注册顺序组成 Promise 链。`fulfilled` 的返回值会传给下一个成功处理器，抛出的错误会
进入后续 `rejected(error, latestValue)` 处理器；第二个参数是失败前最近一次成功值，如果请求
尚未产生任何值便失败则为 `undefined`。`rejected` 可以返回标准值来恢复请求链。

## 重试

客户端可配置全局重试策略，单次请求未提供 `retry` 时会自动继承：

```ts
const client = createHttpClient({
  retry: { max: 2, delay: 500, backoff: "exponential" },
});
```

单次请求的 `retry` 会整体覆盖全局策略；传入 `0` 可关闭该请求的全局重试：

```ts
import { TimeoutError } from "request";

await client.get("/reports", undefined, {
  retry: {
    max: 3,
    delay: 500,
    backoff: "exponential",
    retryable: (error) => error instanceof TimeoutError,
  },
});

await client.get("/reports/preview", undefined, { retry: 0 });
```

默认重试网络错误、超时、HTTP `408`、`429` 和 `5xx`。重试只对 `GET`、`PUT`、`DELETE`
生效；如确实需要重试 `POST` 或 `PATCH`，必须显式设置 `retryNonIdempotent: true`。

## 取消请求

可直接传入 `AbortSignal`：

```ts
const controller = new AbortController();
const request = client.get("/slow", undefined, { signal: controller.signal });

controller.abort();
await request;
```

也可以使用共享控制器辅助函数：

```ts
import { createRequest } from "request";

const pending = createRequest(client);
const profile = pending.execute<User>({ url: "/profile" });
const permissions = pending.execute<string[]>({ url: "/permissions" });

// 同时取消以上请求。
pending.abort();
```

主动取消会保留原始 `AbortError`，调用方可通过 `error.name === "AbortError"` 判断。

## 错误处理

```ts
import { BusinessError, HttpError, NetworkError, TimeoutError } from "request";

try {
  await client.get("/profile");
} catch (error) {
  if (error instanceof BusinessError) {
    console.error(error.code, error.details);
  } else if (error instanceof HttpError) {
    console.error(error.status, error.response);
  } else if (error instanceof TimeoutError) {
    console.error("请求超时");
  } else if (error instanceof NetworkError) {
    console.error("网络不可用");
  }
}
```

| 错误类          | 触发条件                       | 主要字段             |
| --------------- | ------------------------------ | -------------------- |
| `NetworkError`  | 无响应、DNS、CORS 等传输层失败 | `message`、`config`  |
| `TimeoutError`  | 请求超过 `timeout`             | `message`、`config`  |
| `HttpError`     | HTTP 状态码大于等于 400        | `status`、`response` |
| `BusinessError` | 业务 code 不等于成功值         | `code`、`details`    |

## Axios 适配器

Axios 使用者先在应用中安装 `axios`，再把 `axios.create()` 返回的实例交给 `AxiosAdapter`：

```ts
import axios from "axios";
import { AxiosAdapter, createHttpClient } from "request";

const axiosInstance = axios.create({
  baseURL: "https://api.example.com",
});

axiosInstance.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const client = createHttpClient({
  adapter: new AxiosAdapter(axiosInstance),
});
```

请求包不会静态导入或强制安装 Axios。`AxiosAdapter` 使用结构化类型，因此 Axios 实例已有的
`defaults`、请求/响应拦截器、代理和自定义 transport 配置都会继续生效。

需要为每次 Axios 请求传入额外配置时，可以使用 `requestConfig`：

```ts
const adapter = new AxiosAdapter(axiosInstance, {
  requestConfig: {
    responseType: "arraybuffer",
    maxRedirects: 3,
  },
});
```

`requestConfig` 会先合并，随后由统一请求配置覆盖 `url`、`method`、`params`、`data`、
`headers`、`timeout`、`withCredentials` 和 `signal`。

Axios 响应会转换为标准 `HttpResponse`。Axios 的 HTTP 响应错误、`ECONNABORTED`/
`ETIMEDOUT`、无响应错误和 `ERR_CANCELED` 分别转换为 `HttpError`、`TimeoutError`、
`NetworkError` 和 `AbortError`。具体底层配置见
[Axios 请求配置](https://axios-http.com/docs/req_config)。

## UniApp 适配器

UniApp 项目可以使用 `UniAppAdapter` 将客户端切换到 `uni.request`：

```ts
import { UniAppAdapter, createHttpClient } from "request";

const client = createHttpClient({
  baseURL: "https://api.example.com",
  adapter: new UniAppAdapter(),
});

const user = await client.get<User>("/users/1");
```

适配器默认读取当前运行环境的 `globalThis.uni.request`，因此包本身不依赖完整的 UniApp 类型包。
测试、SSR 初始化或封装运行时也可以显式注入请求函数：

```ts
const adapter = new UniAppAdapter({
  request: uni.request,
  dataType: "json",
  responseType: "text",
  sslVerify: true,
  requestOptions: {
    enableHttp2: true,
    firstIpv4: true,
  },
});
```

| 配置             | 默认值                   | 说明                                           |
| ---------------- | ------------------------ | ---------------------------------------------- |
| `request`        | `globalThis.uni.request` | 自定义 UniApp 请求函数，便于测试或运行时注入   |
| `dataType`       | `json`                   | UniApp 的响应解析类型                          |
| `responseType`   | `text`                   | 响应数据类型，可设为 `arraybuffer`             |
| `sslVerify`      | 平台默认值               | 是否验证 SSL 证书，支持范围由目标平台决定      |
| `requestOptions` | `{}`                     | 透传 `enableHttp2`、`firstIpv4` 等平台专属选项 |

行为说明：

- `params` 会统一编码并追加到 URL，数组生成多个同名参数。
- `data` 原样传给 `uni.request`，由 UniApp 根据请求头和平台规则序列化。
- `headers` 映射到 UniApp 的 `header`，`withCredentials` 直接传递给底层 API。
- 成功回调的 `statusCode/header/data` 会转换为标准 `HttpResponse`。
- HTTP 4xx/5xx、网络失败和超时分别转换为 `HttpError`、`NetworkError`、`TimeoutError`。
- `AbortSignal` 取消或本地超时会调用 `RequestTask.abort()`。

不同小程序平台支持的 HTTP 方法和扩展选项并不完全一致，使用前还需按目标平台配置网络域名
白名单。具体兼容性见 [uni.request 官方文档](https://uniapp.dcloud.net.cn/api/request/request.html)。

## 自定义适配器

```ts
import { createHttpClient, type HttpAdapter } from "request";

const adapter: HttpAdapter = {
  async request<T>(config) {
    // 在这里接入 Axios、小程序请求 API 或测试 Mock。
    return {
      data: {} as T,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  },
};

const client = createHttpClient({ adapter });
```

适配器应遵守 `config.signal`，并返回标准 `HttpResponse`。核心客户端会再次检查 HTTP 状态并
标准化适配器抛出的未知错误。

## 插件

内置插件的初始化参数都可被单次请求配置覆盖。优先级固定为：
`config.[插件名]` > `config.meta.[插件名]` > `createXxxPlugin(options)` > 插件默认值。当前内置插件
支持 `config.dedupe`、`config.mock` 和 `config.logger`，并兼容旧的 `meta.*` 写法。

### 请求去重插件

相同 HTTP 方法、完整地址、查询参数和请求体在默认 2 秒窗口内只会执行一次底层请求，后续调用
复用首次请求的结果。每个调用仍会独立执行响应拦截器，也可以通过自己的 `AbortSignal` 停止
等待，而不会取消其他调用共享的底层请求。

```ts
import { createDedupePlugin } from "request";

const removeDedupe = client.use(createDedupePlugin());

// 两次调用只发送一次请求。
const first = client.get("/users", { page: 1 });
const second = client.get("/users", { page: 1 });
await Promise.all([first, second]);

removeDedupe();
```

通过 `windowMs` 自定义窗口，例如改为 5 秒：

```ts
client.use(createDedupePlugin({ windowMs: 5_000 }));
```

默认键会稳定序列化普通对象、数组、`Date` 和 `URLSearchParams`，因此对象字段声明顺序不会影响
匹配。`FormData`、`Blob`、循环引用等无法可靠序列化的数据默认跳过去重；可使用 `createKey`
按业务规则生成键，返回 `undefined` 时也会跳过当前请求。

```ts
client.use(
  createDedupePlugin({
    windowMs: 3_000,
    createKey: (config) => (config.meta?.dedupeKey ? String(config.meta.dedupeKey) : undefined),
  }),
);
```

单次请求可通过 `dedupe` 覆盖去重配置。例如临时关闭当前请求的去重，或为当前请求提供
专用去重键：

```ts
await client.get("/users", { page: 1 }, { dedupe: { windowMs: 0 } });

await client.get("/jobs", undefined, {
  dedupe: {
    createKey: (config) => String(config.headers?.["x-job-id"]),
  },
});
```

### Mock 插件

Mock 插件在请求拦截器执行后、底层适配器执行前匹配请求。匹配成功时直接返回标准响应，真实
网络层不会被调用；匹配不到时继续执行真实适配器。插件卸载后，所有请求都会恢复到原适配器。

```ts
import { createMockPlugin } from "request";

const mock = createMockPlugin({
  routes: [
    {
      method: "GET",
      url: "https://api.example.com/users/1",
      response: {
        code: 0,
        data: { id: "1", name: "Alice" },
      },
    },
    {
      method: "POST",
      url: /^https:\/\/api\.example\.com\/users$/,
      response: async (config) => ({
        code: 0,
        data: {
          id: crypto.randomUUID(),
          ...config.data,
        },
      }),
      status: 201,
      headers: { "x-mock": "true" },
      delay: 200,
    },
  ],
});

const removeMock = client.use(mock);
const user = await client.get<User>("/users/1");

console.log(mock.history);
removeMock();
```

`url` 支持三种匹配方式：

| 类型                       | 行为                                                 |
| -------------------------- | ---------------------------------------------------- |
| `string`                   | 精确匹配合并 `baseURL` 后的 URL                      |
| `RegExp`                   | 使用正则匹配 URL，插件会在每次匹配前重置 `lastIndex` |
| `(url, config) => boolean` | 自定义同步或异步匹配，可读取参数、请求体和 `meta`    |

`method` 可以是单个 HTTP 方法或方法数组，省略时匹配所有方法。路由按照声明顺序匹配，第一条
命中的规则生效。

```ts
const mock = createMockPlugin({
  delay: 100,
  routes: [
    {
      method: ["GET", "DELETE"],
      url: (url, config) => url.startsWith("/items/") && config.meta?.mock === true,
      response: { ok: true },
      once: true,
    },
  ],
});
```

| 配置               | 默认值   | 说明                                                    |
| ------------------ | -------- | ------------------------------------------------------- |
| `delay`            | `0`      | 全局响应延迟，路由自己的 `delay` 优先                   |
| `route.once`       | `false`  | 路由命中一次后失效                                      |
| `route.status`     | `200`    | Mock HTTP 状态码，大于等于 400 时仍会转换为 `HttpError` |
| `route.statusText` | 自动生成 | 成功为 `OK`，错误为 `Mock Error`                        |
| `route.headers`    | `{}`     | Mock 响应头                                             |

未匹配到任何 Mock 路由时，请求会继续交给当前真实适配器执行。每次请求都会写入
`mock.history`，包括未匹配并透传的请求。`mock.reset()` 会清空历史，同时恢复已消费的
`once` 路由。延迟等待遵守请求的 `AbortSignal`，取消请求不会继续等待。

单次请求可通过 `mock` 跳过初始化 `routes` 匹配。`mock` 是普通对象或函数时直接作为响应体返回；
是包含 `url` 和 `response` 的 `MockRoute` 对象时，直接作为命中的路由处理，路由的 `status`、
`statusText`、`headers`、`delay` 和 `once` 继续生效。`mock` 优先级高于兼容写法
`meta.mock`。

```ts
await client.post(
  "/users",
  { name: "Alice" },
  {
    mock: {
      code: 0,
      message: "你好",
      data: [{ id: "Route000210" }],
    },
  },
);

await client.get("/users/1", undefined, {
  mock: {
    url: "/not-used-for-matching",
    response: { code: 0, data: { id: "1", name: "Alice" } },
    status: 201,
    headers: { "x-meta-mock": "true" },
  },
});
```

> 默认客户端仍会对 Mock 响应执行响应拦截器和业务响应解包。若启用了默认解包，Mock 数据可按
> `{ code: 0, data: ... }` 返回；不含 `code` 的响应则保持原样。

### 日志插件

```ts
import { createLoggerPlugin } from "request";

const removeLogger = client.use(
  createLoggerPlugin({
    logger: console,
  }),
);

await client.get("/users", undefined, {
  logger: {
    logger: {
      debug: (...args) => debugReporter.send(args),
      error: (...args) => errorReporter.send(args),
    },
  },
});

removeLogger();
```

自定义插件通过 `setup(client)` 注册拦截器或其他能力，并可返回清理函数。重复安装同一个插件
对象时，客户端会复用已有的清理函数。

## 当前边界

- 默认适配器依赖运行环境提供 `fetch`、`Headers`、`AbortController` 等 Web API。
- UniApp 适配器依赖运行环境提供 `uni.request`，也可以通过构造参数显式注入。
- 自动业务响应解包只处理含配置 code 字段的对象，其他响应不会被改变。

## 开发与验证

```bash
vp install
vp check
vp test
vp run build
vp run demo
```

`vp run build` 会先选择要升级的版本号并自动写入 `package.json`，然后执行打包。

`vp run demo` 会运行 `case/demo.ts`，使用本地 Mock 和适配器桩覆盖主要调用场景，
不会发出真实网络请求。更完整的设计说明见 `docs/request-encapsulation-dev.md`。
