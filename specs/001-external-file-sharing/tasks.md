# Tasks: External File Sharing

**Feature**: External File Sharing
**Branch**: 001-external-file-sharing
**Generated**: 2025-11-12
**Source Docs**: spec.md, plan.md, data-model.md, contracts/openapi.yaml, research.md

## Task Overview

- **Total Tasks**: 53
- **MVP Scope**: User Story 1 (Basic External File Sharing)
- **Parallel Opportunities**: 7 tasks marked with [P]

### User Story Summary

- **User Story 1** (P1): Basic External File Sharing - 14 tasks
- **User Story 2** (P1): Password-Protected Sharing - 7 tasks
- **User Story 3** (P2): Share URL Management - 9 tasks
- **Setup & Foundational**: 7 tasks

---

## Phase 1: Setup & Infrastructure

### Project Initialization & Dependencies

- [x] T001 [P] Add bcrypt dependency to server package.json
  - Location: `server/package.json`
  - Description: Add bcrypt with version ^5.1.1 for password hashing
  - Dependencies: None

- [x] T002 [P] Add @types/bcrypt dependency to server devDependencies
  - Location: `server/package.json`
  - Description: Add TypeScript type definitions for bcrypt
  - Dependencies: T001

- [x] T003 Create ShareService structure in server
  - Location: `server/src/services/ShareService.ts`
  - Description: Create ShareService class with basic structure and in-memory storage
  - Dependencies: T001

- [x] T004 Create share routes module in server
  - Location: `server/src/routes/share.ts`
  - Description: Create Express router for share API endpoints
  - Dependencies: T003

---

## Phase 2: Foundational Components

### Shared Types & Schemas

- [x] T005 [P] Add share-related types to shared/types.ts
  - Location: `shared/src/types.ts`
  - Description: Export SharedFile, ShareLink, ShareAccessLog interfaces
  - Dependencies: None

- [x] T006 [P] Add share-related Zod schemas to shared/schemas.ts
  - Location: `shared/src/schemas.ts`
  - Description: Export SharedFileSchema, ShareLinkSchema, ShareAccessLogSchema
  - Dependencies: T005

- [x] T007 [P] Create share utilities in shared/src/utils.ts
  - Location: `shared/src/utils.ts`
  - Description: Add base62Encode and generateShareId utilities
  - Dependencies: None

- [x] T008 Add share routes to server app initialization
  - Location: `server/src/index.ts`
  - Description: Import and register share routes in Express application
  - Dependencies: T003, T004, T006

---

## Phase 3: User Story 1 - Basic External File Sharing

**Goal**: Allow users to create share links and enable direct file downloads

**Independent Test Criteria**:

- User can create share link for a file
- External user can access share link and download file directly
- System validates share link existence and returns 404 for invalid links
- Link expires after 7 days

### Backend Implementation

- [x] T009 [P] [US1] Implement ShareService.createShare method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add createShare method that generates shareId, stores ShareLink
  - Dependencies: T005, T006, T007

- [x] T010 [P] [US1] Implement ShareService.validateShare method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add validateShare method to check share validity and expiration
  - Dependencies: T009

- [x] T011 [P] [US1] Implement ShareService.streamFile method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add streamFile method to stream file with proper headers
  - Dependencies: T010

- [x] T012 [P] [US1] Add POST /api/share route handler
  - Location: `server/src/routes/share.ts`
  - Description: Implement create share endpoint with Zod validation
  - Dependencies: T009, T006

- [x] T013 [P] [US1] Add GET /api/share/:shareId/download route handler
  - Location: `server/src/routes/share.ts`
  - Description: Implement download endpoint that streams file directly
  - Dependencies: T011

- [x] T014 [US1] Implement access logging in download handler
  - Location: `server/src/routes/share.ts`
  - Description: Log each download attempt with timestamp, IP, success/failure
  - Dependencies: T013

- [x] T015 [US1] Implement cleanup job for expired shares
  - Location: `server/src/services/ShareService.ts`
  - Description: Add cleanup method and schedule daily cron job at 00:00 UTC
  - Dependencies: T009

### Frontend Implementation

- [x] T016 [P] [US1] Create share API service methods
  - Location: `client/src/services/shareApi.ts`
  - Description: Add createShare, listShares methods with fetch API
  - Dependencies: T006, contracts/api-types.ts

