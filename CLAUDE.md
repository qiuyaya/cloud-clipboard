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

### Code Quality

- `bun run lint` - Run ESLint on all TypeScript files
- `bun run type-check` - Run TypeScript compiler without emitting files

### Testing

- `bun run test` - Run all tests across all packages
- `bun run test:watch` - Run tests in watch mode
- `bun run test:coverage` - Generate test coverage reports
- `bun run test:integration` - Run integration tests
- `bun run test:e2e` - Run end-to-end tests

### Icon Management

- `bun run icons:generate` - Generate web icons from source

### Release Management

- `bun run release` - Create a new release (prompts for version type)
- `bun run release:patch` - Create a patch release
- `bun run release:minor` - Create a minor release
- `bun run release:major` - Create a major release
- `bun run version:check` - Check version consistency across packages

### Documentation Management

- `bun run docs:sync` - Check documentation consistency with code
- `bun run docs:setup` - Setup Git hooks for automatic documentation checking

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

**Testing Framework**: Comprehensive test coverage with:

- Unit tests for all modules
- Integration tests for API endpoints
- End-to-end tests for user flows
- Automated test coverage reporting

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

**新增或修改命令时**:

1. 在 package.json 中添加新的 scripts
2. 同步更新 CLAUDE.md 的 Essential Commands 部分
3. 确保所有重要命令都有对应的中文说明

**修改架构或依赖时**:

1. 更新 CLAUDE.md 的架构说明
2. 更新 README.md 的技术栈信息
3. 如有重大变更，更新 CHANGELOG.md

**新增环境变量时**:

1. 更新 README.md 的环境变量部分
2. 更新相关的配置说明文档

### 文档一致性检查内容

自动检查包括但不限于：

- 版本号一致性（所有 package.json 文件）
- 功能特性文档与实际代码实现的匹配
- 命令文档与 package.json scripts 的一致性
- 架构说明与实际项目结构的对应

### 最佳实践

1. **功能开发**: 新功能完成后立即更新相关文档
2. **定期维护**: 每次版本发布前全面检查文档完整性
3. **命令更新**: 添加新的 npm/bun 脚本后立即更新文档

遵循这些指南可以确保项目文档始终与代码实现保持同步，为后续开发和维护提供准确的参考。
