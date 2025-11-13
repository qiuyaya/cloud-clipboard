/**
 * TypeScript type definitions for External File Sharing API
 * Generated from OpenAPI specification
 * Version: 1.0.0
 */

export interface CreateShareRequest {
  fileId: string; // UUID format
  password?: string; // Optional, 8-100 chars, complexity requirements
  expiresInDays?: number; // 1-30, default: 7
}

export interface ShareLinkResponse {
  shareId: string;
  url: string; // Full URL for external access
  createdAt: string; // ISO 8601 date-time
  expiresAt: string; // ISO 8601 date-time
  hasPassword: boolean;
  accessCount: number;
}

export interface ShareLinkSummary {
  shareId: string;
  originalFilename: string;
  fileSize: number; // bytes
  createdAt: string; // ISO 8601 date-time
  expiresAt: string; // ISO 8601 date-time
  status: "active" | "expired" | "revoked";
  accessCount: number;
  hasPassword: boolean;
}

export interface ShareLinkDetails extends ShareLinkSummary {
  lastAccessedAt: string | null; // ISO 8601 date-time or null
  mimeType: string;
  downloadUrl: string; // Full URL for download
}

export interface AccessLogEntry {
  timestamp: string; // ISO 8601 date-time
  ipAddress: string;
  userAgent?: string | null;
  success: boolean;
  errorCode?: "expired" | "invalid" | "wrong_password" | "file_not_found" | "revoked" | null;
  bytesTransferred?: number; // Only for successful downloads
}

export interface ApiError {
  error: string; // Error code
  message: string; // Human-readable message
  details?: object; // Additional error details
}

// API Response wrapper types
export interface ListShareLinksResponse {
  shares: ShareLinkSummary[];
  total: number;
}

export interface GetAccessLogsResponse {
  logs: AccessLogEntry[];
  total: number;
}

// HTTP Status codes
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  GONE: 410, // Link expired
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error codes
export const ErrorCodes = {
  INVALID_FILE: "INVALID_FILE",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  SHARE_EXPIRED: "SHARE_EXPIRED",
  SHARE_REVOKED: "SHARE_REVOKED",
} as const;

// Query parameter types for list operations
export interface ListShareLinksQuery {
  status?: "active" | "expired" | "revoked" | "all";
  limit?: number; // 1-100, default: 20
  offset?: number; // >= 0, default: 0
}

export interface GetAccessLogsQuery {
  limit?: number; // 1-100, default: 50
}

// Route parameter types
export interface ShareIdParam {
  shareId: string; // 8-10 characters, base62 encoded
}