- [x] T017 [P] [US1] Create ShareLinkButton React component
  - Location: `client/src/components/Share/ShareLinkButton.tsx`
  - Description: Add button to trigger share creation with file selection
  - Dependencies: T016

- [x] T018 [P] [US1] Create ShareModal React component
  - Location: `client/src/components/Share/ShareModal.tsx`
  - Description: Add modal dialog for share link creation and display
  - Dependencies: T017

- [ ] T019 [US1] Integrate ShareModal into file management UI
  - Location: `client/src/components/ClipboardRoom.tsx`
  - Description: Add "Share" button to file list items
  - Dependencies: T018

### Testing

- [ ] T020 [US1] Write unit tests for ShareService methods
  - Location: `server/tests/unit/ShareService.test.ts`
  - Description: Test createShare, validateShare, streamFile, cleanup methods
  - Dependencies: T009, T010, T011, T015

- [ ] T021 [US1] Write integration tests for share API endpoints
  - Location: `server/tests/integration/share.test.ts`
  - Description: Test POST /api/share and GET /api/share/:shareId/download
  - Dependencies: T012, T013

- [ ] T022 [US1] Write E2E test for basic sharing flow
  - Location: `client/tests/e2e/share-basic.test.ts`
  - Description: Test complete flow: create share → download file
  - Dependencies: T019

---

## Phase 4: User Story 2 - Password-Protected Sharing

**Goal**: Allow users to set passwords for share links with strong validation

**Independent Test Criteria**:

- User can set password when creating share link
- Password meets complexity requirements (8+ chars, upper, lower, number, special)
- External user must provide correct password to download
- System rejects wrong passwords and logs failed attempts

### Backend Implementation

- [ ] T023 [US2] Implement password validation in ShareService
  - Location: `server/src/services/ShareService.ts`
  - Description: Add validatePassword function checking complexity requirements
  - Dependencies: T007

- [ ] T024 [US2] Implement password hashing in createShare
  - Location: `server/src/services/ShareService.ts`
  - Description: Hash passwords with bcrypt (cost factor 12) before storing
  - Dependencies: T023

- [ ] T025 [US2] Update POST /api/share to accept optional password
  - Location: `server/src/routes/share.ts`
  - Description: Add password field to request schema and validation
  - Dependencies: T024, T006

- [ ] T026 [US2] Update GET /api/share/:shareId/download for password auth
  - Location: `server/src/routes/share.ts`
  - Description: Implement HTTP Basic Auth password check, return 401 if wrong/missing
  - Dependencies: T025

- [ ] T027 [US2] Add password to share link summary response
  - Location: `server/src/routes/share.ts`
  - Description: Add hasPassword field to share link responses
  - Dependencies: T025

### Frontend Implementation

- [ ] T028 [P] [US2] Add password input to ShareModal
  - Location: `client/src/components/Share/ShareModal.tsx`
  - Description: Add optional password field with validation feedback
  - Dependencies: T018

- [ ] T029 [US2] Add password confirmation UI
  - Location: `client/src/components/Share/ShareModal.tsx`
  - Description: Show password strength indicator and confirmation
  - Dependencies: T028

### Testing

- [ ] T030 [US2] Write unit tests for password validation
  - Location: `server/tests/unit/ShareService.test.ts`
  - Description: Test password complexity requirements and bcrypt hashing
  - Dependencies: T023, T024

- [ ] T031 [US2] Write integration tests for password-protected shares
  - Location: `server/tests/integration/share.test.ts`
  - Description: Test create share with password and download with auth
  - Dependencies: T026

- [ ] T032 [US2] Write E2E test for password-protected sharing
  - Location: `client/tests/e2e/share-password.test.ts`
  - Description: Test complete flow with password creation and access
  - Dependencies: T029

---

## Phase 5: User Story 3 - Share URL Management

**Goal**: Allow users to view, list, and revoke their share links

**Independent Test Criteria**:

- User can view list of all their share links with statistics
- User can view detailed information about a specific share link
- User can revoke a share link, making it immediately invalid
- Access logs show who downloaded each file

### Backend Implementation

- [ ] T033 [P] [US3] Implement ShareService.getUserShares method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add method to list shares by createdBy user with filters
  - Dependencies: T009

