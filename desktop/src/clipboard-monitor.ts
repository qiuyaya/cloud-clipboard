import { DesktopAPI } from './desktop-api';

export class ClipboardMonitor {
  private intervalId: number | null = null;
  private lastClipboardText = '';
  private onClipboardChange?: (text: string) => void;

  constructor(onClipboardChange?: (text: string) => void) {
    this.onClipboardChange = onClipboardChange;
  }

  async start(intervalMs: number = 1000) {
    if (!DesktopAPI.isDesktop()) {
      console.warn('Clipboard monitoring is only available in desktop app');
      return;
    }

    this.stop();

    // Get initial clipboard content
    try {
      this.lastClipboardText = await DesktopAPI.getClipboardText();
    } catch (error) {
      console.error('Failed to get initial clipboard text:', error);
    }

    this.intervalId = window.setInterval(async () => {
      try {
        const currentText = await DesktopAPI.getClipboardText();
        if (currentText !== this.lastClipboardText) {
          this.lastClipboardText = currentText;
          if (this.onClipboardChange) {
            this.onClipboardChange(currentText);
          }
        }
      } catch (error) {
        console.error('Failed to monitor clipboard:', error);
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async writeText(text: string) {
    if (DesktopAPI.isDesktop()) {
      await DesktopAPI.setClipboardText(text);
      this.lastClipboardText = text;
    } else {
      // Fallback for web
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    }
  }
}