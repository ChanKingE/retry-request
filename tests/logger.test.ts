import {
  BusinessError,
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

class BusinessErrorAdapter implements HttpAdapter {
  async request<T>(): Promise<HttpResponse<T>> {
    throw new BusinessError("Rejected", "INVALID", { password: "secret" });
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

  test("redacts sensitive headers and omits bodies by default", async () => {
    const logger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger }));

    await client.post("/sessions", { password: "secret" }, {
      headers: {
        Authorization: "Bearer token",
        Cookie: "session=secret",
        "X-Api-Key": "key",
        "X-Trace-Id": "trace",
      },
    });

    expect(logger.debug).toHaveBeenNthCalledWith(
      1,
      "[Request] POST /sessions",
      expect.objectContaining({
        headers: {
          Authorization: "[REDACTED]",
          Cookie: "[REDACTED]",
          "X-Api-Key": "[REDACTED]",
          "X-Trace-Id": "trace",
        },
      }),
    );
    expect((logger.debug.mock.calls[0]?.[1] as Record<string, unknown>).data).toBeUndefined();
    expect(logger.debug).toHaveBeenNthCalledWith(2, "[Response] 200 /sessions", undefined);
  });

  test("allows body logging and additional header redaction per request", async () => {
    const logger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new StaticAdapter());
    client.use(createLoggerPlugin({ logger, logResponseBody: true }));

    await client.post("/sessions", { password: "secret" }, {
      headers: { "X-Tenant-Token": "tenant-secret" },
      logger: { logRequestBody: true, redactHeaders: ["x-tenant-token"] },
    });

    expect(logger.debug).toHaveBeenNthCalledWith(
      1,
      "[Request] POST /sessions",
      expect.objectContaining({
        data: { password: "secret" },
        headers: { "X-Tenant-Token": "[REDACTED]" },
      }),
    );
    expect(logger.debug).toHaveBeenNthCalledWith(2, "[Response] 200 /sessions", { ok: true });
  });

  test("does not log business error details unless response body logging is enabled", async () => {
    const logger = { debug: vi.fn(), error: vi.fn() };
    const client = new RequestClient(new BusinessErrorAdapter());
    client.use(createLoggerPlugin({ logger }));

    await expect(client.get("/sessions")).rejects.toBeInstanceOf(BusinessError);

    expect(logger.error).toHaveBeenCalledWith(
      "[Request error]",
      expect.not.objectContaining({ details: expect.anything() }),
    );
  });
});