- [ ] T034 [P] [US3] Implement ShareService.getShareDetails method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add method to get detailed share information including stats
  - Dependencies: T033

- [ ] T035 [P] [US3] Implement ShareService.revokeShare method
  - Location: `server/src/services/ShareService.ts`
  - Description: Add method to mark share as revoked and invalid
  - Dependencies: T034

- [ ] T036 [US3] Add GET /api/share route handler for listing
  - Location: `server/src/routes/share.ts`
  - Description: Implement list endpoint with pagination and status filters
  - Dependencies: T033

- [ ] T037 [US3] Add GET /api/share/:shareId route handler
  - Location: `server/src/routes/share.ts`
  - Description: Implement get share details endpoint
  - Dependencies: T034

- [ ] T038 [US3] Add DELETE /api/share/:shareId route handler
  - Location: `server/src/routes/share.ts`
  - Description: Implement revoke endpoint to delete share link
  - Dependencies: T035

- [ ] T039 [US3] Add GET /api/share/:shareId/access route handler
  - Location: `server/src/routes/share.ts`
  - Description: Implement access logs endpoint with pagination
  - Dependencies: T014

### Frontend Implementation

- [ ] T040 [P] [US3] Create share management page components
  - Location: `client/src/components/Share/ShareList.tsx`
  - Description: Add component to display user's share links with actions
  - Dependencies: T036

- [ ] T041 [US3] Add navigation to share management page
  - Location: `client/src/pages/SharePage.tsx`
  - Description: Create new route and page for managing shares
  - Dependencies: T040

### Testing

- [ ] T042 [US3] Write unit tests for ShareService management methods
  - Location: `server/tests/unit/ShareService.test.ts`
  - Description: Test getUserShares, getShareDetails, revokeShare methods
  - Dependencies: T033, T034, T035

- [ ] T043 [US3] Write integration tests for share management endpoints
  - Location: `server/tests/integration/share.test.ts`
  - Description: Test GET /api/share, GET /api/share/:shareId, DELETE /api/share/:shareId
  - Dependencies: T036, T037, T038

- [ ] T044 [US3] Write E2E test for share management flow
  - Location: `client/tests/e2e/share-management.test.ts`
  - Description: Test complete flow: create → list → view details → revoke
  - Dependencies: T041

---

## Phase 6: Polish & Cross-Cutting Concerns

### Documentation & Integration

- [ ] T045 Update client API service with all new endpoints
  - Location: `client/src/services/shareApi.ts`
  - Description: Add getShare, revokeShare, getAccessLogs methods
  - Dependencies: T037, T038, T039

- [ ] T046 Add error handling for all API endpoints
  - Location: `server/src/routes/share.ts`
  - Description: Implement consistent error responses with proper HTTP status codes
  - Dependencies: T012, T013, T025, T036, T037, T038

- [ ] T047 Implement rate limiting for share endpoints
  - Location: `server/src/middleware/rateLimiter.ts`
  - Description: Add rate limiting middleware (10 req/min create, 100 req/min download)
  - Dependencies: All route handlers

- [ ] T048 Update server types with share-related interfaces
  - Location: `server/src/types.ts`
  - Description: Add server-specific types for share operations
  - Dependencies: T005, T006

- [ ] T049 Update client i18n translations
  - Location: `client/src/i18n/locales/{en,zh}/common.json`
  - Description: Add translation keys for share-related UI text
  - Dependencies: T018, T028, T040

- [ ] T050 Implement upload progress and error recovery for large files
  - Location: `client/src/components/Share/ShareModal.tsx`
  - Description: Add progress bar and retry mechanism for large file uploads (>10MB)
  - Dependencies: T018

- [ ] T051 Implement user feedback collection system
  - Location: `client/src/components/Share/SharePage.tsx`
  - Description: Add feedback modal to collect user satisfaction ratings (4.0/5.0 target)
  - Dependencies: T041

- [ ] T052 Add performance monitoring for share operations
  - Location: `server/src/services/ShareService.ts`
  - Description: Track share creation/download timing for SC-003, SC-005 metrics
  - Dependencies: T009, T011

- [ ] T053 Run full test suite and verify all tests pass
  - Location: `root directory`
  - Description: Execute bun run test and bun run validate to ensure quality
  - Dependencies: All test tasks

---

## Dependencies & Completion Order

### Critical Path (Sequential)

