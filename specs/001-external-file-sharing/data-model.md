# Data Model: External File Sharing

**Feature**: External File Sharing
**Branch**: 001-external-file-sharing
**Date**: 2025-11-12

## Entities Overview

The external file sharing feature introduces four core entities that extend the existing cloud-clipboard data model. All entities follow the existing patterns (TypeScript interfaces, Zod validation schemas, in-memory storage).

---

## Entity: SharedFile

**Purpose**: Represents a file that has been made available for external sharing

**Storage Location**: Server memory (Map-based, extends existing file management)

**Fields**:

| Field              | Type   | Validation            | Required | Description                                      |
| ------------------ | ------ | --------------------- | -------- | ------------------------------------------------ |
| `id`               | string | UUID v4 format        | Yes      | Unique identifier (same as original file ID)     |
| `originalFilename` | string | 1-255 chars, URL-safe | Yes      | Original filename with extension                 |
| `fileSize`         | number | 1-100MB range         | Yes      | File size in bytes                               |
| `mimeType`         | string | Valid MIME type       | Yes      | MIME type (e.g., "image/png", "application/pdf") |
| `uploadTimestamp`  | Date   | Valid date            | Yes      | When file was originally uploaded                |
| `uploadedBy`       | string | User ID format        | Yes      | ID of user who uploaded file                     |
| `storagePath`      | string | Valid file path       | Yes      | Server-side path to file                         |
| `checksum`         | string | SHA-256 hex           | Yes      | File integrity verification hash                 |

**Relationships**:

- **1:1** with ShareLink (each shared file has exactly one active share link)
- **1:N** with ShareAccessLog (file access creates multiple log entries)

**State Transitions**:

```
Uploaded → Shared → Expired/Deleted
  ↓           ↓
File deleted if original room file is deleted
  ↓
Share link automatically invalidated
```

**Zod Schema**:

```typescript
import { z } from "zod";

export const SharedFileSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string().min(1).max(255),
  fileSize: z
    .number()
    .min(1)
    .max(100 * 1024 * 1024), // 100MB
  mimeType: z.string(),
  uploadTimestamp: z.date(),
  uploadedBy: z.string(),
  storagePath: z.string(),
  checksum: z.string().length(64), // SHA-256 hex
});

export type SharedFile = z.infer<typeof SharedFileSchema>;
```

---

## Entity: ShareLink

**Purpose**: Manages external access to a shared file, including permissions and lifecycle

**Storage Location**: Server memory (Map<string, ShareLink>)

**Fields**:

| Field            | Type         | Validation          | Required | Description                            |
| ---------------- | ------------ | ------------------- | -------- | -------------------------------------- |
| `shareId`        | string       | base62 encoded      | Yes      | Unique share identifier (public)       |
| `fileId`         | string       | UUID format         | Yes      | Reference to SharedFile                |
| `createdAt`      | Date         | Valid date          | Yes      | When share link was created            |
| `expiresAt`      | Date         | Future date         | Yes      | When link expires (default: +7 days)   |
| `passwordHash`   | string       | bcrypt hash or null | No       | Hashed password if protected           |
| `accessCount`    | number       | ≥0                  | Yes      | Number of successful downloads         |
| `lastAccessedAt` | Date or null | Valid date or null  | No       | Timestamp of last access               |
| `isActive`       | boolean      | Boolean             | Yes      | Whether link is still valid            |
| `createdBy`      | string       | User ID format      | Yes      | User who created the share             |
| `metadata`       | object       | Key-value pairs     | No       | Additional share metadata (tags, etc.) |

**Relationships**:

- **N:1** with SharedFile (many shares can reference one file over time)
- **1:N** with ShareAccessLog (each access creates a log entry)

**State Transitions**:

```
Active → Expired (after expiresAt)
  ↓
Active → Revoked (user manually cancels)
  ↓
Expired/Revoked shares remain in memory until cleanup
  ↓
Cleanup job removes expired/revoked shares daily
```

**Zod Schema**:

```typescript
export const ShareLinkSchema = z.object({
  shareId: z.string().min(8).max(10), // base62 encoded UUID
  fileId: z.string().uuid(),
  createdAt: z.date(),
  expiresAt: z.date(),
  passwordHash: z.string().bcrypt().nullable().optional(),
  accessCount: z.number().int().min(0),
  lastAccessedAt: z.date().nullable().optional(),
  isActive: z.boolean(),
  createdBy: z.string(),
  metadata: z.record(z.any()).optional(),
});

export type ShareLink = z.infer<typeof ShareLinkSchema>;
```

---

## Entity: ShareAccessKey

**Purpose**: Manages password-based access control for share links (optional security layer)

**Storage Location**: Server memory (stored within ShareLink.passwordHash)

**Fields**:

| Field          | Type   | Validation     | Required | Description                      |
| -------------- | ------ | -------------- | -------- | -------------------------------- |
| `passwordHash` | string | bcrypt hash    | Yes      | Hashed password                  |
| `createdAt`    | Date   | Valid date     | Yes      | When password was set            |
| `algorithm`    | string | Fixed "bcrypt" | Yes      | Hashing algorithm used           |
| `costFactor`   | number | 10-15 range    | Yes      | bcrypt cost factor (default: 12) |

**Relationships**:

- **1:1** with ShareLink (each password-protected share has one hash)

**Zod Schema**:

```typescript
export const ShareAccessKeySchema = z.object({
  passwordHash: z.string(),
  createdAt: z.date(),
  algorithm: z.literal("bcrypt"),
  costFactor: z.number().int().min(10).max(15),
});

export type ShareAccessKey = z.infer<typeof ShareAccessKeySchema>;
```

---

## Entity: ShareAccessLog

**Purpose**: Audit trail for share link access (security monitoring and usage analytics)

**Storage Location**: Server memory (Map<string, AccessLog[]> grouped by shareId)

**Fields**:

| Field              | Type    | Validation       | Required | Description                   |
| ------------------ | ------- | ---------------- | -------- | ----------------------------- |
| `shareId`          | string  | base62 encoded   | Yes      | Reference to ShareLink        |
| `timestamp`        | Date    | Valid date       | Yes      | When access was attempted     |
| `ipAddress`        | string  | IPv4/IPv6 format | Yes      | Client IP address             |
| `userAgent`        | string  | 0-500 chars      | No       | HTTP User-Agent header        |
| `success`          | boolean | Boolean          | Yes      | Whether access was successful |
| `errorCode`        | string  | Enum or null     | No       | Error if unsuccessful         |
| `bytesTransferred` | number  | ≥0               | No       | File size in bytes            |

**Relationships**:

- **N:1** with ShareLink (many access logs per share link)

**State Transitions**:

```
Log entries are immutable (write-once)
  ↓
Automatically deleted after 30 days (cleanup job)
```

**Error Codes**:

- `expired`: Link has passed expiration time
- `invalid`: Share ID doesn't exist
- `wrong_password`: Password was incorrect
- `file_not_found`: Referenced file no longer exists
- `revoked`: Share was manually revoked

**Zod Schema**:

```typescript
export const ShareAccessLogSchema = z.object({
  shareId: z.string(),
  timestamp: z.date(),
  ipAddress: z.string(),
  userAgent: z.string().max(500).optional(),
  success: z.boolean(),
  errorCode: z
    .enum(["expired", "invalid", "wrong_password", "file_not_found", "revoked"])
    .nullable()
    .optional(),
  bytesTransferred: z.number().int().min(0).optional(),
});

export type ShareAccessLog = z.infer<typeof ShareAccessLogSchema>;
```

---

## Validation Rules Summary

1. **Password Requirements** (per clarification):
   - Minimum 8 characters
   - Must contain uppercase letter
   - Must contain lowercase letter
   - Must contain number
   - Must contain special character
   - Max length: 100 characters

2. **Share Link Constraints**:
   - Unique shareId (collision-free generation)
   - 7-day default expiration (configurable)
   - Active flag controls access
   - Access count tracked for analytics

3. **Access Logging**:
   - 30-day retention (auto-delete)
   - No PII beyond IP address
   - Success/failure status recorded
   - File size tracked for bandwidth monitoring

4. **File Sharing Constraints**:
   - 100MB file size limit
   - Must exist in user's room before sharing
   - Checksum for integrity verification
   - MIME type preserved

---

## Integration with Existing Model

**Shared Types Location**: `shared/src/types.ts`

**New Exports**:

```typescript
export interface SharedFile { ... }
export interface ShareLink { ... }
export interface ShareAccessLog { ... }

export type ShareAccessErrorCode = 'expired' | 'invalid' | 'wrong_password' | 'file_not_found' | 'revoked';
```

**Server Services**:

- **ShareService**: Manages ShareLink entities
- **FileService**: Extended to support sharing operations
- **LoggingService**: Handles ShareAccessLog creation and cleanup

**Client State Management**:

- Zustand store for share link management
- Redux-like pattern matching existing app structure

---

## Data Flow

```
1. User uploads file to room
   ↓
2. User creates share link
   ↓ (optional)
3. User sets password
   ↓
4. System generates shareId (base62 UUID)
   ↓
5. Share link is active (expires +7 days)
   ↓
6. External user accesses share link
   ↓
7. System validates (active, not expired, correct password)
   ↓
8. File streamed to user
   ↓
9. Access logged (success/failure, IP, timestamp)
   ↓
10. Cleanup job removes expired entries daily
```

---

## Storage Optimization

**In-Memory Storage**:

- `Map<string, ShareLink>`: O(1) share lookup
- `Map<string, SharedFile>`: O(1) file lookup
- `Map<string, ShareAccessLog[]>`: Grouped by shareId

**Cleanup Strategy**:

- Daily cron job (runs at 00:00 UTC)
- Remove expired shares (isActive = false OR expiresAt < now)
- Remove logs older than 30 days
- Remove logs for non-existent shares

**Memory Footprint**:

- ShareLink: ~500 bytes per link
- AccessLog: ~200 bytes per log entry
- 1000 shares + 10000 logs: ~2.5 MB
- Well within acceptable limits for typical usage

---

## Migration Notes

No database migration required (in-memory storage). However, if persistent storage is added in future:

1. Add tables: `share_links`, `share_access_logs`
2. Add foreign keys: `share_links.file_id → files.id`
3. Add indexes: `share_links.share_id`, `share_access_logs.share_id`, `share_access_logs.timestamp`
4. Add TTL indexes for automatic expiration (PostgreSQL has native support)
