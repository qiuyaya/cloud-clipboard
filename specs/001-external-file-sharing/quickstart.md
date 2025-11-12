# Quickstart: External File Sharing

**Feature**: External File Sharing
**Branch**: 001-external-file-sharing
**Last Updated**: 2025-11-12

This guide helps you get started with the External File Sharing feature.

---

## Overview

The External File Sharing feature allows users to share files from their cloud-clipboard rooms with external users via unique, time-limited URLs. Files can be shared publicly or with password protection.

**Key Features**:

- Generate unique share links for any file (up to 100MB)
- Optional password protection (8+ chars, complexity required)
- 7-day default expiration
- Access logging and statistics
- Direct download links (no landing page)
- Share management (view, revoke)

---

## Prerequisites

- Cloud Clipboard application running
- User authenticated session
- Files already uploaded to a room

---

## API Usage

### 1. Create a Share Link

Create a new share link for a file:

```typescript
import { CreateShareRequest } from "./contracts/api-types";

const request: CreateShareRequest = {
  fileId: "550e8400-e29b-41d4-a716-446655440000",
  password: "MyStr0ng!Pass", // Optional
  expiresInDays: 7,
};

const response = await fetch("/api/share", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});

const shareLink: ShareLinkResponse = await response.json();
console.log("Share URL:", shareLink.url);
```

**Example Response**:

```json
{
  "shareId": "abc123def4",
  "url": "https://app.example.com/share/abc123def4",
  "createdAt": "2025-11-12T10:30:00Z",
  "expiresAt": "2025-11-19T10:30:00Z",
  "hasPassword": true,
  "accessCount": 0
}
```

---

### 2. List Your Share Links

Get all share links created by the authenticated user:

```typescript
const response = await fetch("/api/share?status=active&limit=20", {
  credentials: "include", // Include session cookie
});

const data: ListShareLinksResponse = await response.json();
console.log(`Total shares: ${data.total}`);
data.shares.forEach((share) => {
  console.log(`${share.shareId}: ${share.originalFilename} (${share.accessCount} accesses)`);
});
```

**Example Response**:

```json
{
  "shares": [
    {
      "shareId": "abc123def4",
      "originalFilename": "report.pdf",
      "fileSize": 1048576,
      "createdAt": "2025-11-12T10:30:00Z",
      "expiresAt": "2025-11-19T10:30:00Z",
      "status": "active",
      "accessCount": 5,
      "hasPassword": true
    }
  ],
  "total": 1
}
```

---

### 3. Get Share Details

Get detailed information about a specific share link:

```typescript
const shareId = "abc123def4";
const response = await fetch(`/api/share/${shareId}`, {
  credentials: "include",
});

const details: ShareLinkDetails = await response.json();
console.log("Download URL:", details.downloadUrl);
console.log("Last accessed:", details.lastAccessedAt);
```

---

### 4. Download a Shared File (External Access)

External users can download files using the share URL:

**Option A: Simple Download**

```bash
# Browser: Navigate to URL
https://app.example.com/share/abc123def4

# Command line:
curl -O https://app.example.com/share/abc123def4/download
```

**Option B: Password-Protected Download**

```bash
# Browser: Enter password when prompted
https://app.example.com/share/abc123def4

# Command line with password:
curl -u :MyStr0ng!Pass https://app.example.com/share/abc123def4/download -o file.pdf
```

---

### 5. View Access Logs

Check who accessed a share link:

```typescript
const shareId = "abc123def4";
const response = await fetch(`/api/share/${shareId}/access?limit=50`, {
  credentials: "include",
});

const data: GetAccessLogsResponse = await response.json();
data.logs.forEach((log) => {
  console.log(`${log.timestamp}: ${log.ipAddress} - ${log.success ? "Success" : "Failed"}`);
});
```

**Example Response**:

```json
{
  "logs": [
    {
      "timestamp": "2025-11-12T11:45:00Z",
      "ipAddress": "192.0.2.1",
      "userAgent": "Mozilla/5.0...",
      "success": true,
      "bytesTransferred": 1048576
    }
  ],
  "total": 1
}
```

---

### 6. Revoke a Share Link

Delete a share link to immediately invalidate it:

```typescript
const shareId = "abc123def4";
const response = await fetch(`/api/share/${shareId}`, {
  method: "DELETE",
  credentials: "include",
});

if (response.status === 204) {
  console.log("Share link revoked successfully");
}
```

---

## Password Requirements

Passwords must meet the following complexity requirements:

