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