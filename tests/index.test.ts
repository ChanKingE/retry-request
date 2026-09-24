import {
  BusinessError,
  FetchAdapter,
  HttpError,
  InterceptorManager,
  NetworkError,
  RequestClient,
  TimeoutError,
  createHttpClient,
  createRequest,
  createResponseEnvelopeInterceptor,
  executeWithRetry,
  type HttpAdapter,
  type HttpResponse,
  type RequestOptions,
  type RequestPlugin,
} from "../src/index.ts";

declare module "../src/types.ts" {
  interface RequestOptionsExtensions {
    withToken?: boolean;
  }
}

type AdapterStep = (config: RequestOptions) => Promise<HttpResponse>;

class ScriptedAdapter implements HttpAdapter {
  readonly calls: RequestOptions[] = [];
  readonly #steps: AdapterStep[];

  constructor(...steps: AdapterStep[]) {
    this.#steps = steps;
  }

  async request<T>(config: RequestOptions): Promise<HttpResponse<T>> {
    this.calls.push(config);
    const step = this.#steps.shift();
    if (!step) throw new Error("No adapter response configured");
    return (await step(config)) as HttpResponse<T>;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RequestClient", () => {
  test("creates a default client with an injectable adapter and timeout without unwrapping", async () => {
    const adapter = new ScriptedAdapter(async (config) =>
      response({ code: 0, data: { ready: true } }, config),
    );
    const client = createHttpClient({ adapter });

    await expect(client.get("/ready")).resolves.toEqual({ code: 0, data: { ready: true } });
    expect(adapter.calls[0]?.timeout).toBe(10_000);
  });

  test("configures response unwrapping through the second factory argument", async () => {
    const standardAdapter = new ScriptedAdapter(async (config) =>
      response({ code: 0, data: { ready: true } }, config),
    );
    const customAdapter = new ScriptedAdapter(async (config) =>
      response({ status: "SUCCESS", result: { ready: true } }, config),
    );

    await expect(createHttpClient({ adapter: standardAdapter }, true).get("/ready")).resolves.toEqual({
      ready: true,
    });
    await expect(
      createHttpClient(
        { adapter: customAdapter },
        { successCode: "SUCCESS", codeKey: "status", dataKey: "result" },
      ).get("/ready"),
    ).resolves.toEqual({ ready: true });
  });

  test("supports axios-style request and method helper calls", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);

    await client.request({ url: "/get-config", params: { page: 1 } });
    await client.get("/get-url-config", { params: { page: 2 }, baseURL: "" });
    await client.delete("/delete-url-config", { params: { page: 3 } });
    await client.head("/head-url-config", { headers: { "x-head": "1" } });
    await client.options("/options-url-config", { retry: 0 });
    await client.request({ url: "/post-config", method: "POST", data: { name: "Ada" } });
    await client.post("/post-payload-config", { name: "Linus" }, { headers: { "x-name": "1" } });
    await client.put("/put-payload-config", { id: 1 }, { params: { expand: "user" } });
    await client.patch("/patch-payload-config", { id: 2 }, { retry: 0 });

    expect(
      adapter.calls.map(({ url, method, params, data, baseURL, headers, retry }) => ({
        url,
        method,
        params,
        data,
        baseURL,
        headers,
        retry,
      })),
    ).toEqual([
      {
        url: "/get-config",
        method: "GET",
        params: { page: 1 },
        data: {},
        baseURL: undefined,
        headers: {},
        retry: undefined,
      },
      {
        url: "/get-url-config",
        method: "GET",
        params: { page: 2 },
        data: {},
        baseURL: "",
        headers: {},
        retry: undefined,
      },
      {
        url: "/delete-url-config",
        method: "DELETE",
        params: { page: 3 },
        data: {},
        baseURL: undefined,
        headers: {},
        retry: undefined,
      },
      {
        url: "/head-url-config",
        method: "HEAD",
        params: {},
        data: {},
        baseURL: undefined,
        headers: { "x-head": "1" },
        retry: undefined,
      },
      {
        url: "/options-url-config",
        method: "OPTIONS",
        params: {},
        data: {},
        baseURL: undefined,
        headers: {},
        retry: 0,
      },
      {
        url: "/post-config",
        method: "POST",
        params: {},
        data: { name: "Ada" },
        baseURL: undefined,
        headers: {},
        retry: undefined,
      },
      {
        url: "/post-payload-config",
        method: "POST",
        params: {},
        data: { name: "Linus" },
        baseURL: undefined,
        headers: { "x-name": "1" },
        retry: undefined,
      },
      {
        url: "/put-payload-config",
        method: "PUT",
        params: { expand: "user" },
        data: { id: 1 },
        baseURL: undefined,
        headers: {},
        retry: undefined,
      },
      {
        url: "/patch-payload-config",
        method: "PATCH",
        params: {},
        data: { id: 2 },
        baseURL: undefined,
        headers: {},
        retry: 0,
      },
    ]);
  });

  test("supports config-only calls for all method helpers", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);

    await client.get({ url: "/get", params: { page: 1 } });
    await client.delete({ url: "/delete", params: { force: true } });
    await client.head({ url: "/head", headers: { "x-head": "1" } });
    await client.options({ url: "/options", retry: 0 });
    await client.post({ url: "/post", data: { name: "Ada" } });
    await client.put({ url: "/put", data: { id: 1 } });
    await client.patch({ url: "/patch", data: { id: 2 } });

    expect(
      adapter.calls.map(({ url, method, params, data }) => ({ url, method, params, data })),
    ).toEqual([
      { url: "/get", method: "GET", params: { page: 1 }, data: {} },
      { url: "/delete", method: "DELETE", params: { force: true }, data: {} },
      { url: "/head", method: "HEAD", params: {}, data: {} },
      { url: "/options", method: "OPTIONS", params: {}, data: {} },
      { url: "/post", method: "POST", params: {}, data: { name: "Ada" } },
      { url: "/put", method: "PUT", params: {}, data: { id: 1 } },
      { url: "/patch", method: "PATCH", params: {}, data: { id: 2 } },
    ]);
  });

  test("applies defaults and runs ejectable interceptors in registration order", async () => {
    const adapter = new ScriptedAdapter(async (config) => response({ ok: true }, config));
    const client = new RequestClient(adapter, {
      baseURL: "https://api.example.com/",
      timeout: 5_000,
      headers: { "x-default": "yes" },
    });
    const order: string[] = [];
    client.useRequestInterceptor({
      fulfilled(config) {
        order.push("first");
        expect(config.url).toBe("/users");
        return { ...config, headers: { ...config.headers, "x-first": "1" } };
      },
    });
    const removeSecond = client.useRequestInterceptor({
      fulfilled(config) {
        order.push("second");
        return config;
      },
    });
    removeSecond();

    await expect(
      client.get<{ ok: boolean }>("/users", { headers: { "x-request": "yes" } }),
    ).resolves.toEqual({ ok: true });
    expect(order).toEqual(["first"]);
    expect(adapter.calls[0]).toMatchObject({
      url: "https://api.example.com/users",
      baseURL: "https://api.example.com/",
      method: "GET",
      timeout: 5_000,
      headers: { "x-default": "yes", "x-request": "yes", "x-first": "1" },
    });
  });

  test("uses a function request interceptor as fulfilled", async () => {
    const adapter = new ScriptedAdapter(async (config) => response({ ok: true }, config));
    const client = new RequestClient(adapter);
    const addHeader = (config: RequestOptions) => ({
      ...config,
      headers: { ...config.headers, "x-function": "1" },
    });

    const remove = client.useRequestInterceptor(addHeader);
    remove();
    client.useRequestInterceptor(addHeader);

    await expect(client.get<{ ok: boolean }>("/function")).resolves.toEqual({ ok: true });
    expect(adapter.calls[0]?.headers).toMatchObject({ "x-function": "1" });
  });

  test("uses a function response interceptor as fulfilled", async () => {
    const adapter = new ScriptedAdapter(async (config) => response({ ok: true }, config));
    const client = new RequestClient(adapter);

    client.useResponseInterceptor((value) => ({
      ...value,
      data: { ok: value.data && "mapped" },
    }));

    await expect(client.get("/function-response")).resolves.toEqual({ ok: "mapped" });
  });

  test("prefers the request baseURL and allows disabling the global baseURL", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ source: "request" }, config),
      async (config) => response({ source: "global-disabled" }, config),
      async (config) => response({ source: "absolute" }, config),
    );
    const client = new RequestClient(adapter, { baseURL: "https://global.example.com/api" });

    await client.get("/users", { baseURL: "https://request.example.com/v2/" });
    await client.get("/health", { baseURL: "" });
    await client.get("https://external.example.com/status");

    expect(adapter.calls.map(({ url, baseURL }) => ({ url, baseURL }))).toEqual([
      {
        url: "https://request.example.com/v2/users",
        baseURL: "https://request.example.com/v2/",
      },
      { url: "/health", baseURL: "" },
      {
        url: "https://external.example.com/status",
        baseURL: "https://global.example.com/api",
      },
    ]);
  });

  test("provides object defaults for request data, params, and headers", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);

    await client.get("/defaults");
    await client.post("/empty");
    await client.request({ url: "/undefined", data: undefined, params: undefined, headers: undefined });

    for (const call of adapter.calls) {
      expect(call).toMatchObject({ data: {}, params: {}, headers: {} });
    }
  });

  test("overrides default headers without regard to casing", async () => {
    const adapter = new ScriptedAdapter(async (config) => response({ ok: true }, config));
    const client = new RequestClient(adapter, {
      headers: { Authorization: "Bearer default", "x-client": "1" },
    });

    await client.get("/profile", { headers: { authorization: "Bearer request" } });

    expect(adapter.calls[0]?.headers).toEqual({
      authorization: "Bearer request",
      "x-client": "1",
    });
  });

  test("supports declaration-merged request config fields", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);
    const withTokenValues: Array<boolean | undefined> = [];

    client.useRequestInterceptor({
      fulfilled(config) {
        withTokenValues.push(config.withToken);
        return config.withToken === false
          ? config
          : {
              ...config,
              headers: { ...config.headers, Authorization: "Bearer token" },
            };
      },
    });

    await client.get("/public", { withToken: false });
    await client.post("/private", { name: "Ada" }, { withToken: true });

    expect(withTokenValues).toEqual([false, true]);
    expect(adapter.calls.map(({ withToken }) => withToken)).toEqual([false, true]);
    expect(adapter.calls[0]?.headers).not.toHaveProperty("Authorization");
    expect(adapter.calls[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  test("lets a response rejection interceptor recover from a normalized network error", async () => {
    const adapter = new ScriptedAdapter(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new RequestClient(adapter);
    client.useResponseInterceptor({
      rejected(error, latestResponse) {
        expect(error).toBeInstanceOf(NetworkError);
        expect(latestResponse).toBeUndefined();
        return response({ offline: true }, { url: "/status", method: "GET" });
      },
    });

    await expect(client.get("/status")).resolves.toEqual({ offline: true });
  });

  test("retries recoverable errors for idempotent requests", async () => {
    const adapter = new ScriptedAdapter(
      async () => {
        throw new TimeoutError();
      },
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);

    await expect(client.get("/retry", { retry: { max: 1, delay: 0 } })).resolves.toEqual({
      ok: true,
    });
    expect(adapter.calls).toHaveLength(2);
  });

  test("uses the global retry policy unless the request overrides it", async () => {
    const globalAdapter = new ScriptedAdapter(
      async () => {
        throw new TimeoutError();
      },
      async (config) => response({ recovered: true }, config),
    );
    const globalClient = new RequestClient(globalAdapter, {
      retry: { max: 1, delay: 0 },
    });

    await expect(globalClient.get("/global-retry")).resolves.toEqual({ recovered: true });
    expect(globalAdapter.calls).toHaveLength(2);
    expect(globalAdapter.calls[0]?.retry).toEqual({ max: 1, delay: 0 });

    const requestAdapter = new ScriptedAdapter(
      async () => {
        throw new TimeoutError();
      },
      async (config) => response({ unexpected: true }, config),
    );
    const requestClient = new RequestClient(requestAdapter, { retry: 2 });

    await expect(requestClient.get("/request-retry", { retry: 0 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(requestAdapter.calls).toHaveLength(1);
    expect(requestAdapter.calls[0]?.retry).toBe(0);
  });

  test("does not retry a non-idempotent request unless explicitly enabled", async () => {
    const adapter = new ScriptedAdapter(
      async () => {
        throw new TimeoutError();
      },
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);

    await expect(client.post("/orders", {}, { retry: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(adapter.calls).toHaveLength(1);
  });

  test("converts unsuccessful adapter responses to HttpError", async () => {
    const adapter = new ScriptedAdapter(async (config) => ({
      ...response({ message: "unavailable" }, config),
      status: 503,
      statusText: "Service Unavailable",
    }));
    const client = new RequestClient(adapter);

    const error = await client.get("/health").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503, message: "Service Unavailable" });
  });

  test("supports opt-in business response envelopes", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ code: 0, data: { id: "1" } }, config),
      async (config) =>
        response({ code: 42, message: "Rejected", data: { field: "name" } }, config),
    );
    const client = new RequestClient(adapter);
    client.useResponseInterceptor(createResponseEnvelopeInterceptor());

    await expect(client.get("/ok")).resolves.toEqual({ id: "1" });
    const error = await client.get("/fail").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BusinessError);
    expect(error).toMatchObject({ code: "42", message: "Rejected", details: { field: "name" } });
  });

  test("shares an AbortSignal through createRequest", async () => {
    const adapter = new ScriptedAdapter(
      (config) =>
        new Promise((_, reject) => {
          if (config.signal?.aborted) {
            reject(config.signal.reason);
            return;
          }
          config.signal?.addEventListener("abort", () => reject(config.signal?.reason), {
            once: true,
          });
        }),
    );
    const client = new RequestClient(adapter);
    const pending = createRequest(client);
    const result = pending.execute({ url: "/slow" });
    pending.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  test("rejects an already canceled signal before resolvers and adapters", async () => {
    const adapter = new ScriptedAdapter(async (config) => response({ ok: true }, config));
    const client = new RequestClient(adapter);
    const resolver = vi.fn();
    client.useRequestResolver(resolver);
    const controller = new AbortController();
    const reason = new Error("navigation changed");
    controller.abort(reason);

    const error = await client
      .get("/canceled", { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: "AbortError", cause: reason });
    expect(resolver).not.toHaveBeenCalled();
    expect(adapter.calls).toHaveLength(0);
  });

  test("runs plugin cleanup and removes plugin interceptors", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ ok: true }, config),
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);
    let calls = 0;
    const plugin: RequestPlugin = {
      name: "counter",
      setup(target) {
        return target.useRequestInterceptor({
          fulfilled(config) {
            calls += 1;
            return config;
          },
        });
      },
    };

    const cleanup = client.use(plugin);
    await client.get("/first");
    cleanup();
    await client.get("/second");
    expect(calls).toBe(1);
  });

  test("consumes a once plugin for exactly one complete request", async () => {
    const adapter = new ScriptedAdapter(
      async (config) => response({ value: 1 }, config),
      async (config) => response({ value: 2 }, config),
    );
    const client = new RequestClient(adapter);
    const phases: string[] = [];
    const plugin: RequestPlugin = {
      name: "once",
      setup(target) {
        const removeRequest = target.useRequestInterceptor({
          fulfilled(config) {
            phases.push(`request:${config.url}`);
            return config;
          },
        });
        const removeResponse = target.useResponseInterceptor({
          fulfilled(value) {
            phases.push(`response:${value.config.url}`);
            return value;
          },
        });
        return () => {
          removeRequest();
          removeResponse();
        };
      },
    };

    const firstCleanup = client.once(plugin);
    expect(client.once(plugin)).toBe(firstCleanup);
    await client.get("/first");
    await client.get("/second");

    expect(phases).toEqual(["request:/first", "response:/first"]);
  });

  test("cleans up a once plugin after failure and supports cancellation before consumption", async () => {
    const adapter = new ScriptedAdapter(
      async () => {
        throw new TypeError("offline");
      },
      async (config) => response({ ok: true }, config),
    );
    const client = new RequestClient(adapter);
    let calls = 0;
    const plugin: RequestPlugin = {
      name: "once-cleanup",
      setup(target) {
        return target.useRequestInterceptor({
          fulfilled(config) {
            calls += 1;
            return config;
          },
        });
      },
    };

    client.once(plugin);
    await expect(client.get("/failure")).rejects.toBeInstanceOf(NetworkError);
    await client.get("/after-failure");
    expect(calls).toBe(1);

    const cancel = client.once(plugin);
    cancel();
    cancel();
    expect(calls).toBe(1);
  });

  test("does not let concurrent requests consume the same once plugin", async () => {
    let releaseFirst: (() => void) | undefined;
    const adapter = new ScriptedAdapter(
      (config) =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(response({ request: "first" }, config));
        }),
      async (config) => response({ request: "second" }, config),
    );
    const client = new RequestClient(adapter);
    const consumedURLs: string[] = [];
    client.once({
      name: "concurrent-once",
      setup(target) {
        return target.useRequestInterceptor({
          fulfilled(config) {
            consumedURLs.push(config.url);
            return config;
          },
        });
      },
    });

    const first = client.get("/first");
    await vi.waitFor(() => expect(adapter.calls).toHaveLength(1));
    const second = client.get("/second");
    await Promise.resolve();

    expect(adapter.calls).toHaveLength(1);
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { request: "first" },
      { request: "second" },
    ]);
    expect(consumedURLs).toEqual(["/first"]);
  });
});