```
Setup → Foundational → US1 Backend → US1 Frontend → US1 Tests
                                          ↓
                                 US2 Backend → US2 Frontend → US2 Tests
                                                     ↓
                                      US3 Backend → US3 Frontend → US3 Tests
                                                                  ↓
                                              Polish & Cross-Cutting Concerns
```

### Parallel Opportunities (can run concurrently)

- T001-T004 (Setup tasks)
- T005-T008 (Foundational tasks)
- T009-T011, T012-T013, T014-T015 (US1 backend can be split)
- T016-T019 (US1 frontend)
- T023-T027 (US2 backend)
- T028-T029 (US2 frontend)
- T033-T035, T036-T039 (US3 backend)
- T040-T041 (US3 frontend)

---

## Implementation Strategy

### MVP Scope (User Story 1 only)

If you want to deliver the minimum viable product first:

**Priority Order**:

1. Complete Phase 1 (Setup) - Tasks T001-T004
2. Complete Phase 2 (Foundational) - Tasks T005-T008
3. Complete Phase 3 (US1 Backend) - Tasks T009-T015
4. Complete Phase 3 (US1 Frontend) - Tasks T016-T019
5. Complete Phase 3 (US1 Tests) - Tasks T020-T022

**What you get**:

- Users can create share links
- External users can download files directly
- Links expire after 7 days
- Basic access logging
- Full test coverage

**Time Estimate**: ~2-3 days for MVP

### Full Feature Scope

After MVP, implement User Story 2 and User Story 3 for the complete feature.

**Additional Time Estimate**: ~3-4 days for remaining stories

---

## File Paths Reference

### Shared Package

- `shared/src/types.ts` - Type definitions
- `shared/src/schemas.ts` - Zod validation schemas
- `shared/src/utils.ts` - Utility functions

### Server Package

- `server/src/services/ShareService.ts` - Share business logic
- `server/src/routes/share.ts` - Share API routes
- `server/src/app.ts` - App initialization
- `server/src/middleware/rateLimiter.ts` - Rate limiting
- `server/src/types.ts` - Server types
- `server/tests/unit/ShareService.test.ts` - Unit tests
- `server/tests/integration/share.test.ts` - Integration tests

### Client Package

- `client/src/services/shareApi.ts` - API client
- `client/src/components/Share/` - Share components
- `client/src/pages/SharePage.tsx` - Share management page
- `client/src/i18n/locales/` - Translations
- `client/tests/e2e/` - End-to-end tests

---

## Testing Strategy

### Unit Tests (Vitest)

- ShareService methods (create, validate, stream, cleanup, etc.)
- Password validation logic
- Share link management (list, revoke, etc.)

### Integration Tests (Supertest)

- POST /api/share (create share link)
- GET /api/share/:shareId/download (download file)
- GET /api/share (list shares)
- GET /api/share/:shareId (get details)
- DELETE /api/share/:shareId (revoke share)
- GET /api/share/:shareId/access (get access logs)
- Password-protected share flows
- Error handling (404, 401, etc.)

### End-to-End Tests (Playwright)

- User Story 1: Create share → Download file
- User Story 2: Create share with password → Download with password
- User Story 3: Create share → List → View details → Revoke
- Password validation UI
- Share management UI

---

## Quality Gates

All tasks must pass before moving to production:

1. ✅ All TypeScript compilation passes (bun run type-check)
2. ✅ All linting passes (bun run lint)
3. ✅ All unit tests pass (bun run server:test, shared:test)
4. ✅ All integration tests pass (bun run server:test:integration)
5. ✅ All E2E tests pass (bun run client:test:e2e)
6. ✅ All code formatting passes (bun run format)
7. ✅ All validation passes (bun run validate)

---

## Success Criteria

After completing all tasks:

- ✅ Users can create share links for files (up to 100MB)
- ✅ Optional password protection with 8+ character complexity
- ✅ External users can download files via share URLs
- ✅ Direct download mode (no landing page)
- ✅ Links expire after 7 days (configurable)
- ✅ Users can view and manage their share links
- ✅ Users can revoke share links immediately
- ✅ Access logs track all download attempts (30-day retention)
- ✅ 100% test coverage on new code
- ✅ System handles 100+ concurrent shares
- ✅ 95%+ share links access in under 3 seconds
- ✅ 99% monthly availability
