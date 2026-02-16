# Cloud Clipboard 系统优化计划

> 版本: 2.2.0 | 编写日期: 2026-02-16
> 本文档为可执行的优化清单，每个任务包含具体的改动位置、改动方式和验证方法。

---

## 一、服务端日志治理（优先级：高）

### 问题

服务端 20+ 处使用 `console.log`/`console.error` 直接输出，绕过了已有的 `log` 工具（`server/src/utils/logger.ts`）。生产环境中这些日志无法按级别过滤，DEBUG 信息泄漏到 stdout。

### 任务 1.1：清除 `server/src/index.ts` 中的 DEBUG 日志

**文件**: `server/src/index.ts`

**改动**:

- 第 26-28 行：删除 3 行 `console.log("DEBUG: ...")`
- 第 32-33 行：删除 2 行 `console.log("DEBUG: ...")`
- 第 127 行：`console.log(...)` → `log.info(...)`
- 第 211 行：`console.error("Unhandled error:", error)` → `log.error("Unhandled error", { error }, "Server")`

```typescript
// 第 26-28, 32-33 行：直接删除以下 5 行
// console.log("DEBUG: NODE_ENV =", process.env.NODE_ENV);
// console.log("DEBUG: isProduction =", isProduction);
// console.log("DEBUG: staticPath =", staticPath);
// console.log("DEBUG: ALLOW_HTTP =", process.env.ALLOW_HTTP);
// console.log("DEBUG: allowHttp =", allowHttp);

// 第 127 行：替换为
log.info(
  "Room destroyed - files deleted",
  { roomKey, deletedFileCount: deletedFiles.length },
  "Server",
);

// 第 211 行：替换为
log.error("Unhandled error", { error }, "Server");
```

### 任务 1.2：治理 `RoomService.ts` 中的 console

**文件**: `server/src/services/RoomService.ts`

**改动**:

- 文件顶部添加: `import { log } from "../utils/logger";`
- 第 162 行: `console.log(...)` → `log.info("Room has no online users - destroying", { roomKey: key }, "RoomService")`
- 第 189 行: `console.log(...)` → `log.info("Cleaned up inactive room after 24h", { roomKey: key }, "RoomService")`
- 第 201-204 行: `console.log(...)` → `log.debug("Room cleanup stats", { checked: checkedRooms, cleaned: cleanedRooms, active: this.rooms.size }, "RoomService")`

### 任务 1.3：治理 `FileManager.ts` 中的 console

**文件**: `server/src/services/FileManager.ts`

**改动**:

- 文件顶部添加: `import { log } from "../utils/logger";`
- 第 65 行: `console.log(...)` → `log.info("Removing stale orphan file", { filename: entry.name }, "FileManager")`
- 第 69 行: `console.error(...)` → `log.error("Failed to remove orphan file", { filename: entry.name, error: unlinkError }, "FileManager")`
- 第 75 行: `console.log(...)` → `log.info("Orphan file scan completed", {}, "FileManager")`
- 第 77 行: `console.error(...)` → `log.error("Orphan file scan failed", { error }, "FileManager")`
- 第 146 行: `console.error(...)` → `log.error("Failed to unlink file", { path: file.path, error: unlinkError }, "FileManager")`
- 第 165 行: `console.log(...)` → `log.info("File deleted", { filename: file.filename, reason }, "FileManager")`
- 第 168 行: `console.error(...)` → `log.error("Failed to delete file", { fileId, error }, "FileManager")`
- 第 185 行: `console.log(...)` → `log.info("Room files deleted", { roomKey, count: deletedFiles.length }, "FileManager")`
- 第 206-208 行: `console.log(...)` → `log.info("File cleanup completed", { expired: expiredFiles.length, totalDeleted: this.deletedFileCount }, "FileManager")`

### 任务 1.4：治理 `server/src/routes/` 中的 console

**文件**: `server/src/routes/share.ts`, `server/src/routes/files.ts`

**改动**: 同上模式，将所有 `console.log`/`console.error` 替换为 `log.info`/`log.error`，添加结构化上下文参数。具体涉及:

- `share.ts` 第 426 行, 第 567 行
- `files.ts` 第 164 行, 第 171 行, 第 226 行, 第 262 行

