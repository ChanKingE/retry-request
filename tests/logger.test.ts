import { describe, expect, test, vi } from "vite-plus/test";
import {
  RequestClient,
  createLoggerPlugin,
  type HttpAdapter,
  type HttpResponse,
  type RequestConfig,
} from "../src/index.ts";

class StaticAdapter implements HttpAdapter {
  async request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
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
  test("uses request meta logger before plugin logger", async () => {
    const pluginLogger = { debug: vi.fn(), error: vi.fn() };
    const requestLogger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger: pluginLogger }));

    await expect(
      client.get("/status", { meta: { logger: { logger: requestLogger } } }),
    ).resolves.toEqual({ ok: true });

    expect(requestLogger.debug).toHaveBeenCalledTimes(2);
    expect(pluginLogger.debug).not.toHaveBeenCalled();
  });

  test("uses request logger before request meta and plugin logger", async () => {
    const pluginLogger = { debug: vi.fn(), error: vi.fn() };
    const metaLogger = { debug: vi.fn(), error: vi.fn() };
    const requestLogger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger: pluginLogger }));

    await expect(
      client.get("/status", {
        logger: { logger: requestLogger },
        meta: { logger: { logger: metaLogger } },
      }),
    ).resolves.toEqual({ ok: true });

    expect(requestLogger.debug).toHaveBeenCalledTimes(2);
    expect(metaLogger.debug).not.toHaveBeenCalled();
    expect(pluginLogger.debug).not.toHaveBeenCalled();
  });

  test("uses plugin logger when request meta logger is absent", async () => {
    const pluginLogger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger: pluginLogger }));

    await expect(client.get("/status")).resolves.toEqual({ ok: true });

    expect(pluginLogger.debug).toHaveBeenCalledTimes(2);
  });
});
