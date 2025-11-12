# Research: External File Sharing

**Date**: 2025-11-12
**Feature**: External File Sharing
**Branch**: 001-external-file-sharing

## Research Objectives

Resolve technical decisions for implementing secure external file sharing with password protection, direct download access, and comprehensive logging.

---

## 1. Password Storage & Hashing Strategy

### Decision: Use bcrypt for password hashing

**Rationale**:

- Industry-standard password hashing algorithm designed for password storage
- Built-in salting prevents rainbow table attacks
- Configurable work factor (cost) allows scaling with hardware improvements
- No plain-text storage - only cryptographic hashes stored
- Active maintenance and widespread adoption

**Alternatives Considered**:

- **Argon2**: More modern, winner of Password Hashing Competition, but less widespread library support in TypeScript
- **scrypt**: Memory-hard function, good forASIC resistance, but more complex parameter tuning
- **PBKDF2**: NIST-approved, but slower and less secure against modern GPU attacks
- **SHA-256**: Cryptographic hash, NOT suitable for passwords (too fast, no salting by default)

**Implementation Details**:

```typescript
// Use bcrypt with cost factor of 12
const bcrypt = require("bcrypt");
const hash = await bcrypt.hash(password, 12);
const isValid = await bcrypt.compare(inputPassword, hash);
```

---

## 2. Share URL Generation Strategy

### Decision: Use UUID v4 with base62 encoding for share links

**Rationale**:

- UUID v4 provides 122 bits of randomness, astronomically low collision probability
- Base62 encoding produces URL-safe, compact identifiers (8-10 characters)
- No predictable patterns (unlike sequential IDs)
- No centralized ID generation needed (stateless)
- Easy to implement with existing uuid library

**Alternatives Considered**:

- **NanoID**: Smaller than UUID, but requires separate library
- **Sequential IDs**: Predictable, reveals business metrics (how many shares created)
- **Hash-based IDs**: Depends on input data, limited entropy
- **UUID v1**: Includes timestamp and MAC address, privacy concerns

**Implementation Details**:

```typescript
import { v4 as uuidv4 } from "uuid";

// Generate UUID and encode to base62
const rawId = uuidv4().replace(/-/g, "");
const base62Id = base62Encode(rawId);
const shareUrl = `/api/share/${base62Id}`;
```

---

## 3. External Access Security Model

### Decision: Direct file download with optional password gate

**Rationale**:

- Simplified user experience (no landing page for direct downloads)
- Password protection through HTTP Basic Auth or custom form
- URL pattern without sensitive data (password not in URL per clarification)
- 404 responses for invalid/expired links (security through obscurity is acceptable per requirements)
- Stateless access checking for scalability

**Alternatives Considered**:

- **Token-based URLs**: Include signed JWT in URL, but violates clarification requirements
- **Landing page with preview**: Additional user interaction, but clarification specified direct download
- **Session-based authentication**: Requires session storage, adds complexity
- **OAuth2**: Overkill for anonymous external access

**Implementation Details**:

- For password-protected links: Return 401 with WWW-Authenticate header
- For non-password links: Stream file directly with correct Content-Disposition headers
- For invalid links: Return 404 with no additional information

---

## 4. Access Logging & Privacy Strategy

### Decision: Lightweight audit logging with 30-day retention

**Rationale**:

- Minimal data collection (timestamp, IP, result) balances security and privacy
- 30-day retention meets legal requirements while minimizing data footprint
- No file content logging (privacy protection)
- In-memory storage with periodic persistence (no database needed)
- GDPR-friendly approach (data minimization principle)

**Alternatives Considered**:

- **Structured logging to file**: More complex rotation and retention management
- **Database storage**: Unnecessary complexity for transient data
- **No logging**: Loses ability to detect abuse or track usage
- **Detailed logging**: IP geolocation, user agents, etc. - privacy concerns

**Implementation Details**:

```typescript
interface AccessLog {
  shareId: string;
  timestamp: Date;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  errorCode?: string; // 'expired', 'invalid', 'wrong_password', 'file_not_found'
}
```

---

## 5. Error Handling & Security Model

### Decision: Minimal information disclosure with generic 404/401 responses

**Rationale**:

- Simplicity as specified in clarification (simplified 404 handling)
- Prevents information leakage about link existence
- Standard HTTP status codes for broad compatibility
- No detailed error messages prevent reconnaissance attacks
- Consistent with cloud-clipboard's existing error handling patterns

**Implementation Details**:

- **File not found**: 404 (generic, no mention of file or share)
- **Expired link**: 404 (same response as invalid link)
- **Wrong password**: 401 with WWW-Authenticate header
- **Missing password**: 401 with WWW-Authenticate header
- **Network/server errors**: 500 (standard error page)

---

## 6. Link Expiration & Cleanup Strategy

### Decision: Automatic cleanup with daily cron job

**Rationale**:

- In-memory storage allows fast lookups but requires active cleanup
- Daily cleanup job balances performance and resource usage
- Share links naturally expire after 7 days
- Memory leak prevention through systematic cleanup
- No complex TTL mechanisms needed (simple Map-based tracking)

**Implementation Details**:

```typescript
// ShareLinkService with built-in cleanup
class ShareLinkService {
  private shares: Map<string, ShareLink> = new Map();
  private accessLogs: Map<string, AccessLog[]> = new Map();

  cleanup(): void {
    const now = Date.now();
    // Remove expired shares
    // Remove logs older than 30 days
  }
}
```

---

## 7. Integration Points with Existing System

### Decision: Extend existing file upload infrastructure

**Rationale**:

- Leverage existing Multer-based file upload handling
- Reuse existing file storage and management
- Extend RoomService or create dedicated ShareService
- Minimal changes to existing authentication (follow user session)
- Consistent with monorepo patterns (shared types in `shared/` package)

**Implementation Details**:

- ShareService in `server/src/services/ShareService.ts`
- New API routes in `server/src/routes/share.ts`
- Zod schemas in `shared/src/schemas.ts` (extend existing patterns)
- React components in `client/src/components/Share/` directory
- State management via existing Zustand stores

---

## 8. Performance & Scalability Considerations

### Decision: Stateless, in-memory design with Map-based storage

**Rationale**:

- Matches existing cloud-clipboard architecture (in-memory RoomService)
- Fast O(1) lookups for share links by ID
- No database bottlenecks for high-frequency access
- Horizontal scaling-friendly (each server instance has independent copy)
- 100 concurrent share links easily handled by Node.js event loop

**Performance Expectations**:

- Link generation: <100ms (crypto operations)
- Access validation: <50ms (Map lookup + optional bcrypt compare)
- File streaming: Native Express streaming (depends on file size)

---

## Conclusion

The research supports a simple, secure, and scalable approach:

1. **bcrypt** for password hashing (secure, industry-standard)
2. **UUID v4 + base62** for share link IDs (unique, unguessable)
3. **Direct download** pattern (simple UX per clarification)
4. **Minimal logging** with 30-day retention (privacy-conscious)
5. **Generic 404/401** responses (simple, secure per clarification)
6. **Automatic cleanup** (memory safety, scalability)
7. **In-memory storage** (consistency with existing architecture)

No constitutional violations or complexity concerns identified. All decisions align with existing cloud-clipboard patterns and user requirements.
