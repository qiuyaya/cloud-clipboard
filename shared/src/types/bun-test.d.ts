declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: any): {
    toBe(expected: any): void;
    toEqual(expected: any): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toHaveLength(expected: number): void;
    toHaveProperty(property: string, value?: any): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    not: {
      toBe(expected: any): void;
      toEqual(expected: any): void;
      toThrow(): void;
      toBeUndefined(): void;
      toBeDefined(): void;
    };
  };
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const jest: {
    fn(): any;
    mocked<T>(item: T): T;
    spyOn(object: any, method: string): any;
  };
}
