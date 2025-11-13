/**
 * Server-specific types for share operations
 */

import type { ShareLink as IShareLink } from "@cloud-clipboard/shared";

// Re-export shared types
export type { ShareAccessLog } from "@cloud-clipboard/shared";

// Server-side ShareLink alias
export type ShareLink = IShareLink;

// Share creation request
export interface CreateShareRequest {
  fileId: string;
  createdBy: string;
  password?: string;
  expiresInDays?: number;
}

// Share creation response
export interface CreateShareResponse {
  shareId: string;
  fileId: string;
  createdBy: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  hasPassword: boolean;
  accessCount: number;
}

// Share list item response
export interface ShareListItem {
  shareId: string;
  originalFilename: string;
  fileSize: number;
  createdAt: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
  accessCount: number;
  hasPassword: boolean;
}

// Share list response
export interface ShareListResponse {
  shares: ShareListItem[];
  total: number;
  limit: number;
  offset: number;
}

// Share details response
export interface ShareDetailsResponse {
  shareId: string;
  fileId: string;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
  isExpired: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  createdBy: string;
  hasPassword: boolean;
  status: "active" | "expired" | "revoked";
}

// Access log item
export interface AccessLogItem {
  timestamp: string;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  errorCode?: "expired" | "invalid" | "wrong_password" | "file_not_found" | "revoked";
  bytesTransferred?: number;
}

// Access logs response
export interface AccessLogsResponse {
  logs: AccessLogItem[];
  total: number;
}

// API error response
export interface ApiErrorResponse {
  success: false;
  error: string;
  message: string;
  retryAfter?: number; // For rate limiting
}

// Password validation result
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

// Rate limit headers
export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
}

// Request query parameters
export interface ListSharesQuery {
  status?: "active" | "expired" | "revoked" | "all";
  limit?: number;
  offset?: number;
}

export interface GetAccessLogsQuery {
  limit?: number;
}

// Socket.IO event types for share updates
export interface ShareUpdateEvent {
  type: "created" | "revoked" | "accessed";
  shareId: string;
  userId: string;
  timestamp: Date;
}

// Share statistics
export interface ShareStatistics {
  totalShares: number;
  activeShares: number;
  expiredShares: number;
  revokedShares: number;
  totalDownloads: number;
  totalPasswordProtected: number;
}

// Share management actions
export type ShareAction = "create" | "download" | "revoke" | "view_details" | "view_logs";

// Audit log entry for share operations
export interface ShareAuditLog {
  id: string;
  action: ShareAction;
  userId: string;
  shareId?: string;
  ipAddress: string;
  userAgent?: string;
  timestamp: Date;
  success: boolean;
  details?: Record<string, any>;
}
