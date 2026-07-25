import { describe, expect, test } from "vite-plus/test";
import {
  AxiosAdapter,
  HttpError,
  NetworkError,
  TimeoutError,
  type AxiosInstanceLike,
  type AxiosRequestConfigLike,
} from "../src/index.ts";

describe("AxiosAdapter", () => {
  test("inherits baseURL from Axios instance defaults", async () => {
    let received: AxiosRequestConfigLike | undefined;
    const instance: AxiosInstanceLike = {
      defaults: { baseURL: "https://api.example.com" },
      async request<T>(config: AxiosRequestConfigLike) {
        received = config;
        return { data: undefined as T, status: 204, statusText: "No Content", headers: {} };
      },
    };

    await new AxiosAdapter(instance).request({ url: "/users" });

    expect(received?.baseURL).toBe("https://api.example.com");
  });

  test("keeps an explicit request baseURL override", async () => {
    let received: AxiosRequestConfigLike | undefined;
    const instance: AxiosInstanceLike = {
      defaults: { baseURL: "https://api.example.com" },
      async request<T>(config: AxiosRequestConfigLike) {
        received = config;
        return { data: undefined as T, status: 204, statusText: "No Content", headers: {} };
      },
    };

    await new AxiosAdapter(instance).request({ url: "/health", baseURL: "" });

    expect(received?.baseURL).toBe("");
  });

  test("inherits baseURL from adapter requestConfig before Axios defaults", async () => {
    let received: AxiosRequestConfigLike | undefined;
    const instance: AxiosInstanceLike = {
      defaults: { baseURL: "https://api.example.com" },
      async request<T>(config: AxiosRequestConfigLike) {
        received = config;
        return { data: undefined as T, status: 204, statusText: "No Content", headers: {} };
      },
    };

    await new AxiosAdapter(instance, {
      requestConfig: { baseURL: "https://adapter.example.com" },
    }).request({ url: "/health" });

    expect(received?.baseURL).toBe("https://adapter.example.com");
  });

  test("maps request config and normalizes AxiosHeaders", async () => {
    let received: (AxiosRequestConfigLike & Record<string, unknown>) | undefined;
    const instance: AxiosInstanceLike = {
      async request<T>(config: AxiosRequestConfigLike) {
        received = config as AxiosRequestConfigLike & Record<string, unknown>;
        return {
          data: { id: "1" } as T,
          status: 201,
          statusText: "Created",
          headers: {
            toJSON: () => ({ "content-type": "application/json", "set-cookie": ["a=1", "b=2"] }),
          },
        };
      },
    };
    const adapter = new AxiosAdapter(instance, {
      requestConfig: { responseType: "json", timeout: 1 },
    });
    const controller = new AbortController();

    const result = await adapter.request<{ id: string }>({
      url: "/users",
      method: "POST",
      params: { active: true },
      data: { name: "Alice" },
      headers: { authorization: "Bearer token" },
      timeout: 5_000,
      withCredentials: true,
      signal: controller.signal,
    });

    expect(received).toMatchObject({
      url: "/users",
      method: "POST",
      params: { active: true },
      data: { name: "Alice" },
      headers: { authorization: "Bearer token" },
      timeout: 5_000,
      withCredentials: true,
      signal: controller.signal,
      responseType: "json",
    });
    expect(result).toEqual({
      data: { id: "1" },
      status: 201,
      statusText: "Created",
      headers: {
        "content-type": "application/json",
        "set-cookie": "a=1, b=2",
      },
      config: expect.objectContaining({ url: "/users" }),
    });
  });

  test("converts resolved HTTP error responses to HttpError", async () => {
    const instance: AxiosInstanceLike = {
      async request<T>() {
        return { data: { message: "failed" } as T, status: 503, statusText: "", headers: {} };
      },
    };
    const adapter = new AxiosAdapter(instance);

    const error = await adapter.request({ url: "/health" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503, message: "HTTP 503" });
  });

  test("converts rejected Axios responses to HttpError", async () => {
    const instance: AxiosInstanceLike = {
      async request() {
        throw Object.assign(new Error("Request failed with status code 404"), {
          isAxiosError: true,
          response: {
            data: { message: "missing" },
            status: 404,
            statusText: "Not Found",
            headers: { "x-error": "missing" },
          },
        });
      },
    };
    const adapter = new AxiosAdapter(instance);

    const error = await adapter.request({ url: "/missing" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, message: "Request failed with status code 404" });
    expect((error as HttpError).response).toMatchObject({
      data: { message: "missing" },
      headers: { "x-error": "missing" },
    });
  });

  test("maps Axios timeout codes to TimeoutError", async () => {
    const instance: AxiosInstanceLike = {
      async request() {
        throw Object.assign(new Error("timeout of 5000ms exceeded"), {
          code: "ECONNABORTED",
          isAxiosError: true,
        });
      },
    };

    await expect(new AxiosAdapter(instance).request({ url: "/slow" })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  test("preserves cancellation as AbortError", async () => {
    const instance: AxiosInstanceLike = {
      async request() {
        throw Object.assign(new Error("canceled"), {
          name: "CanceledError",
          code: "ERR_CANCELED",
        });
      },
    };

    await expect(new AxiosAdapter(instance).request({ url: "/cancel" })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("does not call Axios when the signal is already aborted", async () => {
    let calls = 0;
    const instance: AxiosInstanceLike = {
      async request<T>() {
        calls += 1;
        return { data: undefined as T, status: 200, statusText: "OK", headers: {} };
      },
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      new AxiosAdapter(instance).request({ url: "/cancel", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  test("maps requests without responses to NetworkError", async () => {
    const instance: AxiosInstanceLike = {
      async request() {
        throw Object.assign(new Error("Network Error"), { isAxiosError: true });
      },
    };

    await expect(new AxiosAdapter(instance).request({ url: "/offline" })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
