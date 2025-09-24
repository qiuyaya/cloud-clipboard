declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: (done?: () => void) => void | Promise<void>): void;
  export function test(name: string, fn: (done?: () => void) => void | Promise<void>): void;
  export function expect(actual: any): {
    toBe(expected: any): void;
    toEqual(expected: any): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toHaveLength(expected: number): void;
    toHaveProperty(property: string, value?: any): void;
    toMatchObject(expected: any): void;
    toBeNull(): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: any[]): void;
    toHaveBeenCalledTimes(times: number): void;
    not: {
      toBe(expected: any): void;
      toEqual(expected: any): void;
      toThrow(): void;
      toBeUndefined(): void;
      toBeDefined(): void;
      toHaveBeenCalled(): void;
    };
  };

  export const expect: {
    (actual: any): {
      toBe(expected: any): void;
      toEqual(expected: any): void;
      toMatch(expected: string | RegExp): void;
      toThrow(expected?: string | RegExp): void;
      toBeUndefined(): void;
      toBeDefined(): void;
      toHaveLength(expected: number): void;
      toHaveProperty(property: string, value?: any): void;
      toMatchObject(expected: any): void;
      toBeNull(): void;
      toHaveBeenCalled(): void;
      toHaveBeenCalledWith(...args: any[]): void;
      toHaveBeenCalledTimes(times: number): void;
      not: {
        toBe(expected: any): void;
        toEqual(expected: any): void;
        toThrow(): void;
        toBeUndefined(): void;
        toBeDefined(): void;
        toHaveBeenCalled(): void;
      };
    };
    objectContaining(obj: any): any;
    arrayContaining(arr: any[]): any;
    any(constructor: any): any;
    stringMatching(pattern: string | RegExp): any;
  };
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function spyOn(
    object: any,
    method: string,
  ): {
    mockReturnValue(value: any): any;
    mockImplementation(fn: (...args: any[]) => any): any;
    mockRejectedValue(value: any): any;
    mockResolvedValue(value: any): any;
  };
  export const jest: {
    fn(): any;
    mocked<T>(item: T): T;
    spyOn(object: any, method: string): any;
    mock(moduleName: string, factory?: () => any): void;
    clearAllMocks(): void;
    restoreAllMocks(): void;
  };
}