**验证**:

```bash
# 确认无 console.log 残留
grep -rn "console\.\(log\|error\|warn\)" server/src/ --include="*.ts" | grep -v "node_modules" | grep -v "__tests__"
# 运行服务端测试
cd server && bun run test
```

---

## 二、添加 React Error Boundary（优先级：高）

### 问题

客户端没有 Error Boundary 组件。任何子组件运行时错误（如 undefined 属性访问）会导致整个应用白屏崩溃，用户只能手动刷新。

### 任务 2.1：创建 ErrorBoundary 组件

**新建文件**: `client/src/components/ErrorBoundary.tsx`

```tsx
import React, { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { debug } from "@/utils/debug";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    debug.error("React Error Boundary caught error", { error, errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
            <p className="text-muted-foreground text-sm max-w-md">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### 任务 2.2：在应用入口包裹 ErrorBoundary

**文件**: `client/src/main.tsx`

**改动**: 在 `<App />` 外层包裹 `<ErrorBoundary>`

```tsx
import { ErrorBoundary } from "@/components/ErrorBoundary";

// 在 render 中:
<ErrorBoundary>
  <App />
</ErrorBoundary>;
```

### 任务 2.3：为 i18n 添加错误处理文案

**文件**: `client/src/i18n/locales/zh.json` 和 `en.json`

**改动**: 在合适位置添加 `errorBoundary` 字段（如有需要可本地化 fallback UI 中的文案）。

**验证**:

```bash
cd client && bun run test
# 手动验证：在某个组件中临时 throw Error，确认 fallback 出现
```

---

## 三、魔法数字提取为共享常量（优先级：高）

### 问题

关键业务参数散落在各文件中，修改时容易遗漏：

- 文件保留时间 12 小时 → `FileManager.ts:21`
- 文件清理间隔 10 分钟 → `FileManager.ts:38`
- 房间不活跃阈值 24 小时 → `RoomService.ts:172`
- 房间清理间隔 1 分钟 → `RoomService.ts:24`
- 文件大小上限 100MB → `schemas.ts:79`, `schemas.ts:198`
- 用户名长度上限 50 → `schemas.ts:41`
- RoomKey 长度 6-50 → `schemas.ts:8-9`
- Socket 重连次数 5 → `client/src/services/socket.ts:55`
- Socket 超时 20 秒 → `client/src/services/socket.ts:56`

### 任务 3.1：在 shared 包中创建常量文件

**新建文件**: `shared/src/constants.ts`

```typescript
// ====== 服务端常量 ======

/** 文件最大保留时间（小时） */
export const FILE_RETENTION_HOURS = 12;

/** 文件清理间隔（毫秒） */
export const FILE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

/** 房间不活跃销毁阈值（毫秒） */
export const ROOM_INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 小时

/** 房间清理间隔（毫秒） */
export const ROOM_CLEANUP_INTERVAL_MS = 1 * 60 * 1000; // 1 分钟

/** 文件大小上限（字节） */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/** 用户名最大长度 */
export const MAX_USERNAME_LENGTH = 50;

/** Room Key 最小长度 */
export const ROOM_KEY_MIN_LENGTH = 6;

/** Room Key 最大长度 */
export const ROOM_KEY_MAX_LENGTH = 50;

// ====== 客户端常量 ======

/** Socket 重连尝试次数 */
export const SOCKET_RECONNECTION_ATTEMPTS = 5;

/** Socket 重连延迟（毫秒） */
export const SOCKET_RECONNECTION_DELAY_MS = 1000;

/** Socket 连接超时（毫秒） */
export const SOCKET_TIMEOUT_MS = 20000;

