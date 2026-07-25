import { resolveURL } from "@/helpers.ts";
import { findMockRoute } from "./matcher.ts";
import type {
  MockPlugin,
  MockPluginOptions,
  MockRequestRecord,
  MockResponseFactory,
  MockRoute,
} from "./types.ts";
import { snapshotRequestConfig, waitForMockDelay } from "./utils.ts";

/**
 * 创建可短路真实网络请求的 Mock 插件。
 *
 * @param options - 路由和默认延迟配置。
 * @returns 可通过 `client.use` 安装的 Mock 插件。
 * @remarks 未匹配到 Mock 路由时返回 `undefined`，交由客户端继续调用真实适配器。
 *
 * @example
 * ```ts
 * const mock = createMockPlugin({
 *   routes: [
 *     {
 *       method: "GET",
 *       url: "/api/users/1",
 *       response: { id: "1", name: "Alice" },
 *     },
 *   ],
 * });
 * const removeMock = client.use(mock);
 * ```
 */
export function createMockPlugin(options: MockPluginOptions): MockPlugin {
  const history: MockRequestRecord[] = [];
  const consumedRoutes = new Set<MockRoute>();

  return {
    name: "mock",
    get history() {
      return history;
    },
    reset() {
      history.length = 0;
      consumedRoutes.clear();
    },
    setup(client) {
      return client.useRequestResolver(async (config) => {
        const route = await findMockRoute(
          options.routes,
          consumedRoutes,
          resolveURL(config.baseURL, config.url),
          config,
        );
        history.push({
          timestamp: Date.now(),
          config: snapshotRequestConfig(config),
          matched: route !== undefined,
          route,
        });

        if (!route) {
          // undefined 表示 Mock 未处理，请求客户端会继续调用真实 adapter。
          return undefined;
        }

        if (route.once) consumedRoutes.add(route);
        await waitForMockDelay(route.delay ?? options.delay ?? 0, config.signal);
        const data =
          typeof route.response === "function"
            ? await (route.response as MockResponseFactory)(config)
            : route.response;
        const status = route.status ?? 200;
        return {
          data,
          status,
          statusText: route.statusText ?? (status >= 400 ? "Mock Error" : "OK"),
          headers: { ...route.headers },
          config,
        };
      });
    },
  };
}
