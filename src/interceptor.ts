import type { InterceptorInput, InterceptorRejected } from "@/types.ts";

/**
 * 管理按注册顺序执行、可随时卸载的 Promise 拦截器链。
 *
 * @typeParam T - 成功链中传递和转换的值类型。
 * @typeParam E - 失败处理器接收的错误类型。
 * @remarks
 * 按注册顺序执行，并额外记录最近一次成功值作为 `rejected` 的第二个参数；
 * 当前拦截器的 `fulfilled` 抛错时也会交给同一拦截器的 `rejected`。
 */
export class InterceptorManager<T = unknown, E = unknown> {
  readonly #interceptors: InterceptorInput<T, E>[] = [];

  /**
   * 注册拦截器。
   *
   * @param interceptor - 要追加到链尾的拦截器或成功处理器。
   * @param rejected - `interceptor` 为函数时可选的失败处理器。
   * @returns 幂等卸载函数；多次调用不会抛错。
   */
  use(interceptor: InterceptorInput<T, E>, rejected?: InterceptorRejected<T, E>): () => void {
    const normalizedInterceptor =
      typeof interceptor === "function" && rejected
        ? { fulfilled: interceptor, rejected }
        : interceptor;
    this.#interceptors.push(normalizedInterceptor);
    return () => this.eject(normalizedInterceptor);
  }

  /**
   * 从后续执行链中移除指定拦截器。
   *
   * @param interceptor - 注册时传入的同一个对象引用。
   */
  eject(interceptor: InterceptorInput<T, E>): void {
    const index = this.#interceptors.indexOf(interceptor);
    if (index >= 0) this.#interceptors.splice(index, 1);
  }

  /**
   * 执行当前拦截器链。
   *
   * @param value - 初始值或产生初始值的 Promise。
   * @returns 最后一个拦截器处理后的值。
   * @throws 链中未被后续 rejected 处理器恢复的错误。
   */
  run(value: T | Promise<T>): Promise<T> {
    let latestValue: T | undefined;
    let chain = Promise.resolve(value).then((resolvedValue) => {
      latestValue = resolvedValue as T;
      return resolvedValue;
    }) as Promise<T>;

    for (const interceptor of this.#interceptors) {
      const rejected =
        typeof interceptor === "function" || !interceptor.rejected
          ? undefined
          : interceptor.rejected;
      const handlerRejected = async (error: E) => {
        if (!rejected) throw error;
        const recoveredValue = await rejected(error, latestValue);
        latestValue = recoveredValue;
        return recoveredValue;
      };
      chain = chain.then(async (currentValue) => {
        latestValue = currentValue;
        const fulfilled = typeof interceptor === "function" ? interceptor : interceptor.fulfilled;
        try {
          const nextValue = fulfilled ? await fulfilled(currentValue) : currentValue;
          latestValue = nextValue;
          return nextValue;
        } catch (error) {
          if (error instanceof Error === false) throw error;
          return handlerRejected(error as E);
        }
      }, handlerRejected) as Promise<T>;
    }
    return chain;
  }
}
