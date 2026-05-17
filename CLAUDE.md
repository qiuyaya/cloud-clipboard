# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Base

- Always respond in 中文
- After any changes, verify whether related documentation needs to be updated.
- After any module's code is modified, add or improve its test cases accordingly.
- Before committing any code, run the tests for the corresponding module; only commit if all test cases pass.
- 不要自动提交代码或推送到远程，必须等用户明确要求
- 不要自动发布版本，必须等用户明确要求

## Essential Commands

### Development

- `bun run dev` - Start client in development mode (port 3000)
- `bun run client:dev` - Start only the client (port 3000)
- `bun run build` - Build frontend for production
- `bun run copy-client` - Copy client build to server-rust public directory

### Rust Backend (server-rust/)

本地环境没有 gcc，Rust 后端必须使用 Docker 编译：

- `cd server-rust && docker build -t cloud-clipboard-rust .` - 使用 Docker 构建 Rust 后端
- `cd server-rust && docker build --target builder -t cloud-clipboard-rust-builder .` - 仅编译不导出
- **基础镜像**（首次使用需构建一次，后续复用）：
  - `docker build -t cloud-clipboard-rust-base -f- server-rust/ <<'EOF'\nFROM rust:1.93-alpine\nRUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static\nRUN cargo install cargo-watch\nEOF` - 构建预装依赖和 cargo-watch 的基础镜像
- **Watch 模式**（编辑时自动编译，无需手动重跑）：
  - `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo watch -x check` - 文件变更自动编译检查
  - `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo watch -x 'test --all-features'` - 文件变更自动运行测试
  - `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo watch -x check -x 'test --all-features'` - 先编译再测试
