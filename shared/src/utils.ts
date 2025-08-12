import { User } from './types';

export const generateUserId = (): string => {
  return crypto.randomUUID();
};

export const generateRoomKey = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const detectDeviceType = (userAgent: string): User['deviceType'] => {
  const ua = userAgent.toLowerCase();
  
  if (/mobile|android|iphone|ipad|phone|tablet/i.test(ua)) {
    if (/tablet|ipad/i.test(ua)) {
      return 'tablet';
    }
    return 'mobile';
  }
  
  if (/desktop|windows|mac|linux/i.test(ua)) {
    return 'desktop';
  }
  
  return 'unknown';
};

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex > 0 ? 2 : 0)} ${units[unitIndex]}`;
};

export const isValidRoomKey = (key: string): boolean => {
  return key.length >= 1 && key.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(key);
};

export const sanitizeFileName = (fileName: string): string => {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
};

export const formatTimestamp = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  // Check if the date is valid
  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }
  
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dateObj);
};

// Browser fingerprinting utilities (client-side only)
export const generateBrowserFingerprint = (): import('./types').BrowserFingerprint => {
  if (typeof globalThis === 'undefined' || !(globalThis as any).window) {
    // Server-side fallback
    return {
      userAgent: '',
      language: 'en',
      timezone: 'UTC',
      screen: '0x0',
      colorDepth: 24,
      cookieEnabled: false,
      hash: 'server-side',
    };
  }

  // Client-side implementation
  const win = (globalThis as any).window;
  const screen = win.screen;
  const navigator = win.navigator;
  
  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}x${screen.availWidth}x${screen.availHeight}`,
    colorDepth: screen.colorDepth,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack || undefined,
  };

  // Create hash from all fingerprint data
  const fingerprintString = JSON.stringify(fingerprint);
  const hash = simpleHash(fingerprintString);
  
  return {
    ...fingerprint,
    hash: hash.toString(),
  };
};

export const generateUserIdFromFingerprint = (fingerprint: string): string => {
  // Generate multiple hash values to create enough entropy for UUID
  const hash1 = simpleHash(fingerprint + 'user-salt-1');
  const hash2 = simpleHash(fingerprint + 'user-salt-2');
  const hash3 = simpleHash(fingerprint + 'user-salt-3');
  const hash4 = simpleHash(fingerprint + 'user-salt-4');
  
  // Convert to hex and pad to ensure we have enough characters
  const hex1 = Math.abs(hash1).toString(16).padStart(8, '0');
  const hex2 = Math.abs(hash2).toString(16).padStart(8, '0');
  const hex3 = Math.abs(hash3).toString(16).padStart(8, '0');
  const hex4 = Math.abs(hash4).toString(16).padStart(8, '0');
  
  // Format as proper UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuid = [
    hex1.slice(0, 8),
    hex2.slice(0, 4),
    '4' + hex2.slice(1, 4), // Version 4 UUID
    (8 | (parseInt(hex3.charAt(0), 16) & 0x3)).toString(16) + hex3.slice(1, 4), // Variant bits
    (hex3.slice(4, 8) + hex4.slice(0, 8)).slice(0, 12)
  ].join('-');
  
  return uuid;
};

// Simple hash function for fingerprinting
const simpleHash = (str: string): number => {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};