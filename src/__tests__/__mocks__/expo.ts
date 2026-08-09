// Stand-in for the `expo` package's native module registry.
//
// `requireOptionalNativeModule` is resolved at import time by the module under
// test, so a test that wants a different answer has to register it and then
// re-import (jest.isolateModules / resetModules).
//
// The registry hangs off the global because re-importing hands out a fresh copy
// of *this* file too - a module-local object would leave the test writing to
// one registry and the code under test reading from another.
const globalRegistry = globalThis as unknown as {
  __expoNativeModules?: Record<string, unknown>;
};
globalRegistry.__expoNativeModules ??= {};
const registry = globalRegistry.__expoNativeModules;

export function __setNativeModule(name: string, module: unknown): void {
  registry[name] = module;
}

export function __clearNativeModules(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}

export function requireOptionalNativeModule<T>(name: string): T | null {
  return (registry[name] as T) ?? null;
}
