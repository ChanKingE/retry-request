import {
  RequestClient,
  createDedupePlugin,
  type HttpAdapter,
  type HttpResponse,
  type RequestOptions,
} from "../src/index.ts";

class CountingAdapter implements HttpAdapter {
  readonly calls: RequestOptions[] = [];

  async request<T>(config: RequestOptions): Promise<HttpResponse<T>> {
    this.calls.push(config);
    return {
      data: { call: this.calls.length } as T,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createDedupePlugin", () => {
  test("reuses one request for the same URL and structured parameters", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter, { baseURL: "https://api.example.com" });
    client.use(createDedupePlugin({ cacheSettled: true }));
    let responseInterceptorCalls = 0;
    client.useResponseInterceptor({
      fulfilled(response) {
        responseInterceptorCalls += 1;
        return response;
      },
    });

    const first = client.request({
      url: "/users",
      method: "GET",
      params: { page: 1, filters: { enabled: true, role: "admin" } },
    });
    const second = client.request({
      url: "/users",
      method: "GET",
      params: { filters: { role: "admin", enabled: true }, page: 1 },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([{ call: 1 }, { call: 1 }]);
    await expect(
      client.request({
        url: "/users",
        method: "GET",
        params: { page: 1, filters: { role: "admin", enabled: true } },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
    expect(responseInterceptorCalls).toBe(3);
  });

  test("starts a new request after a custom window expires", async () => {
    vi.useFakeTimers();
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ windowMs: 500, cacheSettled: true }));

    await expect(client.get("/status", { params: { region: "cn" } })).resolves.toEqual({ call: 1 });
    await vi.advanceTimersByTimeAsync(499);
    await expect(client.get("/status", { params: { region: "cn" } })).resolves.toEqual({ call: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await expect(client.get("/status", { params: { region: "cn" } })).resolves.toEqual({ call: 2 });
    expect(adapter.calls).toHaveLength(2);
  });

  test("does not merge requests with a different method, URL, params, or data", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());

    await client.request({ url: "/items", method: "GET", params: { page: 1 } });
    await client.request({ url: "/items", method: "POST", params: { page: 1 } });
    await client.request({ url: "/other", method: "GET", params: { page: 1 } });
    await client.request({ url: "/items", method: "GET", params: { page: 2 } });
    await client.request({ url: "/items", method: "GET", params: { page: 1 }, data: { id: 1 } });

    expect(adapter.calls).toHaveLength(5);
  });

  test("does not reuse settled requests or dedupe writes by default", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());

    await client.get("/status");
    await client.get("/status");
    await client.post("/jobs", { id: 1 });
    await client.post("/jobs", { id: 1 });

    expect(adapter.calls).toHaveLength(4);
  });

  test("does not cache failed responses when settled caching is enabled", async () => {
    let calls = 0;
    const adapter: HttpAdapter = {
      async request<T>(config: RequestOptions): Promise<HttpResponse<T>> {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        return {
          data: { recovered: true } as T,
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      },
    };
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ cacheSettled: true }));

    await expect(client.get("/status")).rejects.toThrow("offline");
    await expect(client.get("/status")).resolves.toEqual({ recovered: true });
    expect(calls).toBe(2);
  });

  test("only dedupes writes with an explicit custom key", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ cacheSettled: true, createKey: () => "same-job" }));

    await client.post("/jobs", { id: 1 });
    await client.post("/jobs", { id: 1 });

    expect(adapter.calls).toHaveLength(1);
  });

  test("keeps requests with different authorization or credentials separate", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ cacheSettled: true }));

    await client.get("/profile", { headers: { Authorization: "Bearer first" } });
    await client.get("/profile", { headers: { Authorization: "Bearer second" } });
    await client.get("/profile", {
      headers: { Authorization: "Bearer first" },
      withCredentials: true,
    });

    expect(adapter.calls).toHaveLength(3);
  });

  test("supports a custom key and restores normal requests when uninstalled", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    const remove = client.use(
      createDedupePlugin({
        cacheSettled: true,
        createKey: (config) => String(config.headers?.["x-request-group"]),
      }),
    );

    await client.get("/first", { headers: { "x-request-group": "shared" } });
    await expect(
      client.get("/second", { headers: { "x-request-group": "shared" } }),
    ).resolves.toEqual({ call: 1 });
    remove();
    await expect(
      client.get("/second", { headers: { "x-request-group": "shared" } }),
    ).resolves.toEqual({ call: 2 });
  });

  test("uses request dedupe window before plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ windowMs: 5_000 }));

    await expect(
      client.get("/status", { dedupe: { windowMs: 0 } }),
    ).resolves.toEqual({ call: 1 });
    await expect(
      client.get("/status", { dedupe: { windowMs: 0 } }),
    ).resolves.toEqual({ call: 2 });
    expect(adapter.calls).toHaveLength(2);
  });

  test("uses request dedupe key before plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ cacheSettled: true, createKey: () => "plugin-key" }));

    await client.get("/first", {
      dedupe: { createKey: () => "request-key" },
    });
    await expect(
      client.get("/second", {
        dedupe: { createKey: () => "request-key" },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  test("uses request dedupe options before plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(
      createDedupePlugin({ windowMs: 5_000, cacheSettled: true, createKey: () => "plugin-key" }),
    );

    await client.get("/first", {
      dedupe: { createKey: () => "config-key" },
    });
    await expect(
      client.get("/second", {
        dedupe: { createKey: () => "config-key" },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  test("rejects invalid request dedupe windows", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());

    await expect(
      client.get("/status", { dedupe: { windowMs: Number.NaN } }),
    ).rejects.toThrow("windowMs must be between");
  });

  test("lets a duplicate caller stop waiting without aborting the shared request", async () => {
    let resolveRequest: ((response: HttpResponse) => void) | undefined;
    const adapter: HttpAdapter = {
      request<T>(_config: RequestOptions): Promise<HttpResponse<T>> {
        return new Promise((resolve) => {
          resolveRequest = (response) => resolve(response as HttpResponse<T>);
        });
      },
    };
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());
    const first = client.get("/slow");
    const controller = new AbortController();
    const duplicate = client.get("/slow", { signal: controller.signal });

    await vi.waitFor(() => expect(resolveRequest).toBeTypeOf("function"));
    controller.abort();
    await expect(duplicate).rejects.toMatchObject({ name: "AbortError" });
    resolveRequest?.({
      data: { done: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config: { url: "/slow" },
    });
    await expect(first).resolves.toEqual({ done: true });
  });

  test("rejects invalid windows", () => {
    expect(() => createDedupePlugin({ windowMs: -1 })).toThrow(RangeError);
    expect(() => createDedupePlugin({ windowMs: Number.NaN })).toThrow(RangeError);
  });
});
