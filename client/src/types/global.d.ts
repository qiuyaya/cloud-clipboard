/// <reference types="vitest" />
/// <reference types="vite/client" />

// 类型声明用于测试环境
declare global {
  const global: typeof globalThis;
  const process: NodeJS.Process;
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: "development" | "production" | "test";
    }
  }
}

// PWA 模块类型声明
declare module "virtual:pwa-register/react" {
  export function useRegisterSW(): {
    offlineReady: [boolean, (ready: boolean) => void];
    needRefresh: [boolean, (refresh: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  };
}

// 忽略 Vite 虚拟模块的类型错误
declare module "virtual:*" {
  const value: any;
  export default value;
}

export {};
