import { User } from "./types";

export const generateUserId = (): string => {
  return crypto.randomUUID();
};

export const generateRoomKey = (): string => {
  // Generate a room key that satisfies the RoomKeySchema requirements:
  // - At least 6 characters
  // - Contains both letters and numbers
  // - Only alphanumeric, underscores, and hyphens
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const allChars = letters + numbers;

  let result = "";

  // Ensure at least one letter and one number
  result += letters.charAt(Math.floor(Math.random() * letters.length));
  result += numbers.charAt(Math.floor(Math.random() * numbers.length));

  // Add remaining characters (total length: 8 characters)
  for (let i = 2; i < 8; i++) {
    result += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }

  // Shuffle the result using Fisher-Yates algorithm
  const chars = result.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = chars[i] as string;
    chars[i] = chars[j] as string;
    chars[j] = temp;
  }
  return chars.join("");
};

export const generateDefaultUsername = (): string => {
  // Generate a random 6-character alphanumeric string
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `用户${result}`;
};

export const detectDeviceType = (userAgent: string): User["deviceType"] => {
  const ua = userAgent.toLowerCase();

  // Check tablet first (before mobile) since tablets often contain mobile keywords
  if (/tablet|ipad/i.test(ua)) {
    return "tablet";
  }

  // Check for Android tablets by model number patterns
  if (/android/i.test(ua) && /sm-t\d+/i.test(ua)) {
    return "tablet";
  }

  // Then check mobile devices
  if (/mobile|android|iphone|phone/i.test(ua)) {
    return "mobile";
  }

  // Check desktop/laptop devices
  if (/desktop|windows|mac|linux/i.test(ua)) {
    return "desktop";
  }

  return "unknown";
};

export const formatFileSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
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
  if (!fileName || typeof fileName !== "string") {
    return "unnamed_file";
  }

  // Remove any directory traversal attempts
  let sanitized = fileName.replace(/\.\./g, "");

  // Remove path separators
  sanitized = sanitized.replace(/[/\\]/g, "_");

  // Remove potentially dangerous characters and control characters
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  sanitized = sanitized.replace(/[<>:"|?*]/g, "_");

  // Replace sequences of unsafe characters with single underscore
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Remove multiple consecutive underscores
  sanitized = sanitized.replace(/_+/g, "_");

  // Remove leading/trailing underscores and dots
  sanitized = sanitized.replace(/^[._-]+|[._-]+$/g, "");

  // Ensure we have a valid filename
  if (!sanitized || sanitized.length === 0) {
    sanitized = "unnamed_file";
  }

  // Limit filename length (keep extension if present)
  if (sanitized.length > 100) {
    const lastDotIndex = sanitized.lastIndexOf(".");
    if (lastDotIndex > 0 && lastDotIndex > sanitized.length - 10) {
      // Keep extension
      const name = sanitized.substring(0, lastDotIndex).substring(0, 90);
      const ext = sanitized.substring(lastDotIndex);
      sanitized = name + ext;
    } else {
      sanitized = sanitized.substring(0, 100);
    }
  }

  // Prevent reserved Windows filenames
  const reservedNames = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ];

  const nameWithoutExt = sanitized.replace(/\.[^.]*$/, "");
  if (reservedNames.includes(nameWithoutExt.toUpperCase())) {
    sanitized = "_" + sanitized;
  }

  return sanitized;
};

