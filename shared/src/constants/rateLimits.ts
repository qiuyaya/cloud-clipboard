/**
 * Rate limiting constants for the cloud clipboard application
 */

// Time constants (in milliseconds)
export const TIME_CONSTANTS = {
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
} as const;

// HTTP Rate Limits
export const HTTP_RATE_LIMITS = {
  // General API rate limit - 15 minutes window, 100 requests
  GENERAL: {
    WINDOW_MS: TIME_CONSTANTS.FIFTEEN_MINUTES,
    MAX_REQUESTS: 100,
  },
  // File upload rate limit - 1 minute window, 5 uploads
  UPLOAD: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 5,
  },
  // Authentication rate limit - 15 minutes window, 20 attempts
  AUTH: {
    WINDOW_MS: TIME_CONSTANTS.FIFTEEN_MINUTES,
    MAX_REQUESTS: 20,
  },
  // Strict rate limit - 5 minutes window, 50 requests
  STRICT: {
    WINDOW_MS: TIME_CONSTANTS.FIVE_MINUTES,
    MAX_REQUESTS: 50,
  },
  // Room action rate limit - 1 minute window, 30 actions
  ROOM_ACTION: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 30,
  },
} as const;

// WebSocket Rate Limits (per socket)
export const SOCKET_RATE_LIMITS = {
  // Join room events - 5 joins per minute
  JOIN_ROOM: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 5,
  },
  // Leave room events - 10 leaves per minute
  LEAVE_ROOM: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 10,
  },
  // Send message events - 30 messages per minute
  SEND_MESSAGE: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 30,
  },
  // User list requests - 20 requests per minute
  USER_LIST: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 20,
  },
  // Password changes - 10 changes per minute
  PASSWORD_CHANGE: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 10,
  },
  // Share room link - 20 requests per minute
  SHARE_ROOM: {
    WINDOW_MS: TIME_CONSTANTS.ONE_MINUTE,
    MAX_REQUESTS: 20,
  },
} as const;

// Cleanup intervals
export const CLEANUP_INTERVALS = {
  // Rate limit cleanup every 5 minutes
  RATE_LIMIT_CLEANUP: TIME_CONSTANTS.FIVE_MINUTES,
} as const;
