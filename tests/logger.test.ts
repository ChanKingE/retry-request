import {
  RequestClient,
  createLoggerPlugin,
  type HttpAdapter,
  type HttpResponse,
  type RequestOptions,
} from "../src/index.ts";

class StaticAdapter implements HttpAdapter {
  async request<T>(config: RequestOptions): Promise<HttpResponse<T>> {
    return {
      data: { ok: true } as T,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }
}

describe("createLoggerPlugin", () => {
  test("uses request logger before plugin logger", async () => {
    const pluginLogger = { debug: vi.fn(), error: vi.fn() };
    const requestLogger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger: pluginLogger }));

    await expect(
      client.get("/status", { logger: { logger: requestLogger } }),
    ).resolves.toEqual({ ok: true });

    expect(requestLogger.debug).toHaveBeenCalledTimes(2);
    expect(pluginLogger.debug).not.toHaveBeenCalled();
  });

  test("uses plugin logger when a request logger is absent", async () => {
    const pluginLogger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger: pluginLogger }));

    await expect(client.get("/status")).resolves.toEqual({ ok: true });

    expect(pluginLogger.debug).toHaveBeenCalledTimes(2);
  });
});
