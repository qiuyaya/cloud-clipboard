<!--
Sync Impact Report - Constitution Update v1.1.0 → v1.2.0
Version Change: 1.1.0 → 1.2.0
Date: 2025-11-13

Modified Principles:
- Security Requirements: Updated to reflect optional password protection (passwords are NOT mandatory by default, only enabled when user explicitly chooses)

Changes Made:
- Line 114: Updated to clarify passwords are optional with auto-generation when enabled
- Line 225: Updated version and last amended date

Templates Updated:
✅ .specify/templates/plan-template.md (already contains Constitution Check section - no changes needed)
✅ .specify/templates/spec-template.md (no specific password references)
✅ .specify/templates/tasks-template.md (no specific password references)

Follow-up Actions:
- All templates already contain proper Constitution Check references
- UI and backend have been updated to support optional passwords
- No additional changes required in dependent templates
-->

# Cloud Clipboard Constitution

**Project Constitution for Cloud Clipboard / 云剪贴板**

## Core Principles

### I. Type Safety (MUST)

All code MUST use strict TypeScript with no `any` types except explicitly justified temporary bridges. All shared data MUST use Zod schemas for runtime validation. All new features MUST include type definitions before implementation. This ensures reliability across the monorepo boundary between client, server, and shared packages.

**Rationale**: Type safety prevents runtime errors and enables confident refactoring across the three-package architecture (shared, server, client).

### II. Test-Driven Development (MUST)

All new features MUST have tests written before implementation. This includes unit tests for business logic, integration tests for API contracts, and E2E tests for user flows. The Red-Green-Refactor cycle MUST be followed: tests written first (red), then implementation to pass tests (green), then refactor for clarity.

**Rationale**: The project uses a comprehensive testing stack (Vitest, Supertest, Playwright) that must be leveraged to prevent regressions and enable confident deployment.

### III. Test Coverage Requirements (MUST)

New code MUST achieve minimum 90% test coverage for unit tests and 100% coverage for critical paths (authentication, file uploads, WebSocket events). Integration tests MUST cover all API endpoints and database operations. E2E tests MUST cover all user stories.

**Rationale**: High test coverage ensures reliability for real-time features and prevents edge cases in distributed communication.

### IV. Real-time Communication Safety (MUST)

All WebSocket communications MUST use strictly typed events defined in shared schemas. Client and server MUST validate all WebSocket messages with Zod before processing. Connection state MUST be properly managed and logged. Auto-reconnection logic MUST be tested.

**Rationale**: Real-time synchronization is core to the application; failures can cause data loss or inconsistent state across clients.

### V. User Privacy & Security (MUST)

Room-based access control MUST be enforced server-side. Passwords MUST use bcrypt with minimum cost factor 12. Session validation MUST occur on every authenticated action. User data MUST NOT be logged in plaintext. Files MUST be automatically cleaned up per retention policies (2 hours for inactive users, 12 hours for files, 30 days for access logs).

**Rationale**: Users share sensitive data across devices; security failures could expose private files or session data.

### VI. Performance & Reliability (MUST)

File uploads MUST support up to 100MB with progress indication. API responses MUST have p95 under 200ms for standard operations. WebSocket reconnection MUST complete within 5 seconds. System MUST support 100+ concurrent rooms without degradation. Auto-cleanup jobs MUST prevent memory leaks.

**Rationale**: Cloud clipboard requires fast, responsive operation; slow performance breaks the user experience for real-time sharing.

### VII. Simplicity & Minimalism (SHOULD)

Features SHOULD follow the room-based sharing model without unnecessary complexity. UI SHOULD use direct download模式 (direct download) for file sharing rather than landing pages. API SHOULD return simple JSON responses with clear error codes. Data storage SHOULD use in-memory Maps where appropriate rather than complex database setups.

**Rationale**: The core value proposition is simple device-to-device sharing; complexity reduces adoption and increases failure points.

### VIII. Internationalization (MUST)

All user-facing text MUST use i18n translation keys. New features MUST include both Chinese and English translations. UI components MUST support dynamic language switching. Date/time formatting MUST respect locale preferences.

**Rationale**: The project serves both Chinese and English users; inconsistent translation creates poor user experience for half the audience.

### IX. Error Handling (MUST)

Errors MUST return consistent JSON structures with proper HTTP status codes. 404 responses MUST be simple and not leak system details. Client MUST show user-friendly error messages without exposing internal state. All errors MUST be logged server-side with appropriate detail levels.

**Rationale**: Inconsistent error handling creates debugging nightmares and poor user experience; proper error boundaries prevent crashes and data loss.

