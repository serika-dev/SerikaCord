"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback with a stable identity that always runs the latest `fn`, so a
 * memoized settings page does not re-render because the big dialog re-created
 * its handler. Only call the result from events, never during render.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableHandler<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  const stable = useCallback((...args: Parameters<T>): ReturnType<T> => ref.current(...args), []);
  return stable as unknown as T;
}