- **Minimum length**: 8 characters
- **Required**:
  - At least 1 uppercase letter (A-Z)
  - At least 1 lowercase letter (a-z)
  - At least 1 number (0-9)
  - At least 1 special character (!@#$%^&\* etc.)
- **Maximum length**: 100 characters

**Valid Examples**:

- `MyStr0ng!Pass`
- `P@ssw0rd123`
- `Secure#2024`

**Invalid Examples**:

- `password` (no uppercase, no number, no special char)
- `12345678` (no letters, no special char)
- `Pass123` (only 7 characters, no special char)

---

## Error Handling

### Common Error Codes

| Code            | Description                        | Solution                                |
| --------------- | ---------------------------------- | --------------------------------------- |
| `INVALID_FILE`  | File not found or not accessible   | Verify file exists in your room         |
| `WEAK_PASSWORD` | Password doesn't meet requirements | Use a stronger password                 |
| `UNAUTHORIZED`  | Authentication required            | Include session cookie                  |
| `NOT_FOUND`     | Share link doesn't exist           | Check shareId is correct                |
| `RATE_LIMITED`  | Too many requests                  | Wait and retry with exponential backoff |

### Example Error Response

```json
{
  "error": "WEAK_PASSWORD",
  "message": "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
}
```

---

## Security Best Practices

1. **Use Password Protection**
   - Always use passwords for sensitive files
   - Share passwords through secure channels (not the same medium as the link)

2. **Set Appropriate Expiration**
   - Shorter expiration for sensitive files
   - 7 days is default for most use cases

3. **Monitor Access Logs**
   - Regularly review who accessed your shares
   - Revoke links if you see suspicious activity

4. **Revoke When Done**
   - Manually revoke links once sharing is complete
   - Don't rely solely on automatic expiration

5. **File Size Limits**
   - Maximum file size: 100MB
   - Consider compression for large files

---

## Rate Limits

| Endpoint     | Limit        | Window               |
| ------------ | ------------ | -------------------- |
| Create share | 10 requests  | Per minute, per user |
| Download     | 100 requests | Per minute, per IP   |
| Revoke share | 30 requests  | Per minute, per user |
| List shares  | 100 requests | Per minute, per user |
| Access logs  | 50 requests  | Per minute, per user |

---

## Client Examples

### Using Fetch API (JavaScript/TypeScript)

```typescript
async function createShare(fileId: string, password?: string) {
  try {
    const response = await fetch("/api/share", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include session cookie
      body: JSON.stringify({
        fileId,
        password,
        expiresInDays: 7,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    const shareLink: ShareLinkResponse = await response.json();
    return shareLink;
  } catch (error) {
    console.error("Failed to create share:", error);
    throw error;
  }
}
```

### Using cURL (Command Line)

```bash
# Create share link
curl -X POST https://app.example.com/api/share \
  -H "Content-Type: application/json" \
  -b session=your-session-cookie \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000",
    "password": "MyStr0ng!Pass",
    "expiresInDays": 7
  }'

# List share links
curl https://app.example.com/api/share \
  -b session=your-session-cookie

# Download file (no password)
curl -O https://app.example.com/share/abc123def4/download

# Download file (with password)
curl -u :MyStr0ng!Pass https://app.example.com/share/abc123def4/download -o file.pdf
```

---

## Implementation Notes

- All authenticated endpoints require a valid session cookie
- External download endpoints are public (no authentication needed)
- Passwords are hashed using bcrypt (cost factor: 12)
- Share links use base62-encoded UUID v4 for uniqueness
- Access logs are retained for 30 days, then automatically deleted
- Share links expire after 7 days (configurable at creation)
- Direct download mode (no landing page) for simplicity

---

## Testing

### Unit Tests

```bash
# Run server unit tests
bun run server:test

# Run shared package tests
bun run shared:test
```

### Integration Tests

```bash
# Run API integration tests
bun run server:test:integration
```

### End-to-End Tests

```bash
# Run E2E tests
bun run client:test:e2e
```

---

## Troubleshooting

### "Authentication Required" Error

- Ensure you're including the session cookie in requests
- Check that your session hasn't expired

### "File Not Found" Error

- Verify the fileId exists in your room
- Ensure you have permission to access the file

### "Share Link Expired" Error

- Links expire after 7 days by default
- Create a new share link with a longer expiration if needed

### "Rate Limit Exceeded" Error

- You're making requests too quickly
- Implement exponential backoff in your client code

### Downloads Fail

- Check the file still exists and hasn't been deleted
- Verify the share link hasn't been revoked
- Ensure the link hasn't expired

---

## Support

For issues or questions:

- Check the troubleshooting section above
- Review API documentation in `/contracts/openapi.yaml`
- See implementation details in `/research.md` and `/data-model.md`
