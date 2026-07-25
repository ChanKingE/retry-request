import type { HttpMethod, RequestConfig } from "@/types.ts";
import type { MockRoute, MockUrlMatcher } from "./types.ts";

/**
 * 按声明顺序查找第一条可用的 Mock 路由。
 *
 * @param routes - 待匹配的全部路由。
 * @param consumedRoutes - 已被 `once` 消费的路由集合。
 * @param url - 已与 baseURL 合并的最终请求地址。
 * @param config - 请求拦截器处理后的配置。
 * @returns 第一条匹配路由；没有匹配项时返回 `undefined`。
 */
export async function findMockRoute(
  routes: readonly MockRoute[],
  consumedRoutes: ReadonlySet<MockRoute>,
  url: string,
  config: RequestConfig,
): Promise<MockRoute | undefined> {
  for (const route of routes) {
    if (consumedRoutes.has(route) || !matchesMethod(route, config.method ?? "GET")) continue;
    if (await matchesUrl(route.url, url, config)) return route;
  }
  return undefined;
}

function matchesMethod(route: MockRoute, method: HttpMethod): boolean {
  if (route.method === undefined) return true;
  return Array.isArray(route.method) ? route.method.includes(method) : route.method === method;
}

async function matchesUrl(
  matcher: MockUrlMatcher,
  url: string,
  config: RequestConfig,
): Promise<boolean> {
  if (typeof matcher === "string") return matcher === url;
  if (typeof matcher === "function") return matcher(url, config);
  matcher.lastIndex = 0;
  return matcher.test(url);
}
