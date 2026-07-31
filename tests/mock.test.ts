import { describe, expect, test } from "vite-plus/test";
import {
  RequestClient,
  createMockPlugin,
  type HttpAdapter,
  type HttpResponse,
  type RequestConfig,
} from "../src/index.ts";

class RecordingAdapter implements HttpAdapter {
  readonly calls: RequestConfig[] = [];

  async request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
    this.calls.push(config);
    return {
      data: { source: "network" } as T,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }
}

describe("createMockPlugin", () => {
  test("short-circuits the adapter and supports async response factories", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter, { baseURL: "https://api.example.com" });
    const mock = createMockPlugin({
      routes: [
        {
          method: "POST",
          url: /^https:\/\/api\.example\.com\/users$/,
          response: async (config) => ({ created: config.data }),
          status: 201,
          headers: { "x-mock": "true" },
        },
      ],
    });
    client.use(mock);

    await expect(client.post("/users", { name: "Alice" })).resolves.toEqual({
      created: { name: "Alice" },
    });
    expect(adapter.calls).toHaveLength(0);
    expect(mock.history).toHaveLength(1);
    expect(mock.history[0]).toMatchObject({ matched: true });
  });

  test("uses request meta mock response before route matching", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [{ url: "/route-only", response: { source: "route" } }],
    });
    client.use(mock);

    await expect(
      client.post(
        "/users",
        { name: "Alice" },
        {
          meta: {
            mock: {
              code: 0,
              message: "你好",
              data: [{ id: "Route000210" }, { id: "Route000211" }],
            },
          },
        },
      ),
    ).resolves.toEqual({
      code: 0,
      message: "你好",
      data: [{ id: "Route000210" }, { id: "Route000211" }],
    });
    expect(adapter.calls).toHaveLength(0);
    expect(mock.history[0]).toMatchObject({ matched: true, route: undefined });
  });

  test("uses request meta mock route before route matching", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [{ url: "/route-only", response: { source: "route" } }],
    });
    client.use(mock);

    await expect(
      client.get("/users", {
        meta: {
          mock: {
            url: "/not-used-for-matching",
            response: { source: "meta-route" },
            status: 201,
            headers: { "x-meta-mock": "true" },
          },
        },
      }),
    ).resolves.toEqual({ source: "meta-route" });
    expect(adapter.calls).toHaveLength(0);
    expect(mock.history[0]).toMatchObject({
      matched: true,
      route: {
        response: { source: "meta-route" },
        status: 201,
        headers: { "x-meta-mock": "true" },
      },
    });
  });

  test("uses request mock field before request meta mock", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [{ url: "/route-only", response: { source: "route" } }],
    });
    client.use(mock);

    await expect(
      client.get("/users", {
        mock: {
          url: "/not-used-for-matching",
          response: { source: "config-mock" },
          status: 201,
        },
        meta: {
          mock: { source: "meta-mock" },
        },
      }),
    ).resolves.toEqual({ source: "config-mock" });
    expect(adapter.calls).toHaveLength(0);
    expect(mock.history[0]).toMatchObject({
      matched: true,
      route: {
        response: { source: "config-mock" },
        status: 201,
      },
    });
  });

  test("uses request meta mock factory with final config", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter, { baseURL: "https://api.example.com" });
    const mock = createMockPlugin({ routes: [] });
    client.use(mock);

    await expect(
      client.get("/users", {
        params: { page: 1 },
        meta: {
          mock: (config: RequestConfig) => ({
            url: config.url,
            params: config.params,
          }),
        },
      }),
    ).resolves.toEqual({
      url: "https://api.example.com/users",
      params: { page: 1 },
    });
    expect(adapter.calls).toHaveLength(0);
    expect(mock.history[0]).toMatchObject({ matched: true, route: undefined });
  });

  test("always passes unmatched requests through to the adapter", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [{ method: "GET", url: "/mocked", response: { mocked: true } }],
    });
    client.use(mock);

    await expect(client.get("/real")).resolves.toEqual({ source: "network" });
    expect(adapter.calls).toHaveLength(1);
    expect(mock.history[0]).toMatchObject({ matched: false });
  });

  test("consumes once routes and restores them when reset", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [{ url: "/once", response: { source: "mock" }, once: true }],
    });
    client.use(mock);

    await expect(client.get("/once")).resolves.toEqual({ source: "mock" });
    await expect(client.get("/once")).resolves.toEqual({ source: "network" });
    expect(mock.history).toHaveLength(2);

    mock.reset();
    expect(mock.history).toHaveLength(0);
    await expect(client.get("/once")).resolves.toEqual({ source: "mock" });
    expect(adapter.calls).toHaveLength(1);
  });

  test("supports custom URL matchers and multiple methods", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      routes: [
        {
          method: ["GET", "DELETE"],
          url: async (url, config) => url.startsWith("/items/") && config.meta?.mock === true,
          response: { ok: true },
        },
      ],
    });
    client.use(mock);

    await expect(client.delete("/items/1", { meta: { mock: true } })).resolves.toEqual({
      ok: true,
    });
    expect(adapter.calls).toHaveLength(0);
  });

  test("aborts while waiting for a delayed response", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({
      delay: 1_000,
      routes: [{ url: "/slow", response: { ok: true } }],
    });
    client.use(mock);
    const controller = new AbortController();
    const result = client.get("/slow", { signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.calls).toHaveLength(0);
  });

  test("uninstalling the plugin restores the real adapter", async () => {
    const adapter = new RecordingAdapter();
    const client = new RequestClient(adapter);
    const mock = createMockPlugin({ routes: [{ url: "/users", response: [] }] });
    const remove = client.use(mock);
    remove();

    await expect(client.get("/users")).resolves.toEqual({ source: "network" });
    expect(adapter.calls).toHaveLength(1);
  });
});
