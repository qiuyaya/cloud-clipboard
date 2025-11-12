# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

实现外部文件分享功能，允许用户分享文件到外部访问并可选择配置密钥保护。

**核心功能**:

1. 生成唯一的外部分享URL，支持直接下载文件
2. 可选的8位强密码保护机制
3. 分享链接管理界面（查看、统计、撤销）
4. 30天访问日志保留，7天链接有效期

**技术方法**:

- 后端: 扩展Express.js路由，添加 `/api/share/*` 端点，实现 ShareLinkService
- 前端: React组件支持生成分享、密码设置、链接管理
- 数据模型: SharedFile、ShareLink、ShareAccessKey、ShareAccessLog 实体
- 安全: 密码哈希存储、直接下载模式、404错误处理

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9.3
**Primary Dependencies**: Bun 1.x, Express.js, Socket.IO, Zod, React, Vite
**Storage**: In-memory Map-based storage (server), Multer for file uploads
**Testing**: Vitest (unit), Supertest (integration), Playwright (E2E)
**Target Platform**: Linux server (backend), Web browsers (frontend)
**Project Type**: Web application (monorepo: shared + server + client)
**Performance Goals**: Support 100+ concurrent share links, <30s link generation, 99% monthly availability
**Constraints**: <200ms p95 for share access, 100MB max file size, 30-day log retention
**Scale/Scope**: 1000+ active users, unlimited share links, 7-day link expiry

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**Phase 0 Review**: ✅ PASSED

- Research completed with security best practices
- No constitutional violations detected

**Phase 1 Review**: ✅ PASSED

- Data model follows existing patterns (Zod schemas, TypeScript interfaces)
- API contracts documented with OpenAPI 3.0
- Monorepo structure maintained (shared + server + client)
- No new dependencies beyond existing stack
- Testing strategy aligns with existing framework (Vitest + Supertest + Playwright)
- In-memory storage consistent with existing RoomService architecture

**Final Status**: ✅ ALL GATES PASSED

No violations or complexity concerns identified. Ready to proceed to Phase 2 (task generation).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
cloud-clipboard/
├── shared/                 # Shared types and Zod schemas
│   ├── src/
│   │   ├── types.ts      # Type definitions
│   │   ├── schemas.ts    # Zod validation schemas
│   │   └── utils.ts      # Utility functions
│   └── tests/
│
├── server/                # Express.js backend
│   ├── src/
│   │   ├── routes/       # API routes (including new share routes)
│   │   ├── services/     # Business logic (ShareLinkService)
│   │   ├── models/       # Data models
│   │   ├── middleware/   # Authentication, logging
│   │   └── types.ts      # Server-specific types
│   ├── public/           # Static files (client build output)
│   └── tests/
│       ├── unit/
│       └── integration/
│
├── client/                # React frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components (including Share page)
│   │   ├── services/     # API services
│   │   └── stores/       # State management (Zustand)
│   ├── public/           # Static assets
│   └── tests/
│       ├── unit/
│       └── e2e/
│
└── specs/
    └── 001-external-file-sharing/
        ├── spec.md
        ├── plan.md
        ├── research.md
        ├── data-model.md
        ├── quickstart.md
        ├── contracts/
        └── tasks.md
```

**Structure Decision**: Using existing monorepo structure with three workspaces (shared, server, client). New feature will extend server with share link routes, client with share management UI, and shared with share-related types and schemas.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