/** 用户不活跃自动登出时间（毫秒） */
export const USER_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 小时
```

### 任务 3.2：从 `shared/src/index.ts` 导出常量

**文件**: `shared/src/index.ts`

**改动**: 添加 `export * from "./constants";`

### 任务 3.3：在各文件中引用常量替换硬编码值

**逐文件替换**:

| 文件                                     | 原代码                            | 替换为                                               |
| ---------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `server/src/services/FileManager.ts:21`  | `private maxRetentionHours = 12;` | `private maxRetentionHours = FILE_RETENTION_HOURS;`  |
| `server/src/services/FileManager.ts:38`  | `10 * 60 * 1000`                  | `FILE_CLEANUP_INTERVAL_MS`                           |
| `server/src/services/RoomService.ts:24`  | `1 * 60 * 1000`                   | `ROOM_CLEANUP_INTERVAL_MS`                           |
| `server/src/services/RoomService.ts:172` | `24 * 60 * 60 * 1000`             | `ROOM_INACTIVE_THRESHOLD_MS`                         |
| `shared/src/schemas.ts:79`               | `100 * 1024 * 1024`               | `MAX_FILE_SIZE_BYTES`                                |
| `shared/src/schemas.ts:198`              | `100 * 1024 * 1024`               | `MAX_FILE_SIZE_BYTES`                                |
| `shared/src/schemas.ts:8`                | `.min(6, ...)`                    | `.min(ROOM_KEY_MIN_LENGTH, ...)`                     |
| `shared/src/schemas.ts:9`                | `.max(50, ...)`                   | `.max(ROOM_KEY_MAX_LENGTH, ...)`                     |
| `shared/src/schemas.ts:41`               | `.max(50, ...)`                   | `.max(MAX_USERNAME_LENGTH, ...)`                     |
| `client/src/services/socket.ts:55`       | `reconnectionAttempts: 5`         | `reconnectionAttempts: SOCKET_RECONNECTION_ATTEMPTS` |
| `client/src/services/socket.ts:56`       | `timeout: 20000`                  | `timeout: SOCKET_TIMEOUT_MS`                         |

**验证**:

```bash
bun run test          # 全量测试
bun run type-check    # 类型检查
```

---

## 四、客户端代码分割 / 懒加载（优先级：高）

### 问题

所有页面（含 SharePage）打包在一个 chunk 中。SharePage 是低频页面，首屏无需加载。

### 任务 4.1：SharePage 懒加载

**文件**: `client/src/App.tsx`

**改动**:

```typescript
// 第 4 行：删除静态导入
// import { SharePage } from "@/pages/SharePage";

