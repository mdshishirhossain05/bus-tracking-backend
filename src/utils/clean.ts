export function cleanUndefined<T extends Record<string, any>>(obj: T) {
  // removes keys with value === undefined
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<
      T[K],
      undefined
    >;
  };
}
