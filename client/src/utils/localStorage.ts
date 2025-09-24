import { debug } from "@/utils/debug";

export const saveToLocalStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    debug.warn("Failed to save to localStorage", { error });
  }
};

export const loadFromLocalStorage = (key: string) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    debug.warn("Failed to load from localStorage", { error });
    return null;
  }
};