// 替换为动态导入
import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
const SharePage = lazy(() => import("@/pages/SharePage").then((m) => ({ default: m.SharePage })));
```

在渲染 SharePage 的地方（第 145-153 行）包裹 Suspense:

```tsx
if (showSharePage && currentUser) {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        }
      >
        <SharePage userId={currentUser.id} onBack={handleBackFromShare} />
      </Suspense>
      <PWAInstallPrompt />
      <PWAUpdatePrompt />
      <Toaster />
    </>
  );
}
```

### 任务 4.2：确认 SharePage 有 named export

**文件**: `client/src/pages/SharePage.tsx`

**检查**: 确认文件导出方式兼容上述 `lazy()` 调用。如果是 `export function SharePage`，上面的 `.then(m => ({ default: m.SharePage }))` 是正确的。如果已有 `export default`，可直接 `lazy(() => import("@/pages/SharePage"))`。

**验证**:

```bash
cd client && bun run build    # 检查产物是否生成单独 chunk
ls -la dist/assets/           # 应看到额外的 chunk 文件
bun run test
```

---

## 五、移除未使用的 zustand 依赖（优先级：高）

### 问题

根 `package.json` 声明了 `zustand: ^5.0.8`，但全项目无任何 import 引用，属于无效依赖。

### 任务 5.1：移除 zustand

**文件**: `package.json`

**改动**: 从 `dependencies` 中删除 `"zustand": "^5.0.8"` 行。

```bash
# 执行
cd /home/cc/workspace/cloud-clipboard
bun remove zustand
bun install
```

**验证**:

```bash
grep -rn "zustand" --include="*.ts" --include="*.tsx" client/ server/ shared/  # 应无结果
bun run build   # 构建通过
bun run test    # 测试通过
```

---

## 六、Socket 事件调试包装按环境控制（优先级：中）

### 问题

`client/src/services/socket.ts` 第 78-88 行对 `emit` 和 `onAny` 做了调试包装，生产环境也会执行，增加每次消息收发的开销。

### 任务 6.1：条件化调试包装

**文件**: `client/src/services/socket.ts`

**改动**: 将第 78-88 行用环境判断包裹：

```typescript
// 仅在开发环境启用事件调试
if (import.meta.env.DEV) {
  const originalEmit = this.socket.emit.bind(this.socket);
  this.socket.emit = function (event: any, ...args: any[]) {
    debug.debug("Socket sending event", { event, args });
    return originalEmit(event, ...args);
  } as typeof this.socket.emit;

  this.socket.onAny((event: string, ...args: any[]) => {
    debug.debug("Socket received event", { event, args });
  });
}
```

**验证**:

```bash
cd client && bun run build   # 生产构建不应包含调试代码（tree-shaking）
bun run test
```

---

## 七、SocketService 中 handleJoinRoom 与 handleJoinRoomWithPassword 逻辑去重（优先级：中）

### 问题

`server/src/services/SocketService.ts` 中 `handleJoinRoom`（第 255-448 行）和 `handleJoinRoomWithPassword`（第 451-576 行）有大量重复逻辑：

- 指纹检测和已有用户重连（约 40 行）
- 用户名去重（约 15 行）
- User 对象创建和 socket 加入（约 20 行）
- 事件发送（userJoined, userList, messageHistory, roomPinned）

### 任务 7.1：提取公共方法

**文件**: `server/src/services/SocketService.ts`

**改动**: 抽取私有方法 `processUserJoin`：

```typescript
private processUserJoin(
  socket: any,
  roomKey: string,
  userData: { name?: string; deviceType?: string },
  fingerprint?: { hash: string },
  room: RoomModel,
): void {
  const existingUsers = room.getUserList();

  // 1. 指纹检测和重连逻辑
  let userId: string;
  let fp: string | undefined;

  if (fingerprint) {
    fp = fingerprint.hash;
    userId = generateUserIdFromFingerprint(fp);

    const existingUser = existingUsers.find((u) => u.fingerprint === fp);
    if (existingUser) {
      // 重连逻辑...（复用现有代码）
      return;
    }
  } else {
    userId = generateUserId();
  }

  // 2. 用户名去重逻辑...
  // 3. 创建 User 对象...
  // 4. 加入 room 并发送事件...
}
```

然后 `handleJoinRoom` 和 `handleJoinRoomWithPassword` 各自只保留验证和权限检查逻辑，核心流程调用 `processUserJoin`。

**验证**:

```bash
cd server && bun run test
# 重点关注: SocketService 相关测试用例全部通过
```

---

## 八、文件哈希去重修复（优先级：中）

### 问题

`server/src/services/FileManager.ts:19` 的 `hashToFileId` Map 每个哈希只存一个文件 ID。如果两个不同房间上传了相同文件，第二次会覆盖第一次的映射，导致第一个房间删除文件时，哈希映射仍指向已删除文件。

### 任务 8.1：改为一对多映射

**文件**: `server/src/services/FileManager.ts`

**改动**:

```typescript
// 第 19 行：修改类型
private hashToFileId: Map<string, Set<string>> = new Map(); // 哈希到文件ID集合的映射

// 第 91-93 行 addFile 中：
if (fileRecord.hash) {
  if (!this.hashToFileId.has(fileRecord.hash)) {
    this.hashToFileId.set(fileRecord.hash, new Set());
  }
  this.hashToFileId.get(fileRecord.hash)!.add(fileRecord.id);
}

// 第 105-107 行 getFileIdByHash：返回集合中第一个有效文件
getFileIdByHash(hash: string): string | undefined {
  const fileIds = this.hashToFileId.get(hash);
  if (!fileIds) return undefined;
  for (const id of fileIds) {
    if (this.files.has(id)) return id;
  }
  return undefined;
}

