// Minimal type declarations for `bun:test`, so `tsc --noEmit` typechecks the
// test files without adding @types/bun to the app. Bun itself ignores this
// file. It covers what the tests use today: add a matcher here when a test
// needs one (or delete this file if @types/bun is ever installed).

declare module "bun:test" {
  interface Matchers {
    not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toMatchObject(expected: object): void;
    toBeTrue(): void;
    toBeFalse(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toContain(expected: unknown): void;
    toHaveLength(length: number): void;
    toBeGreaterThan(expected: number | bigint): void;
    toBeLessThan(expected: number | bigint): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: unknown): void;
  }

  type TestFn = () => void | Promise<unknown>;

  interface TestApi {
    (name: string, fn: TestFn, timeoutMs?: number): void;
    skip(name: string, fn: TestFn): void;
    only(name: string, fn: TestFn): void;
    todo(name: string, fn?: TestFn): void;
  }

  export function expect(actual: unknown): Matchers;
  export const test: TestApi;
  export const it: TestApi;
  export function describe(name: string, fn: () => void): void;
  export function beforeAll(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}