- 编译检查：`docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
- 运行测试：`docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features`
- 运行特定测试：`docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --test 测试文件名`
- 代码格式化检查：`docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base sh -c "rustup component add rustfmt && cargo fmt -- --check"`
- Clippy 代码质量检查：`docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base sh -c "rustup component add clippy && cargo clippy --all-targets --all-features -- -D warnings"`
- Dockerfile 位于 `server-rust/Dockerfile`，基于 `rust:1.93-alpine`
- **覆盖率镜像**（首次使用需构建一次，后续复用）：
  - `docker build -t cloud-clipboard-rust-coverage -f- server-rust/ <<'EOF'\nFROM rust:1.93-bookworm\nRUN apt-get update && apt-get install -y pkg-config openssl-dev libssl-dev && rm -rf /var/lib/apt/lists/*\nRUN cargo install cargo-tarpaulin\nEOF` - 构建预装 cargo-tarpaulin 的覆盖率镜像
- 覆盖率报告：`docker run --rm --security-opt seccomp=unconfined -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-coverage cargo tarpaulin --all-features --out Stdout --out Html --out Lcov --output-dir /app/coverage`
- 测试覆盖：15 个测试模块，包含单元测试、集成测试、安全测试等
- 测试模块包括：
  - `auth_middleware_tests.rs` - 认证中间件测试
  - `concurrency_tests.rs` - 并发安全测试
  - `files_handler_tests.rs` - 文件路由 handler 集成测试
  - `integration_tests.rs` - 集成测试
  - `logger_tests.rs` - 日志系统测试
  - `rate_limit_tests.rs` - 速率限制测试
  - `room_model_tests.rs` - 房间模型测试
  - `room_service_tests.rs` - 房间服务测试
  - `rooms_handler_tests.rs` - 房间路由 handler 集成测试
  - `share_handler_tests.rs` - 分享路由 handler 集成测试
  - `share_security_tests.rs` - 分享安全测试
  - `share_service_tests.rs` - 分享服务测试
  - `socket_integration_tests.rs` - Socket.IO 集成测试（\_\_test_harness）
  - `validation_middleware_tests.rs` - 验证中间件测试
  - `xss_security_tests.rs` - XSS 安全测试
  - `common/mod.rs` - 测试通用工具模块（含 Mock 服务实现）

### Code Quality

- `bun run lint` - Run ESLint on all TypeScript files
- `bun run lint:fix` - Auto-fix ESLint errors
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check code formatting
- `bun run type-check` - Run TypeScript compiler without emitting files
- `bun run validate` - Run all validation checks (format, lint, type-check, tests)
- `bun run validate:ci` - Run CI-optimized validation (type-check, tests)
- `bun run validate:quick` - Run quick validation (format, lint, type-check only)

### Automated Workflows

**Pre-commit Hooks (Git)**:

- `pre-commit` - Runs automatically before each commit:
  - Auto-format and fix code with lint-staged
  - Run quick validation (format, lint, type-check)
  - If test files modified, runs relevant tests

- `pre-push` - Runs automatically before each push:
  - Run full validation (format, lint, type-check, tests)

**GitHub Actions (CI/CD)**:

- `ci.yml` - Runs on push/PR to main or develop:
  - **Lint & Type Check** job - 使用 `validate:quick` 进行快速验证
  - **Test Web Application** job - 构建和测试 Web 应用
  - **Test Rust Backend** job - 使用 Docker 运行 Rust 测试：
    - 运行所有测试套件（`cargo test --all-features --no-fail-fast`）
    - Rust 代码格式化检查（`cargo fmt --check`）
    - Clippy 代码质量检查（`cargo clippy`）
  - **Security Audit** job - 安全审计和依赖检查
  - **Version Consistency Check** job - 版本一致性检查
  - **Build Status** job - 汇总所有检查结果
  - 所有作业并行执行以加快速度

- `test.yml` - Comprehensive test suite:
  - Quick validation on lint-and-typecheck job
  - CI validation on unit-tests job
  - Unit, integration, E2E, performance, and matrix tests

### Testing

- `bun run test` - Run all tests across all packages
- `bun run test:watch` - Run tests in watch mode
- `bun run test:e2e` - Run end-to-end tests

### Coverage

- `bun run test:coverage` - Run frontend test coverage report
- `bun run rust:coverage` - Run Rust backend test coverage report (requires Docker coverage image)
- `bun run rust:coverage:ci` - Run Rust backend test coverage for CI (XML + Lcov output)
- `bun run test:coverage:all` - Run coverage for both frontend and backend

### Icon Management

- `bun run icons:generate` - Generate web icons from source

### Release Management

- `bun run release` - Create a new release (prompts for version type)
- `bun run release:patch` - Create a patch release
- `bun run release:minor` - Create a minor release
- `bun run release:major` - Create a major release
- `bun run release:dry-run` - Preview release changes without publishing
- `bun run version:check` - Check version consistency across packages
- `bun run version:report` - Generate version consistency report
- `bun run version:outdated` - Check for outdated package versions

### Release Management

### Monorepo Structure

这是一个 Bun-based monorepo，包含以下工作空间：

1. **`shared/`** - Core types and validation schemas using Zod
2. **`server-rust/`** - Axum + SocketiOxide backend (Rust)
3. **`client/`** - React + Vite frontend

### Rust Backend Architecture

**框架选择**: 使用 Axum 0.8 作为 web 框架，SocketiOxide 0.15 用于 WebSocket 通信。Rust edition 2024，MSRV 1.87。

**测试架构**: 采用模块化测试设计，包含 15 个测试模块：

- **单元测试**: 各个服务和模型的独立测试
- **集成测试**: API 端点和路由的完整流程测试（使用 Mock 服务 + axum::test）
- **安全测试**: XSS 防护、分享安全、认证等安全特性测试
- **中间件测试**: 速率限制、验证、认证中间件测试
- **Socket.IO 测试**: 使用 \_\_test_harness feature 进行端到端 Socket handler 测试
- **通用测试工具**: `tests/common/mod.rs` 提供测试辅助函数

**核心依赖**:

- **Axum**: 高性能 web 框架，支持 multipart、WebSocket
- **Tokio**: 异步运行时
- **SocketiOxide**: Socket.IO 协议的 Rust 实现
- **Tower/Tower-HTTP**: 中间件栈（CORS、压缩、限流、追踪）
- **Serde**: 序列化/反序列化
- **bcrypt**: 密码加密
- **Governor**: 速率限制
- **async-trait**: 异步 trait 支持（FileManagerTrait 等服务抽象）
- **thiserror**: 错误类型派生宏

**模块结构**:

- `config.rs` - 集中配置管理（OnceLock 单例，统一读取环境变量）
- `error.rs` - 统一错误类型（AppError，实现 IntoResponse）
- `services/traits.rs` - 服务 trait 定义（RoomServiceTrait、FileManagerTrait、ShareServiceTrait）
- `services/storage.rs` - 存储后端抽象（StorageBackend trait，LocalStorage 实现）

**库导出**: `src/lib.rs` 导出所有模块供测试使用，确保测试可以访问内部实现。

### Key Architectural Patterns

**Shared Type System**: All types are defined in `shared/src/types.ts` and derived from Zod schemas in `shared/src/schemas.ts`. Both client and server import these for type safety.

**WebSocket Communication**: Real-time features use Socket.IO with strictly typed events defined in `ServerToClientEvents` and `ClientToServerEvents` interfaces.

**Room-Based Architecture**: Users join rooms using room keys. All data (users, messages) is scoped to rooms. Non-pinned rooms are stored in-memory only; pinned rooms are persisted to SQLite for survival across server restarts.

**Date Serialization Handling**: WebSocket transmission converts Date objects to strings. The `formatTimestamp` utility function in `shared/src/utils.ts` handles both Date objects and date strings to prevent RangeError exceptions.

### Critical Dependencies

**WebSocket Connection Management**: The client uses a singleton `socketService` in `client/src/services/socket.ts`. Connection stability is managed through careful useEffect dependencies in `App.tsx`.

**Message Validation**: All WebSocket messages are validated using Zod schemas. The server generates message IDs and timestamps; clients should not attempt to create complete message objects.

### Data Flow

1. **User joins room**: Client sends `JoinRoomRequest` → Server validates → Creates `User` object → Broadcasts to room
2. **Message sending**: Client sends minimal message data → Server adds ID, timestamp, sender → Validates with Zod → Broadcasts to all room participants
3. **File uploads**: Client uploads to `/api/files/upload` → Server stores and returns download URL → Message sent via WebSocket

### State Management

**Client**: React state managed in `App.tsx` with careful WebSocket event handler setup to prevent reconnection loops.

**Server**: In-memory storage using `RoomService` with `Map<RoomKey, RoomModel>`. Users are tracked in both `socketUsers` (socketId → User) and `userSockets` (userId → socketId) maps.

### Internationalization

Uses react-i18next with translations in `client/src/i18n/locales/`. All user-facing text should use `t()` function calls, not hardcoded strings.

### Important Notes

- No persistent storage - all data is in-memory only
- Files are uploaded to server storage, not database
- Maximum file size is 100MB
- Room keys must be 6-50 characters, alphanumeric with underscores/hyphens, containing both letters and numbers
- Users are automatically removed from rooms on disconnect
- New icon system implemented with SVG favicons and PWA manifest support
- Icons located in `client/public/` directory with multiple sizes for different use cases

### Common Issues and Fixes

**Date Serialization**: WebSocket transmission converts Date objects to strings. Always check for and convert string dates back to Date objects before Zod validation:

```typescript
const userWithDate = {
  ...user,
  lastSeen: typeof user.lastSeen === "string" ? new Date(user.lastSeen) : user.lastSeen,
};
```

**File Upload URLs**: Server returns absolute URLs for file downloads. The client handles both relative and absolute URL formats for backwards compatibility.

### New Features Implemented

**Browser Refresh Persistence**: Users remain in rooms after browser refresh through localStorage persistence. Auto-rejoin happens on reconnection.

**Inactivity Management**: 2-hour inactivity timer automatically logs out inactive users. Activity is tracked through mouse, keyboard, and touch events.

**Unique Usernames**: Duplicate usernames automatically get random suffixes (format: `username_abc123`) when joining rooms.

**Room Auto-Destruction**: Rooms are automatically destroyed when all users go offline or after 24 hours of inactivity. Triggers file cleanup.

**File Management**:

- Files are tracked by room and upload time
- Auto-deletion when rooms are destroyed
- 12-hour maximum retention policy
- Hourly cleanup process
- System notifications for all file operations

**System Notifications**: Clear messages for file uploads, deletions, room destruction, and auto-logout events in both English and Chinese.

**Room Password Protection**: Optional password protection for rooms with secure sharing functionality.

**Share Management Page**: Complete file sharing management interface with:

- **Navigation Access**: Accessible via Settings button in sidebar (desktop) or top navigation (mobile)
- **Full i18n Support**: Complete internationalization with Chinese and English translations
- **Theme Support**: Full dark/light theme adaptation
- **Share Listing**: View all user shares with filtering (all, active, expired, revoked)
- **Action Buttons**: Copy links, view access logs, and revoke shares with tooltips
- **Lightweight Feedback**: GitHub-style tooltips replace intrusive toast notifications
- **Status Management**: Clear visual indicators for share status
- **Two-row Layout**: Optimized button layout for better spacing and alignment

**Testing Framework**: Comprehensive test coverage with:

- **Rust Backend**: 15 个测试模块
  - 单元测试：服务、模型、工具函数
  - 集成测试：完整的 API 流程
  - 安全测试：XSS、认证、分享权限
  - 中间件测试：速率限制、验证
- Integration tests for API endpoints
- End-to-end tests for user flows

**Debug Logging System**: Configurable logging for both frontend and backend:

- Browser console debug utilities
- Server-side structured logging
- Environment-based log level control
- Colored output and timestamps

**Icon System**: Modern SVG-based icon design featuring cloud and clipboard elements with gradients. Includes:

- Main icon (`/client/public/icon.svg`) - 256x256 design
- Multiple favicon sizes (16x16, 32x32, 48x48, 180x180, 192x192, 512x512)
- PWA manifest (`/client/public/site.webmanifest`) with proper theme colors
- HTML files updated with proper favicon references and meta tags

**External File Sharing**: Secure file sharing functionality that allows creating shareable links for files with advanced access control:

- **Secure Share Links**: Generate unique 8-10 character share IDs for files
- **Access Code Protection**: Optional access code protection with auto-generated 6-character secure access codes
- **Expiration Control**: Configurable expiration time from 1-30 days with user-friendly presets
  - **UI Selection**: Users can choose from 1, 3, 7, 15, or 30 days via dropdown selector
  - **Default Setting**: 7 days is the default expiration time
  - **Full i18n Support**: Expiration options fully translated to Chinese and English
- **Access Tracking**: Detailed access logs with IP addresses, timestamps, success/failure status, and bytes transferred
- **Rate Limiting**: Independent rate limits for share creation (10/minute) and downloads (100/minute per IP)
- **RESTful API**: Complete API for creating, managing, and deleting share links
- **Direct Delete**: No intermediate "revoked" state - users can directly delete shares from active/expired lists
- **Simplified Management**: Two-state system (active/expired) instead of three (active/expired/revoked)
- **Security Features**: HTTPS encryption, input validation with Zod schemas
- **Management Interface**: Web UI for managing shares, viewing access logs, and deleting links
- **Public URL Support**: Configurable `PUBLIC_URL` environment variable for correct share link generation behind reverse proxies

**Unified User Feedback System**: Consistent, lightweight feedback across the entire application:

- **GitHub-style Tooltips**: All copy operations and key actions now use elegant, non-intrusive tooltips
- **Automatic Dismissal**: Tooltips disappear after 2 seconds without user interaction
- **Theme Adaptation**: Full support for light/dark theme with semantic color tokens
- **Consistent Behavior**: Copy buttons for messages, shares, access codes, and links all use unified feedback
- **Reduced Interference**: Eliminates disruptive toast notifications for minor actions
- **Visual Polish**: Smooth fade-in and zoom animations for professional feel

**Optimized Sidebar Layout**: Improved button organization for better usability:

- **Two-row Design**: Functions with tooltips moved to bottom row to prevent horizontal space issues
- **Aligned Icons**: Perfect vertical alignment between top and bottom rows
- **Responsive Spacing**: Fixed spacing (16px) prevents excessive stretching on large screens
- **Visual Hierarchy**: Related functions grouped logically with clear visual separation
- **Mobile Optimization**: Maintained consistency across desktop and mobile layouts
- **Larger Room Info**: Increased left padding for better room key and user count display

**Friendly Timestamp Formatting**: Enhanced message time display with human-readable formats:

- **Relative Time**: Messages within 1 hour show "刚刚" (just now) or "X分钟前" (X minutes ago)
- **Daily Context**: Today's messages show only time (e.g., "12:11")
- **Yesterday**: Yesterday's messages show "昨天 12:11"
- **This Year**: Messages within current year show "MM月DD日" (e.g., "11月14日")
- **Older Dates**: Full date-time format "YYYY/MM/DD HH:MM" for historical messages
- **Simplified Communication**: Users instantly understand message recency without mental date calculation

**Unified Message UI**: Chat-style message layout with avatars, bubbles, and collapsing:

- **Avatar**: Deterministic HSL color based on fingerprint/name, initials for CJK and Latin names
- **Chat Bubbles**: Rounded bubble layout with own/other color variants, corner cut on sender side
- **Message Collapsing**: Long messages (>6 lines) auto-collapse with gradient overlay and expand/collapse toggle
- **Action Buttons**: Always-visible compact icons (h-3.5 w-3.5) in header row — copy, download, share, recall
- **Recall Confirmation**: Inline confirmation UI with confirm/cancel buttons in header
- **Tooltip for Fingerprint**: Hover username to see full fingerprint via Radix Tooltip
- **Empty State**: Inbox icon with title/hint instead of plain text when no messages

**PWA Support**: Progressive Web App capabilities for enhanced user experience:

- Service Worker with Workbox for offline caching
- Runtime caching strategies:
  - CacheFirst for static assets and fonts
  - NetworkFirst for API calls
- Automatic cache cleanup and updates
- Install prompt component with localStorage persistence
- Update notification component for new versions
- Offline-ready message for users
- Manifest configuration for app installation
- Support for both development and production modes

**Message Link Detection**: Auto-detect URLs in chat messages and render them as clickable links:

- **URL Detection**: Recognizes `https?://` and `www.` prefixed URLs in message text
- **Safe Rendering**: Pure React component approach (no `dangerouslySetInnerHTML`), JSX auto-escapes plain text
- **New Tab**: Links open in new tab with `rel="noopener noreferrer"` for security
- **www Prefix**: `www.` URLs use `https://` prefix in href, display original text
- **Trailing Punctuation**: Automatically strips trailing `.` `,` `!` `?` `)` `]` `;` `:` from URLs
- **Overflow Protection**: `break-all` on links prevents long URL layout overflow
- **Theme Support**: Blue links with hover states for both light and dark themes

**Message Recall**: Users can recall their own sent messages:

- **Recall Request**: Client sends `RecallMessageRequest` with message ID → Server validates ownership → Broadcasts `messageRecalled` to room
- **i18n Support**: Full Chinese and English translations for recall confirmation and cancellation

**Room Pinning**: Users can pin frequently used rooms for quick access:

- **Pin/Unpin**: Socket events `pinRoom`/`roomPinned` with configurable `MAX_PINNED_ROOMS` limit
- **Creator Restriction**: Only room creator can pin/unpin rooms

**Room Share Links**: Generate invitation links for rooms:

- **Link Generation**: Socket events `shareRoomLink`/`roomLinkGenerated` for creating shareable room links

**Browser Fingerprint**: User identification across browser refreshes:

- **Fingerprint Schema**: `BrowserFingerprintSchema` in shared types, optional `fingerprint` field on `User`
- **User Validation**: `/api/rooms/validate-user` endpoint for fingerprint-based user recognition

## 文档维护指南

### 需要更新文档的场景

**新增或修改功能时**:

1. 更新 README.md 的功能特性列表（中英文）
2. 更新 CLAUDE.md 的架构说明和新功能实现部分
3. 如涉及API变更，更新相关接口文档
4. 新增页面组件时，更新组件导航和访问方式说明
5. UI/UX改进（如新反馈系统、布局调整）需同步文档

**新增或修改命令时**:

1. 在 package.json 中添加新的 scripts
2. 同步更新 CLAUDE.md 的 Essential Commands 部分
3. 确保所有重要命令都有对应的中文说明

**修改架构或依赖时**:

1. 更新 CLAUDE.md 的架构说明
2. 更新 README.md 的技术栈信息
3. 依赖增删需更新 README.md 和 package.json 说明
4. 如有重大变更，更新 CHANGELOG.md

**新增环境变量时**:

1. 更新 README.md 的环境变量部分
2. 更新相关的配置说明文档

**UI/UX重大改进时**:

1. 添加新的交互模式说明
2. 更新截图或示例（如果适用）
3. 说明用户体验改进点
4. 更新相关的最佳实践指南

### 文档一致性检查内容

自动检查包括但不限于：

- 版本号一致性（所有 package.json 文件）
- 功能特性文档与实际代码实现的匹配
- 命令文档与 package.json scripts 的一致性
- 架构说明与实际项目结构的对应
- UI/UX改进与实际实现的符合度
- 依赖变更与文档的同步

### 文档更新优先级

1. **高优先级**: 功能变更、架构调整、安全相关
2. **中优先级**: UI/UX改进、用户体验优化
3. **低优先级**: 内部实现细节、代码注释

### 最佳实践

1. **功能开发**: 新功能完成后立即更新相关文档
2. **UI/UX改进**: 同时更新用户指南和开发者文档
3. **定期维护**: 每次版本发布前全面检查文档完整性
4. **命令更新**: 添加新的 npm/bun 脚本后立即更新文档
5. **依赖管理**: 删除未使用依赖后清理相关文档引用

遵循这些指南可以确保项目文档始终与代码实现保持同步，为后续开发和维护提供准确的参考。

## Active Technologies

- **TypeScript 5.9.3 + Bun 1.x**: 前端运行时和包管理器
- **Rust (edition 2024, MSRV 1.87) + Axum 0.8 + SocketiOxide 0.15**: 后端实现
- **Zod 4**: 前端类型验证和 schema 定义
- **React 19 + Vite 7**: 前端框架和构建工具
- **@tanstack/react-virtual**: 消息列表虚拟化渲染
- In-memory Map-based storage (server-rust), Multipart for file uploads. Pinned rooms persisted to SQLite via PersistenceService.

## Recent Changes

- **Architecture Improvements** (2026-05):
  - 持久化：新增 PersistenceServiceTrait 和 SqlitePersistenceService，置顶房间消息持久化到 SQLite，服务重启后自动恢复
  - 持久化：mpsc channel + writer task 解耦同步/异步写入，fire-and-forget 语义，NoOpPersistenceService 支持禁用
  - 持久化：文件消息恢复时验证文件存在性，download_url 根据当前 PUBLIC_URL 重新生成
  - 前端：useReducer 替换多个 useState 修复 stale closure bug，提取 MessageCard/MessageList 组件，添加虚拟列表渲染，useTemporaryState 统一临时状态管理
  - 后端：集中配置管理（config.rs）、统一错误处理（error.rs/AppError）、存储后端抽象（storage.rs/StorageBackend trait）
  - 后端：服务层 trait 抽象（RoomServiceTrait/FileManagerTrait/ShareServiceTrait），AppState 改为 Arc<dyn Trait> 支持依赖注入和测试
  - 后端：JoinRoomRequest 从借用改为 owning 版本，消除生命周期参数
  - 后端：Socket handler 纯逻辑函数提取（resolve_user_id/resolve_username/resolve_device_type/join_room_core）
  - 安全：P2P 信令跨房间校验、分享链接不再存储明文提取码、CORS 生产模式收紧
  - 文件管理：新增存储配额追踪（MAX_TOTAL_STORAGE_SIZE）、RwLock poisoned 降级为 warn 日志
- 配置：新增 CLEANUP_ORPHANED_FILES_AT_STARTUP、STRICT_RATE_LIMIT_MAX_REQUESTS、DOWNLOAD_TIMEOUT、MAX_DOWNLOAD_BYTES_PER_MINUTE 环境变量
  - 测试：新增并发安全测试模块（concurrency_tests.rs），修复 rand 0.9 API 兼容性
  - 测试：后端关键模块覆盖率提升至 80%+（error.rs 72%、message.rs 100%、rate_limit.rs 98%、rooms.rs 100%、files.rs 83%、share.rs 95%、socket.rs 83%）
  - 测试：新增 Mock 服务实现（MockRoomService/MockFileManager/MockShareService）和 Socket.IO \_\_test_harness 集成测试
  - i18n：补全缺失的中文单数形式、所有硬编码字符串国际化
  - 无障碍：添加 aria-label/aria-hidden/role=status 等辅助属性
- **Mobile UI Optimization** (2026-05):
  - 键盘适配：新增 useKeyboard hook（visualViewport API），h-screen → h-dvh，输入区域键盘弹出时 fixed 定位
  - 触摸优化：统一按钮尺寸（MobileNav h-10 w-10），操作按钮 p-2 + h-4 w-4，间距 gap-3
  - 布局精简：CardHeader p-3 sm:p-6，消息气泡区分自己/他人（蓝色/灰色），侧边栏 w-[85%] max-w-xs
  - 功能补全：移动端侧边栏显示全部按钮（置顶、设置），移除 isMobile 条件
  - 滚底优化：智能滚底逻辑（新消息提示条），estimateSize 按消息类型动态估算
  - 安全区域：viewport-fit=cover，顶栏/输入区域精细化 safe-area，移除笼统 safe-area-inset
  - 代码优化：提取 detectDeviceType 到 utils/device.ts，useMediaQuery 初始值同步获取消除闪烁
- **UI Design Refresh** (2026-05):
  - 品牌色：primary 从灰色改为 indigo（light: 224 76% 48%，dark: 217 91% 60%），ring 同步
  - 圆角：全局 radius 从 0.5rem 提升至 0.625rem
  - 暗色边框：border/input 从 17.5% 提亮至 22%，增强可读性
  - 消息卡片：移除 CardHeader/CardContent，改为 Avatar + 气泡布局，自己/他人区分颜色
  - 消息折叠：超过 6 行自动折叠，带渐变遮罩和展开/收起按钮，CSS 动画过渡
  - 侧边栏重构：房间密钥一键复制（替代双击），按钮带文字标签，Separator 分隔区域
  - 分享管理：访问日志改用 Radix Dialog（替代自定义模态），状态徽章和按钮样式统一
  - 分享模态：点击遮罩关闭，关闭按钮移入 ShareButton 内部
  - Toast 限制：TOAST_LIMIT 从 1 提升至 3
  - 新增 UI 组件：Avatar（确定性颜色+首字母）、Dialog（Radix）、Separator（Radix）、Tooltip（Radix）
  - i18n：新增 expand/collapse/actions/confirm/noMessagesTitle/noMessagesHint/clickToCopy/logs.error 翻译
- **Remove Node.js Backend** (2026-03):
  - 删除 Node.js 后端 (server/)，Rust 后端成为唯一后端
  - 重写 Dockerfile 为多阶段构建（前端 + Rust 后端）
  - 更新所有 CI/CD 流程
  - 简化发布流程为单镜像
- **Rust Backend Implementation** (2026-02):
  - 新增完整的 Rust 后端实现（Axum + SocketiOxide）
  - 添加 15 个测试模块
  - 新增 `src/lib.rs` 库导出模块供测试使用
  - 更新 CI/CD 流程，添加 Rust 测试、格式化检查、Clippy 检查
  - 完善服务层实现：文件管理、房间服务、分享服务
  - 增强中间件功能和安全测试
- 001-external-file-sharing: Added TypeScript 5.9.3 + Bun 1.x, Zod, React, Vite
