import { describe, expect, test } from "vite-plus/test";
import {
  HttpError,
  NetworkError,
  TimeoutError,
  UniAppAdapter,
  type UniRequest,
  type UniRequestOptions,
} from "../src/index.ts";

describe("UniAppAdapter", () => {
  test("maps request config and normalizes a successful response", async () => {
    let received: UniRequestOptions | undefined;
    let abortCalls = 0;
    const request: UniRequest = (options) => {
      received = options;
      queueMicrotask(() => {
        options.success?.({
          data: { id: "1" },
          statusCode: 201,
          header: { "content-type": "application/json", "x-count": 2 },
          cookies: ["session=1"],
        });
      });
      return { abort: () => (abortCalls += 1) };
    };
    const adapter = new UniAppAdapter({
      request,
      dataType: "json",
      responseType: "arraybuffer",
      sslVerify: false,
    });

    const result = await adapter.request<{ id: string }>({
      url: "https://api.example.com/users?active=true",
      method: "POST",
      params: { role: ["admin", "owner"], empty: undefined },
      data: { name: "Alice" },
      headers: { authorization: "Bearer token" },
      timeout: 5_000,
      withCredentials: true,
    });

    expect(received).toMatchObject({
      url: "https://api.example.com/users?active=true&role=admin&role=owner",
      method: "POST",
      data: { name: "Alice" },
      header: { authorization: "Bearer token" },
      timeout: 5_000,
      dataType: "json",
      responseType: "arraybuffer",
      sslVerify: false,
      withCredentials: true,
    });
    expect(result).toEqual({
      data: { id: "1" },
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json", "x-count": "2" },
      config: expect.objectContaining({ method: "POST" }),
    });
    expect(abortCalls).toBe(0);
  });

  test("supports uni.request implementations that invoke success synchronously", async () => {
    let abortCalls = 0;
    const adapter = new UniAppAdapter({
      request(options) {
        options.success?.({ data: "ok", statusCode: 200 });
        return { abort: () => (abortCalls += 1) };
      },
    });

    await expect(adapter.request({ url: "/sync" })).resolves.toMatchObject({ data: "ok" });
    expect(abortCalls).toBe(0);
  });

  test("converts unsuccessful HTTP responses to HttpError", async () => {
    const adapter = new UniAppAdapter({
      request(options) {
        options.success?.({ data: { message: "missing" }, statusCode: 404 });
        return { abort() {} };
      },
    });

    const error = await adapter.request({ url: "/missing" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, message: "Not Found" });
  });

  test("maps timeout and network failures", async () => {
    const timeoutAdapter = new UniAppAdapter({
      request(options) {
        options.fail?.({ errMsg: "request:fail timeout", errno: 5 });
        return { abort() {} };
      },
    });
    const networkAdapter = new UniAppAdapter({
      request(options) {
        options.fail?.({ errMsg: "request:fail network unavailable" });
        return { abort() {} };
      },
    });

    await expect(timeoutAdapter.request({ url: "/timeout" })).rejects.toBeInstanceOf(TimeoutError);
    await expect(networkAdapter.request({ url: "/network" })).rejects.toBeInstanceOf(NetworkError);
  });

  test("aborts RequestTask when the external signal is aborted", async () => {
    let abortCalls = 0;
    const adapter = new UniAppAdapter({
      request() {
        return { abort: () => (abortCalls += 1) };
      },
    });
    const controller = new AbortController();
    const result = adapter.request({ url: "/slow", signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(abortCalls).toBe(1);
  });

  test("enforces timeout locally and aborts RequestTask", async () => {
    let abortCalls = 0;
    const adapter = new UniAppAdapter({
      request() {
        return { abort: () => (abortCalls += 1) };
      },
    });

    await expect(adapter.request({ url: "/slow", timeout: 5 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(abortCalls).toBe(1);
  });

  test("converts synchronous uni.request failures to NetworkError", async () => {
    const adapter = new UniAppAdapter({
      request() {
        throw new Error("runtime unavailable");
      },
    });

    const error = await adapter.request({ url: "/sync-error" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).cause).toMatchObject({ message: "runtime unavailable" });
  });

  test("passes through UniApp platform options while keeping adapter callbacks controlled", async () => {
    let received: UniRequestOptions | undefined;
    const adapter = new UniAppAdapter({
      requestOptions: {
        dataType: "text",
        responseType: "arraybuffer",
        sslVerify: false,
        firstIpv4: true,
        enableHttp2: true,
        enableQuic: true,
        enableCache: true,
        enableHttpDNS: true,
        httpDNSServiceId: "dns-service",
        enableChunked: true,
        forceCellularNetwork: true,
        enableCookie: true,
        cloudCache: { maxAge: 60 },
        defer: true,
      },
      request(options) {
        received = options;
        options.success?.({ data: "ok", statusCode: 200, header: "ignored" });
        options.complete?.({ errMsg: "request:ok" });
        return {
          abort() {},
          onHeadersReceived() {},
          offHeadersReceived() {},
        };
      },
    });

    await expect(
      adapter.request({
        url: "/platform",
        data: "raw-body",
        headers: { "content-type": "text/plain" },
      }),
    ).resolves.toMatchObject({ data: "ok", headers: {} });
    expect(received).toMatchObject({
      url: "/platform",
      data: "raw-body",
      header: { "content-type": "text/plain" },
      method: "GET",
      dataType: "text",
      responseType: "arraybuffer",
      sslVerify: false,
      firstIpv4: true,
      enableHttp2: true,
      enableQuic: true,
      enableCache: true,
      enableHttpDNS: true,
      httpDNSServiceId: "dns-service",
      enableChunked: true,
      forceCellularNetwork: true,
      enableCookie: true,
      cloudCache: { maxAge: 60 },
      defer: true,
    });
    expect(received?.success).toEqual(expect.any(Function));
    expect(received?.fail).toEqual(expect.any(Function));
    expect(received?.complete).toEqual(expect.any(Function));
  });
});
