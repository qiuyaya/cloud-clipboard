import { describe, it, expect, beforeEach } from 'bun:test';
import {
  generateUserId,
  generateRoomKey,
  detectDeviceType,
  formatFileSize,
  isValidRoomKey,
  sanitizeFileName,
  formatTimestamp,
  generateBrowserFingerprint,
  generateUserIdFromFingerprint,
  simpleHash,
} from '../utils';

describe('Utility Functions Tests', () => {
  describe('generateUserId', () => {
    it('should generate valid UUIDs', () => {
      const id1 = generateUserId();
      const id2 = generateUserId();
      
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      
      expect(id1).toMatch(uuidRegex);
      expect(id2).toMatch(uuidRegex);
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateRoomKey', () => {
    it('should generate valid room keys', () => {
      const key1 = generateRoomKey();
      const key2 = generateRoomKey();
      
      expect(typeof key1).toBe('string');
      expect(typeof key2).toBe('string');
      expect(key1.length).toBeGreaterThan(0);
      expect(key2.length).toBeGreaterThan(0);
      expect(key1).not.toBe(key2);
      
      // Should contain only alphanumeric characters (case insensitive)
      expect(key1).toMatch(/^[a-zA-Z0-9]+$/);
      expect(key2).toMatch(/^[a-zA-Z0-9]+$/);
    });
  });

  describe('detectDeviceType', () => {
    it('should detect mobile devices', () => {
      const mobileUserAgents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        'Mozilla/5.0 (Linux; Android 10; SM-G975F)',
        'Mozilla/5.0 (Mobile; Windows Phone 8.1)',
      ];

      mobileUserAgents.forEach(ua => {
        expect(detectDeviceType(ua)).toBe('mobile');
      });
    });

    it('should detect tablet devices', () => {
      const tabletUserAgents = [
        'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)',
        'Mozilla/5.0 (Linux; Android 10; SM-T515) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      ];

      tabletUserAgents.forEach(ua => {
        expect(detectDeviceType(ua)).toBe('tablet');
      });
    });

    it('should detect desktop devices', () => {
      const desktopUserAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      ];

      desktopUserAgents.forEach(ua => {
        expect(detectDeviceType(ua)).toBe('desktop');
      });
    });

    it('should return unknown for unrecognized user agents', () => {
      const unknownUserAgents = [
        'CustomBot/1.0',
        'SomeUnknownDevice',
        '',
      ];

      unknownUserAgents.forEach(ua => {
        expect(detectDeviceType(ua)).toBe('unknown');
      });
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(999)).toBe('999 B');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.00 KB');
      expect(formatFileSize(1536)).toBe('1.50 KB');
      expect(formatFileSize(2048)).toBe('2.00 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.50 MB');
    });

    it('should format gigabytes correctly', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });

    it('should format terabytes correctly', () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
    });
  });

  describe('isValidRoomKey', () => {
    it('should accept valid room keys', () => {
      const validKeys = ['a', 'room123', 'test_room-42', 'MyRoom', 'a'.repeat(100)];
      validKeys.forEach(key => {
        expect(isValidRoomKey(key)).toBe(true);
      });
    });

    it('should reject invalid room keys', () => {
      const invalidKeys = [
        '', // empty
        'a'.repeat(101), // too long
        'room key', // spaces
        'room@key', // invalid characters
        'room#key', // invalid characters
      ];
      invalidKeys.forEach(key => {
        expect(isValidRoomKey(key)).toBe(false);
      });
    });
  });

  describe('sanitizeFileName', () => {
    it('should handle normal file names', () => {
      expect(sanitizeFileName('test.txt')).toBe('test.txt');
      expect(sanitizeFileName('my-file_2024.pdf')).toBe('my-file_2024.pdf');
    });

    it('should remove dangerous characters', () => {
      expect(sanitizeFileName('file<>:"|?*.txt')).toBe('file_.txt');
      expect(sanitizeFileName('test/path\\file.txt')).toBe('test_path_file.txt');
    });

    it('should prevent path traversal', () => {
      expect(sanitizeFileName('../../../etc/passwd')).toBe('etc_passwd');
      expect(sanitizeFileName('..\\..\\windows\\system32')).toBe('windows_system32');
    });

    it('should handle control characters', () => {
      expect(sanitizeFileName('file\x00\x1f\x7f.txt')).toBe('file.txt');
    });

    it('should handle empty or invalid inputs', () => {
      expect(sanitizeFileName('')).toBe('unnamed_file');
      expect(sanitizeFileName('...')).toBe('unnamed_file');
      expect(sanitizeFileName('___')).toBe('unnamed_file');
    });

    it('should truncate long file names', () => {
      const longName = 'a'.repeat(150) + '.txt';
      const sanitized = sanitizeFileName(longName);
      expect(sanitized.length).toBeLessThanOrEqual(100);
      expect(sanitized.endsWith('.txt')).toBe(true);
    });

    it('should handle Windows reserved names', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];
      reservedNames.forEach(name => {
        expect(sanitizeFileName(name)).toBe('_' + name);
        expect(sanitizeFileName(name + '.txt')).toBe('_' + name + '.txt');
      });
    });

    it('should handle null and undefined inputs', () => {
      expect(sanitizeFileName(null as any)).toBe('unnamed_file');
      expect(sanitizeFileName(undefined as any)).toBe('unnamed_file');
    });
  });

  describe('formatTimestamp', () => {
    it('should format Date objects correctly', () => {
      const date = new Date('2024-01-15T10:30:45Z');
      const formatted = formatTimestamp(date);
      expect(formatted).toMatch(/Jan 15, 2024/);
      expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('should format date strings correctly', () => {
      const dateString = '2024-01-15T10:30:45Z';
      const formatted = formatTimestamp(dateString);
      expect(formatted).toMatch(/Jan 15, 2024/);
      expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('should handle invalid dates', () => {
      expect(formatTimestamp('invalid-date')).toBe('Invalid Date');
      expect(formatTimestamp('')).toBe('Invalid Date');
      expect(formatTimestamp(new Date('invalid'))).toBe('Invalid Date');
    });
  });

  describe('generateBrowserFingerprint', () => {
    beforeEach(() => {
      // Reset global state
      delete (globalThis as any).window;
    });

    it('should generate server-side fingerprint when window is not available', () => {
      const fingerprint = generateBrowserFingerprint();
      
      expect(fingerprint).toHaveProperty('userAgent', '');
      expect(fingerprint).toHaveProperty('language', 'en');
      expect(fingerprint).toHaveProperty('timezone', 'UTC');
      expect(fingerprint).toHaveProperty('screen', '0x0');
      expect(fingerprint).toHaveProperty('colorDepth', 24);
      expect(fingerprint).toHaveProperty('cookieEnabled', false);
      expect(fingerprint).toHaveProperty('hash');
      expect(typeof fingerprint.hash).toBe('string');
      expect(fingerprint.hash.length).toBeGreaterThan(0);
    });

    it('should generate client-side fingerprint when window is available', () => {
      // Mock browser environment
      (globalThis as any).window = {
        screen: {
          width: 1920,
          height: 1080,
          availWidth: 1920,
          availHeight: 1040,
          colorDepth: 24,
        },
        navigator: {
          userAgent: 'Mozilla/5.0 (Test Browser)',
          language: 'en-US',
          languages: ['en-US', 'en'],
          cookieEnabled: true,
          doNotTrack: 'unspecified',
          platform: 'Test Platform',
          hardwareConcurrency: 8,
          maxTouchPoints: 0,
        },
        devicePixelRatio: 2,
        WebGLRenderingContext: {},
        localStorage: {},
        sessionStorage: {},
        document: {
          createElement: () => ({
            getContext: () => ({
              textBaseline: '',
              font: '',
              fillText: () => {},
            }),
            toDataURL: () => 'data:image/png;base64,test',
          }),
        },
      };

      // Mock Intl.DateTimeFormat
      const originalIntl = globalThis.Intl;
      globalThis.Intl = {
        ...originalIntl,
        DateTimeFormat: () => ({
          resolvedOptions: () => ({ timeZone: 'America/New_York' }),
        }),
      } as any;

      try {
        const fingerprint = generateBrowserFingerprint();
        
        expect(fingerprint).toHaveProperty('userAgent');
        expect(fingerprint).toHaveProperty('language', 'en-US');
        expect(fingerprint).toHaveProperty('timezone', 'America/New_York');
        expect(fingerprint).toHaveProperty('screen');
        expect(fingerprint).toHaveProperty('colorDepth', 24);
        expect(fingerprint).toHaveProperty('cookieEnabled', true);
        expect(fingerprint).toHaveProperty('hash');
        expect(typeof fingerprint.hash).toBe('string');
        expect(fingerprint.hash.length).toBeGreaterThan(0);
      } finally {
        globalThis.Intl = originalIntl;
        delete (globalThis as any).window;
      }
    });

    it('should handle errors in fingerprint generation and use fallback', () => {
      // Mock browser environment that throws errors
      (globalThis as any).window = {
        screen: {
          width: 1920,
          height: 1080,
          colorDepth: 24,
        },
        navigator: {
          userAgent: 'Mozilla/5.0 (Test Browser)',
          language: 'en-US',
          cookieEnabled: true,
        },
        document: {
          createElement: () => {
            throw new Error('Canvas error');
          },
        },
      };

      // Mock Intl to throw error
      const originalIntl = globalThis.Intl;
      globalThis.Intl = {
        ...originalIntl,
        DateTimeFormat: () => {
          throw new Error('Timezone error');
        },
      } as any;

      try {
        const fingerprint = generateBrowserFingerprint();
        
        // Should use fallback values
        expect(fingerprint).toHaveProperty('userAgent');
        expect(fingerprint).toHaveProperty('language', 'en-US');
        expect(fingerprint).toHaveProperty('timezone', 'unknown');
        expect(fingerprint).toHaveProperty('screen');
        expect(fingerprint).toHaveProperty('colorDepth', 24);
        expect(fingerprint).toHaveProperty('cookieEnabled', true);
        expect(fingerprint).toHaveProperty('doNotTrack', 'unknown');
        expect(fingerprint).toHaveProperty('hash');
        expect(typeof fingerprint.hash).toBe('string');
        expect(fingerprint.hash.length).toBeGreaterThan(0);
      } finally {
        globalThis.Intl = originalIntl;
        delete (globalThis as any).window;
      }
    });
  });

  describe('generateUserIdFromFingerprint', () => {
    it('should generate valid UUID from fingerprint', () => {
      const fingerprint = 'test-fingerprint-123';
      const userId = generateUserIdFromFingerprint(fingerprint);
      
      // Should be a valid UUID v4
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(userId).toMatch(uuidRegex);
    });

    it('should generate consistent UUIDs for same fingerprint', () => {
      const fingerprint = 'consistent-fingerprint';
      const userId1 = generateUserIdFromFingerprint(fingerprint);
      const userId2 = generateUserIdFromFingerprint(fingerprint);
      
      expect(userId1).toBe(userId2);
    });

    it('should generate different UUIDs for different fingerprints', () => {
      const fingerprint1 = 'fingerprint-1';
      const fingerprint2 = 'fingerprint-2';
      const userId1 = generateUserIdFromFingerprint(fingerprint1);
      const userId2 = generateUserIdFromFingerprint(fingerprint2);
      
      expect(userId1).not.toBe(userId2);
    });
  });

  describe('simpleHash', () => {
    it('should return 0 for empty string', () => {
      expect(simpleHash('')).toBe(0);
    });

    it('should generate consistent hashes', () => {
      const str = 'test string';
      const hash1 = simpleHash(str);
      const hash2 = simpleHash(str);
      
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('number');
    });

    it('should generate different hashes for different strings', () => {
      const hash1 = simpleHash('string1');
      const hash2 = simpleHash('string2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should always return positive numbers', () => {
      const testStrings = ['test', 'another test', 'special!@#$%^&*()'];
      testStrings.forEach(str => {
        const hash = simpleHash(str);
        expect(hash).toBeGreaterThanOrEqual(0);
      });
    });
  });
});