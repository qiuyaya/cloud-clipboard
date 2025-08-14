import { invoke } from '@tauri-apps/api/core';

export interface AppConfig {
  server_url: string;
  auto_clipboard: boolean;
  sync_interval: number;
  theme: string;
  language: string;
  enable_tray: boolean;
  autostart: boolean;
}

export class DesktopAPI {
  static async getConfig(): Promise<AppConfig> {
    return await invoke('get_config');
  }

  static async setConfig(config: AppConfig): Promise<void> {
    return await invoke('set_config', { config });
  }

  static async getClipboardText(): Promise<string> {
    return await invoke('get_clipboard_text');
  }

  static async setClipboardText(text: string): Promise<void> {
    return await invoke('set_clipboard_text', { text });
  }

  static async showNotification(title: string, body: string): Promise<void> {
    return await invoke('show_notification', { title, body });
  }

  static isDesktop(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }
}