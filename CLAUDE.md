# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Base

- Always respond in 中文
- After any changes, verify whether related documentation needs to be updated.
- After any module’s code is modified, add or improve its test cases accordingly.
- Before committing any code, run the tests for the corresponding module; only commit if all test cases pass.

## Essential Commands

### Development

- `bun run dev` - Start both server and client in development mode (server on port 3001, client on port 3000)
- `bun run server:dev` - Start only the server (port 3001)
- `bun run client:dev` - Start only the client (port 3000)
- `bun run build` - Build all packages for production
- `bun run build:production` - Build server with production optimizations
- `bun run copy-client` - Copy client build to server public directory
- `bun run start` - Start production server (runs on port 3001)

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
  - Run full validation (all checks + tests)
  - Run build test to ensure production build works

**GitHub Actions (CI/CD)**:

- `ci.yml` - Runs on push/PR to main or develop:
  - Lint & Type Check job uses `validate:quick`
  - Includes security audit and version consistency checks
  - Parallel execution for faster results

- `test.yml` - Comprehensive test suite:
  - Quick validation on lint-and-typecheck job
  - CI validation on unit-tests job
  - Unit, integration, E2E, performance, and matrix tests

### Testing

- `bun run test` - Run all tests across all packages
- `bun run test:watch` - Run tests in watch mode
- `bun run test:integration` - Run integration tests
- `bun run test:e2e` - Run end-to-end tests

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

### Documentation Management

- `bun run docs:sync` - Check documentation consistency with code (if available)
- `bun run docs:setup` - Setup Git hooks for automatic documentation checking (if available)

## Architecture

### Monorepo Structure

This is a Bun-based monorepo with four workspaces that must be built in dependency order:

1. **`shared/`** - Core types and validation schemas using Zod
2. **`server/`** - Express.js + Socket.IO backend
3. **`client/`** - React + Vite frontend

### Key Architectural Patterns

**Shared Type System**: All types are defined in `shared/src/types.ts` and derived from Zod schemas in `shared/src/schemas.ts`. Both client and server import these for type safety.

**WebSocket Communication**: Real-time features use Socket.IO with strictly typed events defined in `ServerToClientEvents` and `ClientToServerEvents` interfaces.

**Room-Based Architecture**: Users join rooms using room keys. All data (users, messages) is scoped to rooms and stored in-memory only.

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

- Unit tests for all modules
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
- **Password Protection**: Optional password protection with auto-generated 6-character secure passwords
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
- **Consistent Behavior**: Copy buttons for messages, shares, passwords, and links all use unified feedback
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

**Unified Message UI**: Streamlined message actions for better user experience:

- **Text Messages**: Copy button moved from content area to top-right icon for cleaner interface
- **File Messages**: Download and Share buttons consolidated to top-right corner as compact icons
- **Hover Interaction**: Buttons hidden by default, appear on hover (desktop) or always visible (mobile)
- **Space Optimization**: Eliminated redundant button containers, message cards now more compact
- **Consistent Design**: Both text and file messages follow the same action button pattern
- **Mobile-First**: Touch-friendly icon sizes (h-3.5 w-3.5) with proper spacing and accessibility

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

- TypeScript 5.9.3 + Bun 1.x, Express.js, Socket.IO, Zod, React, Vite (001-external-file-sharing)
- In-memory Map-based storage (server), Multer for file uploads (001-external-file-sharing)

## Recent Changes

- 001-external-file-sharing: Added TypeScript 5.9.3 + Bun 1.x, Express.js, Socket.IO, Zod, React, Vite
