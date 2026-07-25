# 请求封装使用指南

**使用文档 · 面向业务开发者的快速上手与 API 参考**

版本 1.0 · 2026-07-24

---

## 目录

- [快速开始](#快速开始)
- [请求方法](#请求方法)
- [类型安全](#类型安全)
- [错误处理](#错误处理)
- [配置选项](#配置选项)
- [拦截器](#拦截器)
- [取消请求](#取消请求)
- [Service 层](#service-层)
- [API 参考](#api-参考)
- [常见问题](#常见问题)

---

## 快速开始

项目已内置默认的 `httpClient` 实例。业务代码只需从统一入口导入即可发起请求。

```typescript
import { httpClient } from "@/request";

async function loadUser() {
  const user = await httpClient.get<User>("/api/user");
  console.log(user.name);
}
```

如果需要不同配置（例如连接第三方服务），可用工厂函数创建新实例：

```typescript
import { createHttpClient } from "@/request";

const thirdClient = createHttpClient({
  baseURL: "https://third-party.example.com",
  timeout: 30000,
});

const data = await thirdClient.get<ThirdData>("/data");
```

---

## 请求方法

RequestClient 提供与常见 HTTP 方法对应的便捷方法，也支持通过 `request` 方法传入完整配置。

### GET 请求

```typescript
const list = await httpClient.get<User[]>("/api/users", {
  page: 1,
  pageSize: 20,
});

// 同时覆盖 headers 或 timeout
const list = await httpClient.get<User[]>(
  "/api/users",
  { page: 1 },
  { headers: { "X-Trace-Id": traceId }, timeout: 5000 },
);
```

### POST / PUT / PATCH / DELETE

```typescript
// POST
const created = await httpClient.post<User>("/api/users", {
  name: "Alice",
  email: "alice@example.com",
});

// PUT
const updated = await httpClient.put<User>("/api/users/1", { name: "Bob" });

// PATCH
await httpClient.patch<User>("/api/users/1", { status: "active" });

// DELETE
await httpClient.delete("/api/users/1");
```

### 通用 request 方法

当需要更灵活的配置时，使用 `request`：

```typescript
const result = await httpClient.request<Blob>({
  url: "/api/export",
  method: "POST",
  data: { ids: [1, 2, 3] },
  responseType: "blob", // 若底层适配器支持
  timeout: 60000,
});
```

---

## 类型安全

每个请求方法的第一个泛型参数是响应数据类型，第二个是请求参数或请求体类型。善用泛型可在编译期捕获类型错误。

```typescript
interface User {
  id: number;
  name: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

// 泛型顺序：响应类型，请求体类型
const user = await httpClient.post<User, CreateUserInput>("/api/users", {
  name: "Alice",
  email: "alice@example.com",
});
```

> **提示**：如果后端返回统一包装格式 `{ code, data, message }`，泛型参数应填写 data 的实际类型。响应拦截器会自动拆包。

---

## 错误处理

所有错误都会被转换为统一类型，业务代码只需处理 `RequestError` 的几种具体子类。

### 错误类型速查

| 错误类          | 触发场景                  | 常用字段             |
| --------------- | ------------------------- | -------------------- |
| `NetworkError`  | 断网、DNS 失败、CORS 错误 | `message`            |
| `TimeoutError`  | 请求超时                  | `message`            |
| `HttpError`     | HTTP status ≥ 400         | `status`, `response` |
| `BusinessError` | HTTP 200 但业务 code 非 0 | `code`, `details`    |

### 处理示例

```typescript
import { httpClient, NetworkError, TimeoutError, HttpError, BusinessError } from "@/request";

try {
  const user = await httpClient.get<User>("/api/user");
} catch (err) {
  if (err instanceof BusinessError) {
    message.error(`业务异常：${err.message}（${err.code}）`);
  } else if (err instanceof HttpError) {
    if (err.status === 401) {
      // 已在拦截器统一处理，通常不会落到业务层
    } else {
      message.error(`服务器错误：${err.status}`);
    }
  } else if (err instanceof TimeoutError) {
    message.warning("请求超时，请稍后重试");
  } else if (err instanceof NetworkError) {
    message.warning("网络异常，请检查网络连接");
  } else {
    // 兜底：未预期错误
    console.error(err);
  }
}
```

---

## 配置选项

每个请求都可覆盖全局配置。常用配置项如下：

| 选项              | 类型                      | 说明                                                 |
| ----------------- | ------------------------- | ---------------------------------------------------- |
| `baseURL`         | `string`                  | 客户端可设置全局值，单次请求可覆盖；请求级配置优先   |
| `timeout`         | `number`                  | 超时时间，单位毫秒，默认 10000                       |
| `headers`         | `Record<string, string>`  | 请求头，可被单次请求覆盖                             |
| `retry`           | `number \| RetryPolicy`   | 客户端可设置全局值，单次请求整体覆盖；请求级配置优先 |
| `withCredentials` | `boolean`                 | 是否携带 cookie                                      |
| `signal`          | `AbortSignal`             | 用于取消请求的 signal                                |
| `meta`            | `Record<string, unknown>` | 全局和单次请求均可设置，供插件与拦截器读取           |

### 重试配置

```typescript
// 简单重试 3 次
await httpClient.get<Data>("/api/data", undefined, { retry: 3 });

// 精细控制
await httpClient.get<Data>("/api/data", undefined, {
  retry: {
    max: 3,
    delay: 500,
    backoff: "exponential", // 500ms, 1000ms, 2000ms
    retryable: (err) => err instanceof TimeoutError,
  },
});
```

## 拦截器

拦截器可在请求发送前或响应到达后插入通用逻辑。每个拦截器返回一个卸载函数。

### 注册请求拦截器

```typescript
const removeAuth = httpClient.useRequestInterceptor({
  async fulfilled(config) {
    const token = await getToken();
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
    return config;
  },
});

// 不再需要时卸载
removeAuth();
```

### 注册响应拦截器

```typescript
httpClient.useResponseInterceptor({
  fulfilled(res) {
    // 可在这里做全局埋点
    analytics.track("api_success", { url: res.config.url });
    return res;
  },
  rejected(error, latestResponse) {
    // 可在这里做全局错误上报
    errorReporter.capture(error, { latestResponse });
    throw error;
  },
});
```

> **提示**：全局拦截器建议在应用初始化时统一注册，不要每个组件都重复注册，否则可能造成重复处理。

---

## 取消请求

组件卸载、用户重复点击、路由切换时，应取消不再需要的请求。使用 `AbortController` 即可实现。

### 基础用法

```typescript
const controller = new AbortController();

httpClient
  .get<User>("/api/user", undefined, { signal: controller.signal })
  .then(setUser)
  .catch((err) => {
    if (err.name === "AbortError") {
      console.log("请求已取消");
    }
  });

// 取消
controller.abort();
```

### React 组件中的典型用法

```typescript
useEffect(() => {
  const controller = new AbortController();

  httpClient.get<User>("/api/user", undefined, { signal: controller.signal }).then(setUser);

  return () => controller.abort();
}, []);
```

---

## Service 层

不要把请求直接写在组件里。按业务领域封装 Service，把 URL、类型、通用参数集中管理，组件只调用语义化的函数。

### 推荐写法

```typescript
// services/user.ts
import { httpClient } from "@/request";

export interface User {
  id: string;
  name: string;
}

export interface UpdateUserInput {
  name?: string;
  avatar?: string;
}

export const userService = {
  getById: (id: string) => httpClient.get<User>(`/api/users/${id}`),
  update: (id: string, data: UpdateUserInput) => httpClient.put<User>(`/api/users/${id}`, data),
};

// 组件中
const user = await userService.getById(id);
```

> **收益**：Service 层让 URL 收口、类型复用、Mock 替换更方便，也使组件更薄、更易于测试。

---

## API 参考

### RequestClient 方法

```typescript
request<T>(config: RequestConfig): Promise<T>
```

通用请求方法，适合需要完整配置的场景。

```typescript
get<T, P>(url, params?, config?): Promise<T>
```

GET 请求，第二个参数会被序列化为查询字符串。

```typescript
post<T, D>(url, data?, config?): Promise<T>
```

POST 请求，`data` 作为请求体。

```typescript
put<T, D>(url, data?, config?): Promise<T>
```

PUT 请求。

```typescript
patch<T, D>(url, data?, config?): Promise<T>
```

PATCH 请求。

```typescript
delete<T>(url, config?): Promise<T>
```

DELETE 请求。

```typescript
useRequestInterceptor(interceptor): () => void
```

注册请求拦截器，返回卸载函数。

```typescript
useResponseInterceptor(interceptor): () => void
```

注册响应拦截器，返回卸载函数。

### 工厂函数

```typescript
createHttpClient(options?: ClientOptions): RequestClient
```

创建新的 RequestClient 实例。常用选项：

| 选项              | 类型                      | 默认值       | 说明                                   |
| ----------------- | ------------------------- | ------------ | -------------------------------------- |
| `baseURL`         | `string`                  | —            | 请求基地址                             |
| `timeout`         | `number`                  | 10000        | 默认超时时间                           |
| `retry`           | `number \| RetryPolicy`   | —            | 默认重试次数或策略，单次请求可整体覆盖 |
| `withCredentials` | `boolean`                 | false        | 是否携带 cookie                        |
| `headers`         | `Record<string, string>`  | {}           | 默认请求头                             |
| `meta`            | `Record<string, unknown>` | —            | 与单次请求 meta 浅合并的全局上下文     |
| `adapter`         | `HttpAdapter`             | FetchAdapter | 自定义底层适配器                       |

全局 `meta` 会先于单次请求 `meta` 合并，同名键由单次请求覆盖；合并结果会传给请求拦截器、
请求解析器、适配器和响应拦截器。

---

## 常见问题

### 如何上传文件？

```typescript
const formData = new FormData();
formData.append("file", file);

await httpClient.post<UploadResult>("/api/upload", formData, {
  headers: { "Content-Type": "multipart/form-data" },
  timeout: 120000,
});
```

### 如何设置全局默认 header？

在创建实例时传入，或通过请求拦截器动态注入。

```typescript
const client = createHttpClient({
  headers: { "X-Client-Version": "1.0.0" },
});
```

### 为什么请求没有携带 cookie？

检查实例是否开启 `withCredentials: true`，同时确认后端响应头包含正确的 `Access-Control-Allow-Credentials` 和 `Access-Control-Allow-Origin`（不可为 `*`）。

### 如何处理后端返回的统一包装体？

已在全局响应拦截器中处理。业务层调用时传入的类型是 `data` 字段的实际类型，无需手动拆包。

### 请求被取消了，为什么 catch 里没收到错误？

请检查是否把 `AbortController.signal` 正确传给了请求配置，并在 catch 中判断 `error.name === 'AbortError'`。如果已被其他拦截器吞掉错误，请检查拦截器是否未重新抛出。

---

请求封装最佳实践 · 使用文档。更多实现细节请参阅对应的开发文档。