// deleteFile 方法中，删除文件后从 hash 映射中移除:
if (file.hash) {
  const fileIds = this.hashToFileId.get(file.hash);
  if (fileIds) {
    fileIds.delete(fileId);
    if (fileIds.size === 0) {
      this.hashToFileId.delete(file.hash);
    }
  }
}
```

**验证**:

```bash
cd server && bun run test
# 建议补充测试用例：两个房间上传相同文件，删除一个后另一个仍可访问
```

---

## 九、消息分页支持（优先级：中）

### 问题

`RoomService.getMessagesInRoom` 和 `SocketService.handleJoinRoom` 中 `messageHistory` 一次发送全部消息。消息量大时（长时间活跃房间），会有内存和带宽问题。

### 任务 9.1：服务端添加消息分页参数

**文件**: `server/src/models/Room.ts`

**改动**: `getMessages` 方法已支持 `limit` 参数，确认其实现正确。若未实现，添加:

```typescript
getMessages(limit?: number, before?: string): (TextMessage | FileMessage)[] {
  const msgs = this.messages;
  if (before) {
    const idx = msgs.findIndex(m => m.id === before);
    if (idx > 0) {
      const start = Math.max(0, idx - (limit || 50));
      return msgs.slice(start, idx);
    }
  }
  if (limit) {
    return msgs.slice(-limit);
  }
  return msgs;
}
```

### 任务 9.2：首次加入只发送最近 100 条消息

**文件**: `server/src/services/SocketService.ts`

**改动**: 在 `handleJoinRoom` 第 414 行：

```typescript
// 原: const messages = this.roomService.getMessagesInRoom(validatedData.roomKey);
const messages = this.roomService.getMessagesInRoom(validatedData.roomKey, 100);
```

同理修改 `handleJoinRoomWithPassword` 中的 messageHistory 发送（第 500 行、第 559 行）。

### 任务 9.3：（可选）添加加载更多消息的 Socket 事件

**文件**: `server/src/services/SocketService.ts`

添加 `loadMoreMessages` 事件处理:

```typescript
socket.on("loadMoreMessages", (data: { roomKey: string; beforeId: string; limit?: number }) => {
  const messages = this.roomService.getMessagesInRoom(
    data.roomKey,
    data.limit || 50,
    data.beforeId,
  );
  socket.emit("messageHistory", messages);
});
```

客户端相应添加触发逻辑（滚动到顶部时加载）。此为可选项，可后续迭代。

**验证**:

```bash
cd server && bun run test
```

---

## 十、速率限制清理优化（优先级：中）

### 问题

`SocketService.ts:96-103` 的 `cleanupRateLimits` 每 5 分钟遍历整个 `messageRateLimits` Map，对已过期的条目做删除。当在线连接数多时，这是不必要的全量扫描。

### 任务 10.1：在 checkRateLimit 中惰性清理

**文件**: `server/src/services/SocketService.ts`

**改动**: 在 `checkRateLimit` 方法（第 75-94 行）中，当检测到过期窗口时直接重置，无需额外清理：

```typescript
private checkRateLimit(socketId: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const limit = this.messageRateLimits.get(socketId);

  if (!limit || now > limit.resetTime) {
    this.messageRateLimits.set(socketId, {
      count: 1,
      resetTime: now + windowMs,
    });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}
```

当前实现已经在 `checkRateLimit` 中处理了过期窗口。但 `cleanupRateLimits` 仍在遍历清理断开连接的遗留数据。

**优化方案**: 在 `handleDisconnect` 中直接清理该 socket 的速率限制数据：

```typescript
// handleDisconnect 方法中添加：
this.messageRateLimits.delete(socket.id);
```

然后将 `cleanupRateLimits` 的清理间隔从 5 分钟改为 30 分钟（仅作为兜底），或直接移除定时清理。

**验证**:

```bash
cd server && bun run test
```

---

## 十一、App.tsx Props 传递优化（优先级：低）

### 问题

`App.tsx` 向 `ClipboardRoom` 传递了 12 个 props（第 176-190 行），阅读和维护成本高。

### 任务 11.1：创建 RoomContext

**新建文件**: `client/src/contexts/RoomContext.tsx`

```typescript
import { createContext, useContext } from "react";
import type { User, TextMessage, FileMessage, RoomKey } from "@cloud-clipboard/shared";

interface RoomContextValue {
  roomKey: RoomKey;
  currentUser: User;
  users: User[];
  messages: (TextMessage | FileMessage)[];
  hasRoomPassword: boolean;
  isPinned: boolean;
  onSendMessage: (content: string) => void;
  onSendFile: (file: File) => void;
  onLeaveRoom: (options?: { silent?: boolean }) => void;
  onSetRoomPassword: (data: any) => void;
  onShareRoomLink: () => void;
  onNavigateToShare: () => void;
  onPinRoom: (data: any) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export const RoomProvider = RoomContext.Provider;

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within RoomProvider");
  return ctx;
}
```

### 任务 11.2：在 App.tsx 中使用 RoomProvider

**文件**: `client/src/App.tsx`

用 `<RoomProvider value={{...}}>` 包裹 `<ClipboardRoom />`，ClipboardRoom 内部通过 `useRoom()` 获取数据，不再需要逐个接收 props。

### 任务 11.3：重构 ClipboardRoom 组件

**文件**: `client/src/components/ClipboardRoom.tsx`

移除所有 props 定义，改用 `const { roomKey, currentUser, ... } = useRoom();`

> 注意：这是较大重构，需要同时修改 ClipboardRoom 及其子组件。建议在独立分支完成。

**验证**:

```bash
cd client && bun run test
bun run type-check
```

---

## 十二、@types/dompurify 移至 devDependencies（优先级：低）

### 问题

根 `package.json` 中 `@types/dompurify` 在 `dependencies` 而非 `devDependencies` 中。类型包不应出现在生产依赖。

### 任务 12.1：移动依赖

```bash
cd /home/cc/workspace/cloud-clipboard
# 从 dependencies 移到 devDependencies
bun remove @types/dompurify
bun add -d @types/dompurify
```

**验证**:

```bash
bun run build
bun run type-check
```

---

## 十三、PWA 缓存策略优化（优先级：低）

### 问题

`client/vite.config.ts` 中 API 请求使用 `NetworkOnly`，离线时用户会看到空白。可以对非关键 API 使用 `NetworkFirst` 加 fallback。

### 任务 13.1：API 缓存策略改为 NetworkFirst

**文件**: `client/vite.config.ts`

**改动**: 第 78-85 行

```typescript
// 只对 health 和 rooms 等只读 GET 请求使用 NetworkFirst
{
  urlPattern: /\/api\/(health|rooms\/info)/i,
  handler: "NetworkFirst",
  options: {
    cacheName: "api-readonly-cache",
    networkTimeoutSeconds: 3,
    expiration: {
      maxEntries: 20,
      maxAgeSeconds: 60, // 1 分钟
    },
  },
},
// 其他 API（上传、修改等）保持 NetworkOnly
{
  urlPattern: /\/api\//i,
  handler: "NetworkOnly",
  options: {
    cacheName: "api-cache",
  },
},
```

**验证**:

```bash
cd client && bun run build
# 手动测试：打开应用 → 断网 → 验证基础信息仍可展示
```

---

## 执行顺序建议

按照依赖关系和风险程度，建议以下执行顺序:

| 阶段         | 任务                        | 预估工作量 | 风险 |
| ------------ | --------------------------- | ---------- | ---- |
| **第一阶段** | 任务 1（日志治理）          | 1-2 小时   | 低   |
|              | 任务 5（移除 zustand）      | 10 分钟    | 低   |
|              | 任务 12（@types 移位）      | 10 分钟    | 低   |
|              | 任务 6（Socket 调试条件化） | 30 分钟    | 低   |
| **第二阶段** | 任务 3（常量提取）          | 1-2 小时   | 低   |
|              | 任务 2（Error Boundary）    | 1 小时     | 低   |
|              | 任务 4（代码分割）          | 30 分钟    | 低   |
| **第三阶段** | 任务 8（哈希去重修复）      | 1 小时     | 中   |
|              | 任务 10（速率限制优化）     | 30 分钟    | 低   |
|              | 任务 7（Join 逻辑去重）     | 2-3 小时   | 中   |
| **第四阶段** | 任务 9（消息分页）          | 2-3 小时   | 中   |
|              | 任务 11（RoomContext）      | 3-4 小时   | 中   |
|              | 任务 13（PWA 缓存）         | 1 小时     | 低   |

每个阶段完成后执行完整验证:

```bash
bun run validate     # 格式、lint、类型检查、测试
bun run build        # 构建验证
```
