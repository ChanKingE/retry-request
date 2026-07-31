import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  RequestClient,
  createDedupePlugin,
  type HttpAdapter,
  type HttpResponse,
  type RequestConfig,
} from "../src/index.ts";

class CountingAdapter implements HttpAdapter {
  readonly calls: RequestConfig[] = [];

  async request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
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
    client.use(createDedupePlugin());
    let responseInterceptorCalls = 0;
    client.useResponseInterceptor({
      fulfilled(response) {
        responseInterceptorCalls += 1;
        return response;
      },
    });

    const first = client.request({
      url: "/users",
      method: "POST",
      params: { page: 1, filters: { enabled: true, role: "admin" } },
      data: { name: "Ada", tags: ["owner", "admin"] },
    });
    const second = client.request({
      url: "/users",
      method: "POST",
      params: { filters: { role: "admin", enabled: true }, page: 1 },
      data: { tags: ["owner", "admin"], name: "Ada" },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([{ call: 1 }, { call: 1 }]);
    await expect(
      client.request({
        url: "/users",
        method: "POST",
        params: { page: 1, filters: { role: "admin", enabled: true } },
        data: { name: "Ada", tags: ["owner", "admin"] },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
    expect(responseInterceptorCalls).toBe(3);
  });

  test("starts a new request after a custom window expires", async () => {
    vi.useFakeTimers();
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ windowMs: 500 }));

    await expect(client.get("/status", { region: "cn" })).resolves.toEqual({ call: 1 });
    await vi.advanceTimersByTimeAsync(499);
    await expect(client.get("/status", { region: "cn" })).resolves.toEqual({ call: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await expect(client.get("/status", { region: "cn" })).resolves.toEqual({ call: 2 });
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

  test("supports a custom key and restores normal requests when uninstalled", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    const remove = client.use(
      createDedupePlugin({ createKey: (config) => String(config.meta?.requestGroup) }),
    );

    await client.get("/first", undefined, { meta: { requestGroup: "shared" } });
    await expect(
      client.get("/second", undefined, { meta: { requestGroup: "shared" } }),
    ).resolves.toEqual({ call: 1 });
    remove();
    await expect(
      client.get("/second", undefined, { meta: { requestGroup: "shared" } }),
    ).resolves.toEqual({ call: 2 });
  });

  test("uses request meta dedupe window before plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ windowMs: 5_000 }));

    await expect(
      client.get("/status", undefined, { meta: { dedupe: { windowMs: 0 } } }),
    ).resolves.toEqual({ call: 1 });
    await expect(
      client.get("/status", undefined, { meta: { dedupe: { windowMs: 0 } } }),
    ).resolves.toEqual({ call: 2 });
    expect(adapter.calls).toHaveLength(2);
  });

  test("uses request meta dedupe key before plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ createKey: () => "plugin-key" }));

    await client.get("/first", undefined, {
      meta: { dedupe: { createKey: () => "request-key" } },
    });
    await expect(
      client.get("/second", undefined, {
        meta: { dedupe: { createKey: () => "request-key" } },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  test("uses request dedupe field before request meta and plugin options", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin({ windowMs: 5_000, createKey: () => "plugin-key" }));

    await client.get("/first", undefined, {
      dedupe: { createKey: () => "config-key" },
      meta: { dedupe: { windowMs: 0, createKey: () => "meta-key" } },
    });
    await expect(
      client.get("/second", undefined, {
        dedupe: { createKey: () => "config-key" },
        meta: { dedupe: { windowMs: 0, createKey: () => "meta-key" } },
      }),
    ).resolves.toEqual({ call: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  test("rejects invalid request meta dedupe windows", async () => {
    const adapter = new CountingAdapter();
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());

    await expect(
      client.get("/status", undefined, { meta: { dedupe: { windowMs: Number.NaN } } }),
    ).rejects.toThrow("windowMs must be between");
  });

  test("lets a duplicate caller stop waiting without aborting the shared request", async () => {
    let resolveRequest: ((response: HttpResponse) => void) | undefined;
    const adapter: HttpAdapter = {
      request<T>(_config: RequestConfig): Promise<HttpResponse<T>> {
        return new Promise((resolve) => {
          resolveRequest = (response) => resolve(response as HttpResponse<T>);
        });
      },
    };
    const client = new RequestClient(adapter);
    client.use(createDedupePlugin());
    const first = client.get("/slow");
    const controller = new AbortController();
    const duplicate = client.get("/slow", undefined, { signal: controller.signal });

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
