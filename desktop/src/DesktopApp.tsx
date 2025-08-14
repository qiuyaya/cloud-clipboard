import React, { useEffect, useState } from 'react';
import { DesktopProvider, useDesktop } from './desktop-integration';
import { DesktopSettings } from './components/DesktopSettings';
import { ClipboardMonitor } from './clipboard-monitor';

// Import the original web app components
// Note: These will need to be copied or symlinked from the client directory
interface DesktopAppProps {
  WebApp: React.ComponentType<any>;
}

const DesktopAppContent: React.FC<DesktopAppProps> = ({ WebApp }) => {
  const { config, showNotification, clipboardMonitor, isDesktop } = useDesktop();
  const [showSettings, setShowSettings] = useState(false);
  const [lastClipboardContent, setLastClipboardContent] = useState<string>('');

  // Handle clipboard changes when running in desktop mode
  const handleClipboardChange = async (text: string) => {
    if (!config?.auto_clipboard || !text || text === lastClipboardContent) {
      return;
    }

    setLastClipboardContent(text);
    
    // Show notification
    await showNotification(
      '剪切板同步',
      `检测到新的剪切板内容：${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`
    );

    // Here you would integrate with your existing message sending logic
    // For now, we'll just log it
    console.log('New clipboard content:', text);
    
    // In a real implementation, you would:
    // 1. Check if user is in a room
    // 2. Send the clipboard content as a message
    // 3. Update the UI accordingly
  };

  // Keyboard shortcuts for desktop
  useEffect(() => {
    if (!isDesktop) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + , to open settings
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setShowSettings(!showSettings);
      }
      
      // Escape to close settings
      if (event.key === 'Escape' && showSettings) {
        setShowSettings(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDesktop, showSettings]);

  if (showSettings) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="relative">
          <button
            onClick={() => setShowSettings(false)}
            className="absolute -top-2 -right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
          >
            ×
          </button>
          <DesktopSettings />
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Settings button for desktop */}
      {isDesktop && (
        <button
          onClick={() => setShowSettings(true)}
          className="fixed top-4 right-4 z-50 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 shadow-lg"
          title="设置 (Ctrl+,)"
        >
          ⚙️
        </button>
      )}
      
      {/* The original web app */}
      <WebApp />
    </div>
  );
};

export const DesktopApp: React.FC<DesktopAppProps> = ({ WebApp }) => {
  const handleClipboardChange = (text: string) => {
    console.log('Clipboard changed:', text);
    // This will be handled inside DesktopAppContent
  };

  return (
    <DesktopProvider onClipboardChange={handleClipboardChange}>
      <DesktopAppContent WebApp={WebApp} />
    </DesktopProvider>
  );
};