### X. Monorepo Consistency (MUST)

Shared package MUST be source of truth for types and schemas. Server and client MUST import from shared, not duplicate definitions. Version changes in shared MUST trigger propagation to all packages. Build order MUST respect dependency graph (shared → server → client).

**Rationale**: Type drift between packages causes runtime errors and integration failures; centralizing shared code prevents this.

## Additional Constraints

### Technology Stack Requirements

- MUST use Bun as primary runtime (not Node.js or Deno)
- MUST use strict TypeScript configuration with noImplicitAny enabled
- MUST use Zod for all schema validation (server and client)
- MUST use Vitest for unit testing, Supertest for integration, Playwright for E2E
- MUST use React 18+ for client with Vite as build tool
- MUST use Express.js for server REST API
- MUST use Socket.IO for WebSocket communication
- MUST use Tailwind CSS for styling (via shadcn/ui components)

### File Management Constraints

- Files MUST NOT be stored in version control (use .gitignore)
- Uploaded files MUST be stored with unique IDs (never user-provided filenames)
- File retention MUST be enforced: 12 hours for regular files, 2 hours for room inactivity
- Access logs MUST be retained for 30 days maximum
- File size limit MUST be enforced at 100MB with clear error messages

### Security Requirements

- Room keys MUST be validated for format (6-50 chars, alphanumeric + underscore/hyphen, must include both letters and numbers)
- Share link passwords are optional: when enabled, passwords MUST be auto-generated as 6-character random strings using secure character set (excludes confusing characters: I, l, O, 0, 1)
- Session tokens MUST expire after 2 hours of inactivity
- CORS MUST be configured appropriately for production deployments
- Helmet MUST be used for security headers

### Performance Standards

- Share link generation MUST complete in under 30 seconds
- File download initiation MUST occur within 3 seconds p95
- WebSocket connection MUST establish within 2 seconds
- Memory usage MUST be monitored and auto-cleanup jobs MUST run hourly
- System MUST maintain 99% monthly availability

## Development Workflow

### Pre-commit Validation

Before each commit, developers MUST run:

1. Type checking (`bun run type-check`)
2. Linting (`bun run lint`)
3. Formatting (`bun run format`)
4. Unit tests (`bun run server:test && bun run shared:test`)
5. Quick validation (`bun run validate:quick`)

### Pre-push Validation

Before each push, developers MUST run:

1. Full validation suite (`bun run validate`)
2. Integration tests (`bun run test:integration`)
3. E2E tests (`bun run test:e2e`)
4. Build verification (`bun run build`)

### Pull Request Requirements

All PRs MUST include:

- Description of changes and rationale
- Screenshots for UI changes
- Test coverage report showing no regression
- Documentation updates for any API changes
- Verification of internationalization updates (both languages)

### Code Review Standards

Reviewers MUST verify:

- Type safety (no `any`, proper Zod schemas)
- Test coverage meets requirements
- Security implications are considered
- Performance impact is acceptable
- Internationalization is complete
- Error handling is consistent
- No console.log or debugging code remains

### Release Process

Releases MUST use semantic versioning:

- MAJOR: Breaking changes to API or data models
- MINOR: New features, enhancements
- PATCH: Bug fixes, documentation updates

Release scripts MUST:

- Update version numbers across all packages
- Generate changelog automatically
- Run full test suite before publishing
- Tag releases in git with annotated tags

## Governance

### Constitution Authority

This constitution supersedes all other project practices and documentation. Any conflict between this constitution and other files MUST result in constitution-aligned changes to those files.

### Amendment Procedure

To amend this constitution:

1. Propose changes with detailed rationale
2. Create pull request with proposed text changes
3. Review must include all active maintainers
4. Migration plan REQUIRED for any breaking changes
5. Update version in header (MAJOR.MINOR.PATCH per semantic versioning)
6. Document changes in project's CHANGELOG.md

### Compliance Verification

Every pull request MUST include a checklist verification of:

- [ ] Type safety compliance (no `any`, proper typing)
- [ ] Test coverage requirements met
- [ ] Security implications reviewed
- [ ] Performance standards maintained
- [ ] Internationalization complete
- [ ] Error handling consistent
- [ ] Documentation updated
- [ ] No dependency violations

### Complexity Justification

Any architecture decision that increases complexity beyond the current monorepo structure MUST include a written justification explaining:

- Why the simpler alternative is insufficient
- What specific problem this complexity solves
- Long-term maintenance implications
- Migration path if the complexity is removed later

**Version**: 1.2.0 | **Ratified**: 2025-11-12 | **Last Amended**: 2025-11-13