export const formatTimestamp = (date: Date | string, locale: string = "zh"): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Check if the date is valid
  if (isNaN(dateObj.getTime())) {
    return "Invalid Date";
  }

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffDays = Math.floor(diffMs / 86400000);
  const isZh = locale.startsWith("zh");

  // If within last hour, show relative time
  if (diffMins < 1) {
    return isZh ? "刚刚" : "Just now";
  } else if (diffMins < 60) {
    return isZh ? `${diffMins}分钟前` : `${diffMins}m ago`;
  }
  // If today, show time only
  else if (dateObj.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateObj);
  }
  // If yesterday
  else if (diffDays === 1) {
    const time = new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateObj);
    return isZh ? `昨天 ${time}` : `Yesterday ${time}`;
  }
  // If within this year
  else if (dateObj.getFullYear() === now.getFullYear()) {
    if (isZh) {
      return `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(dateObj);
  }
  // For older dates, show full date
  else {
    return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateObj);
  }
};

export const formatExpiryTime = (date: Date | string, locale: string = "zh"): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) {
    return "Invalid Date";
  }

  const now = new Date();
  const diffMs = dateObj.getTime() - now.getTime();
  const isZh = locale.startsWith("zh");

  if (diffMs <= 0) {
    return isZh ? "已过期" : "Expired";
  }

  const diffDays = Math.ceil(diffMs / 86400000);
  const diffHours = Math.ceil(diffMs / 3600000);

  if (diffHours < 24) {
    return isZh ? `${diffHours}小时后过期` : `Expires in ${diffHours}h`;
  }

  return isZh ? `${diffDays}天后过期` : `Expires in ${diffDays}d`;
};

// Browser fingerprinting utilities (client-side only)
export const generateBrowserFingerprint = (): import("./types").BrowserFingerprint => {
  if (typeof globalThis === "undefined" || !(globalThis as any).window) {
    // Server-side fallback - generate a random hash
    const randomHash = Math.random().toString(36).substring(2) + Date.now().toString(36);
    return {
      userAgent: "",
      language: "en",
      timezone: "UTC",
      screen: "0x0",
      colorDepth: 24,
      cookieEnabled: false,
      hash: secureHash("server-side-" + randomHash),
    };
  }

  // Client-side implementation with enhanced fingerprinting
  const win = (globalThis as any).window;
  const screen = win.screen;
  const navigator = win.navigator;

  try {
    // Collect more detailed fingerprint data
    const canvas = win.document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("Browser fingerprint canvas test 🔒", 2, 2);
    const canvasFingerprint = canvas.toDataURL().substring(0, 50); // First 50 chars only

    const fingerprint = {
      userAgent: navigator.userAgent.substring(0, 200), // Limit length
      language: navigator.language || "unknown",
      languages: (navigator.languages || []).join(",").substring(0, 100),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      screen: `${screen.width}x${screen.height}x${screen.availWidth}x${screen.availHeight}`,
      colorDepth: screen.colorDepth || 24,
      pixelRatio: win.devicePixelRatio || 1,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack || "unknown",
      platform: navigator.platform?.substring(0, 50) || "unknown",
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      canvas: canvasFingerprint,
      localStorage: typeof win.localStorage !== "undefined",
      sessionStorage: typeof win.sessionStorage !== "undefined",
      webGL: !!win.WebGLRenderingContext,
      // Remove timestamp to ensure consistent fingerprints across page reloads
    };

    // Create more secure hash from all fingerprint data
    const fingerprintString = JSON.stringify(fingerprint);
    const hash = secureHash(fingerprintString);

    return {
      userAgent: fingerprint.userAgent,
      language: fingerprint.language,
      timezone: fingerprint.timezone,
      screen: fingerprint.screen,
      colorDepth: fingerprint.colorDepth,
      cookieEnabled: fingerprint.cookieEnabled,
      doNotTrack: fingerprint.doNotTrack,
      hash: hash,
    };
  } catch {
    // Fallback in case of errors
    const basicFingerprint = {
      userAgent: navigator.userAgent.substring(0, 200),
      language: navigator.language || "unknown",
      timezone: "unknown",
      screen: `${screen.width}x${screen.height}`,
      colorDepth: screen.colorDepth || 24,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: "unknown",
    };

    const fallbackHash = secureHash(JSON.stringify(basicFingerprint));

    return {
      ...basicFingerprint,
      hash: fallbackHash,
    };
  }
};

export const generateUserIdFromFingerprint = (fingerprint: string): string => {
  // Use more secure hashing for user ID generation
  const hash1 = secureHash(fingerprint + "-salt-primary");
  const hash2 = secureHash(fingerprint + "-salt-secondary");

  // Create UUID from the secure hashes
  const combined = hash1 + hash2;

  // Format as proper UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuid = [
    combined.slice(0, 8),
    combined.slice(8, 12),
    "4" + combined.slice(13, 16), // Version 4 UUID
    ((parseInt(combined.charAt(16), 16) & 0x3) | 0x8).toString(16) + combined.slice(17, 20), // Variant bits
    combined.slice(20, 32),
  ].join("-");

  return uuid;
};

// Improved cryptographic hash function for fingerprinting
const secureHash = (str: string): string => {
  if (str.length === 0) return "0";

  // Use a more secure hashing approach
  let hash1 = 0x811c9dc5; // FNV-1a 32-bit offset basis
  let hash2 = 0x1000193; // FNV-1a 32-bit prime

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    // FNV-1a hash algorithm
    hash1 ^= char;
    hash1 = Math.imul(hash1, 0x01000193);

    // Additional mixing for better distribution
    hash2 = Math.imul(hash2 ^ char, 0x85ebca77);
    hash2 ^= hash2 >>> 13;
    hash2 = Math.imul(hash2, 0xc2b2ae3d);
    hash2 ^= hash2 >>> 16;
  }

  // Combine both hashes and convert to hex
  const combined = (hash1 >>> 0) * 0x100000000 + (hash2 >>> 0);
  return combined.toString(16).padStart(16, "0");
};

// Fallback simple hash for compatibility (exported for potential future use)
export const simpleHash = (str: string): number => {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

// Share-related utilities
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generate a unique share ID using UUID v4 and base62 encoding
 */
export const generateShareId = (): string => {
  // Generate UUID v4
  const uuid = crypto.randomUUID().replace(/-/g, "");

  // Convert to base62
  return base62Encode(uuid).substring(0, 10);
};

/**
 * Encode a hexadecimal string to base62
 */
export const base62Encode = (hex: string): string => {
  // Convert hex string to big integer
  const bigInt = BigInt("0x" + hex);

  // Encode to base62
  let result = "";
  let num = bigInt;

  if (num === 0n) {
    return "0";
  }

  while (num > 0) {
    const remainder = num % 62n;
    result = BASE62_CHARS[Number(remainder)] + result;
    num = num / 62n;
  }

  return result;
};

/**
 * Validate password length
 * - At least 6 characters
 */
export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 6) {
    errors.push("Password must be at least 6 characters");
  }

  if (password.length > 100) {
    errors.push("Password must not exceed 100 characters");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