describe("executeWithRetry", () => {
  test("honors Retry-After up to the configured maximum delay", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const operation = async () => {
        calls += 1;
        if (calls === 1) {
          throw new HttpError("Busy", 429, {
            data: undefined,
            status: 429,
            statusText: "Busy",
            headers: { "Retry-After": "2" },
            config: { url: "/busy" },
          });
        }
        return "recovered";
      };
      const pending = executeWithRetry(
        operation,
        { max: 1, delay: 100, maxDelay: 1_000, respectRetryAfter: true },
        "GET",
      );

      await vi.advanceTimersByTimeAsync(999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe("recovered");
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("applies full jitter to bounded exponential delays", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      let calls = 0;
      const operation = async () => {
        calls += 1;
        if (calls < 3) throw new TimeoutError();
        return "recovered";
      };
      const pending = executeWithRetry(
        operation,
        { max: 2, delay: 100, backoff: "exponential", maxDelay: 150, jitter: "full" },
        "GET",
      );

      await vi.advanceTimersByTimeAsync(49);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(74);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe("recovered");
      expect(calls).toBe(3);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test("does not retry an already canceled zero-delay wait", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      controller.abort();
      throw new TimeoutError();
    });

    await expect(
      executeWithRetry(operation, { max: 1, delay: 0 }, "GET", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledOnce();
  });

  test("rejects a non-finite retry count", async () => {
    await expect(executeWithRetry(async () => 1, Number.NaN, "GET")).rejects.toThrow(
      "retry.max must be finite",
    );
  });
});

describe("InterceptorManager", () => {
  test("ejects the original interceptor reference", async () => {
    const manager = new InterceptorManager<number>();
    const interceptor = { fulfilled: (value: number) => value + 1 };
    manager.use(interceptor);
    manager.eject(interceptor);
    await expect(manager.run(1)).resolves.toBe(1);
  });

  test("accepts fulfilled and rejected handlers as two arguments", async () => {
    const manager = new InterceptorManager<{ count: number }, Error>();
    const remove = manager.use(
      (value) => ({ count: value.count + 1 }),
      (error, latestValue) => {
        expect(error.message).toBe("request failed");
        expect(latestValue).toBeUndefined();
        return { count: 1 };
      },
    );

    await expect(manager.run(Promise.reject(new Error("request failed")))).resolves.toEqual({
      count: 1,
    });
    remove();
    await expect(manager.run({ count: 0 })).resolves.toEqual({ count: 0 });
  });

  test("passes the latest successful value to a rejection interceptor", async () => {
    const manager = new InterceptorManager<{ count: number }, Error>();
    manager.use({
      fulfilled(value) {
        return { count: value.count + 1 };
      },
    });
    manager.use({
      fulfilled() {
        throw new Error("interceptor failed");
      },
    });
    manager.use({
      rejected(error, latestValue) {
        expect(error.message).toBe("interceptor failed");
        expect(latestValue).toEqual({ count: 1 });
        return { count: (latestValue?.count ?? 0) + 1 };
      },
    });

    await expect(manager.run({ count: 0 })).resolves.toEqual({ count: 2 });
  });

  test("passes errors from the current fulfilled handler to its rejected handler", async () => {
    const manager = new InterceptorManager<{ count: number }, Error>();
    manager.use(
      async () => {
        throw new Error("fulfilled failed");
      },
      (error, latestValue) => {
        expect(error.message).toBe("fulfilled failed");
        expect(latestValue).toEqual({ count: 0 });
        return { count: 2 };
      },
    );

    await expect(manager.run({ count: 0 })).resolves.toEqual({ count: 2 });
  });
});

describe("FetchAdapter", () => {
  test("does not send a body for a default GET request", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      expect(request.body).toBeNull();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createHttpClient({}, false).get("https://api.example.com/health"),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("does not send a body when FetchAdapter defaults its method to GET", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new Request(url, init).body).toBeNull();
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new FetchAdapter().request({ url: "https://api.example.com/health", data: {} }),
    ).resolves.toMatchObject({ data: "ok" });
  });

  test("serializes params and JSON request bodies", async () => {
    const fetchMock = vi.fn(async (..._arguments: Parameters<typeof fetch>) =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new FetchAdapter();

    const result = await adapter.request<{ id: string }>({
      url: "https://api.example.com/users?active=true#details",
      method: "POST",
      params: { role: ["admin user", "owner"] },
      data: { name: "Ada" },
    });

    expect(result.data).toEqual({ id: "1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as Parameters<typeof fetch>;
    expect(url).toBe("https://api.example.com/users?active=true&role=admin+user&role=owner#details");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ name: "Ada" }) });
    expect((init?.headers as Headers | undefined)?.get("content-type")).toBe("application/json");
  });

  test("parses structured JSON media types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "1" }), {
          headers: { "content-type": "application/problem+json; charset=utf-8" },
        }),
      ),
    );

    await expect(new FetchAdapter().request({ url: "https://api.example.com/problem" })).resolves.toMatchObject({
      data: { id: "1" },
    });
  });

  test("normalizes external Fetch cancellation and preserves its reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener(
              "abort",
              () => reject(new Error("native fetch cancellation")),
              { once: true },
            );
          }),
      ),
    );
    const controller = new AbortController();
    const reason = new Error("route changed");
    const pending = new FetchAdapter().request({
      url: "https://api.example.com/slow",
      signal: controller.signal,
    });
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: "AbortError", cause: reason });
  });
});

function response<T>(data: T, config: RequestOptions): HttpResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  };
}
