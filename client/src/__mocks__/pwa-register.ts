// Mock PWA register for desktop and test environments
export function useRegisterSW() {
  return {
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: () => {},
  };
}
