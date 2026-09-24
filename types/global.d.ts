declare global {
  /**
   * 从类型中提取必填的字段。
   */
  type RequiredPick<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
  /**
   * 递归地将类型中的所有字段设置为必填。
   */
  type DeepRequired<T> = {
    [K in keyof T]-?: T[K] extends object ? DeepRequired<T[K]> : T[K];
  };
  /**
   * 从类型中提取可选的字段。
   */
  type PartialPick<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
  /**
   * 递归地将类型中的所有字段设置为可选。
   */
  type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
  };
}

export {};
