# 移动端 UI 全面优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复移动端 20 个 UI/UX 问题，涵盖键盘适配、触摸优化、布局精简、功能补全等。

**Architecture:** 在现有组件架构基础上渐进式修复，不改变组件结构，只调整样式、交互逻辑和部分 hooks。新增 `device.ts` 工具文件和 `useKeyboard` hook。

**Tech Stack:** React + Tailwind CSS + @tanstack/react-virtual + vaul (Drawer)

---

## File Structure

| File                                       | Responsibility                                          |
| ------------------------------------------ | ------------------------------------------------------- |
| `client/index.html`                        | viewport meta 修复                                      |
| `client/src/hooks/useMediaQuery.ts`        | 初始值同步获取，消除闪烁                                |
| `client/src/hooks/useKeyboard.ts`          | 新建，visualViewport 键盘适配 hook                      |
| `client/src/utils/device.ts`               | 新建，提取 detectDeviceType 公共函数                    |
| `client/src/components/ClipboardRoom.tsx`  | dvh、键盘适配、safe-area 精细化、输入区域布局、按钮间距 |
| `client/src/components/MessageCard.tsx`    | padding 缩减、按钮增大、气泡颜色、溢出防护              |
| `client/src/components/MessageList.tsx`    | estimateSize 优化、智能滚底逻辑                         |
| `client/src/components/RoomJoin.tsx`       | dvh、safe-area、padding 适配、提取 detectDeviceType     |
| `client/src/components/PasswordInput.tsx`  | dvh、safe-area、mobile 标记、提取 detectDeviceType      |
| `client/src/components/SidebarContent.tsx` | 移动端显示全部按钮                                      |
| `client/src/components/MobileNav.tsx`      | 按钮尺寸统一                                            |
| `client/src/components/ui/sheet.tsx`       | 基础宽度调整、底部 safe-area                            |

---

### Task 1: viewport meta 与 useMediaQuery 修复

**Files:**

- Modify: `client/index.html:12-14`
- Modify: `client/src/hooks/useMediaQuery.ts:4`

- [ ] **Step 1: 修复 viewport meta**

移除 `maximum-scale=1.0` 和 `user-scalable=no`，并添加 `viewport-fit=cover`（使 `env(safe-area-inset-*)` 在 iOS 上生效）：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 2: 修复 useMediaQuery 初始值**

```ts
import { useState, useEffect } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
```

- [ ] **Step 3: 运行验证**

Run: `bun run validate:quick`
Expected: PASS, 无编译错误

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/src/hooks/useMediaQuery.ts
git commit -m "fix: 修复 viewport 缩放限制和 useMediaQuery 初始值闪烁"
```

---

### Task 2: detectDeviceType 提取与 dvh 替换

**Files:**

- Create: `client/src/utils/device.ts`
- Modify: `client/src/components/RoomJoin.tsx:251-267,321`
- Modify: `client/src/components/PasswordInput.tsx:30-46,75`

- [ ] **Step 1: 创建 device.ts 工具文件**

```ts
export function detectDeviceType(): "mobile" | "desktop" | "tablet" | "unknown" {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/mobile|android|iphone|phone/.test(userAgent)) {
    return "mobile";
  }

  if (/tablet|ipad/.test(userAgent)) {
    return "tablet";
  }

  if (/desktop|windows|mac|linux/.test(userAgent)) {
    return "desktop";
  }

  return "unknown";
}
```

- [ ] **Step 2: 修改 RoomJoin.tsx**

1. 添加 import：`import { detectDeviceType } from "@/utils/device";`
2. 删除内部的 `detectDeviceType` 函数定义（约第 251-267 行的 `const detectDeviceType = ...`）
3. 外层容器 `min-h-screen` → `min-h-dvh`
4. 顶部按钮 `top-4` → `top-[calc(1rem+env(safe-area-inset-top))]`
5. Card `mx-4` → `mx-3`
6. CardHeader: 添加移动端 padding `className="text-center sm:p-6 p-4"`
7. CardContent: 添加移动端 padding `className="sm:p-6 p-4"`

- [ ] **Step 3: 修改 PasswordInput.tsx**

1. 添加 import：`import { detectDeviceType } from "@/utils/device";`
2. 删除内部的 `detectDeviceType` 函数定义（第 30-46 行）
3. `min-h-screen` → `min-h-dvh`（第 75 行）
4. 外层 div 加 `safe-area-inset` 类（第 75 行）
5. Input 加 `className="w-full h-12 min-h-[44px]"`（第 96 行，合并现有 className）
6. 取消按钮加 `size="mobile"` + `className="mobile-touch flex-1"`（第 102-108 行）
7. 提交按钮加 `size="mobile"` + `className="mobile-touch flex-1"`（第 111 行）

- [ ] **Step 4: 运行验证**

Run: `bun run validate:quick`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/device.ts client/src/components/RoomJoin.tsx client/src/components/PasswordInput.tsx
git commit -m "refactor: 提取 detectDeviceType 到公共工具，修复 dvh 和 safe-area"
```

---

### Task 3: useKeyboard hook 与 ClipboardRoom 键盘适配

**Files:**

- Create: `client/src/hooks/useKeyboard.ts`
- Modify: `client/src/components/ClipboardRoom.tsx:1,130,233-265`

- [ ] **Step 1: 创建 useKeyboard hook**

```ts
import { useState, useEffect } from "react";

interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  viewportOffsetTop: number;
  viewportWidth: number;
}

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    viewportOffsetTop: 0,
    viewportWidth: window.innerWidth,
  });

  useEffect(() => {
    if (!window.visualViewport) return;

    const updateState = () => {
      const vv = window.visualViewport!;
      const isKeyboardOpen = vv.height < window.innerHeight - 50;
      setState({
        isKeyboardOpen,
        keyboardHeight: isKeyboardOpen ? window.innerHeight - vv.height : 0,
        viewportOffsetTop: vv.offsetTop,
        viewportWidth: vv.width,
      });
    };

    updateState();
    window.visualViewport.addEventListener("resize", updateState);
    window.visualViewport.addEventListener("scroll", updateState);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateState);
      window.visualViewport?.removeEventListener("scroll", updateState);
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: 修改 ClipboardRoom.tsx**

1. 添加 import：`import { useKeyboard } from "@/hooks/useKeyboard";`
2. 在组件内调用：`const keyboard = useKeyboard();`
3. 主容器：`h-screen safe-area-inset` → `h-dvh`（移除笼统 safe-area-inset）
4. 顶栏 div 加 `pt-[env(safe-area-inset-top)]`（第 155 行）
5. 输入区域改为键盘适配版本：

```tsx
{
  /* 输入区域 */
}
<div
  className={`border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 pb-[env(safe-area-inset-bottom)] ${
    keyboard.isKeyboardOpen ? "fixed z-50 left-0" : ""
  }`}
  style={
    keyboard.isKeyboardOpen
      ? {
          bottom: keyboard.viewportOffsetTop,
          width: keyboard.viewportWidth,
        }
      : undefined
  }
>
  <form onSubmit={handleSendText} className="flex items-stretch gap-2">
    <Input
      value={textInput}
      onChange={(e) => setTextInput(e.target.value)}
      placeholder={t("input.placeholder")}
      className="flex-1"
      maxLength={50000}
    />
    <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
    <Button
      type="button"
      variant="outline"
      onClick={() => fileInputRef.current?.click()}
      className="flex items-center gap-2 mobile-touch"
      aria-label={t("input.uploadFile")}
    >
      <Upload className="h-4 w-4" aria-hidden="true" />
      <span className="lg:inline hidden">{t("input.fileButton")}</span>
    </Button>
    <Button
      type="submit"
      disabled={!textInput.trim()}
      className="mobile-touch"
      aria-label={t("input.sendButton")}
    >
      <Send className="h-4 w-4" aria-hidden="true" />
    </Button>
  </form>
  <p className="text-xs text-muted-foreground mt-1">{t("room.maxLimits")}</p>
</div>;
```

6. 移除按钮的 `size="mobile-sm"`，改用 `items-stretch` 自动匹配高度
7. 提示文字 `mt-2` → `mt-1`

- [ ] **Step 3: 运行验证**

Run: `bun run validate:quick`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useKeyboard.ts client/src/components/ClipboardRoom.tsx
git commit -m "feat: 添加 useKeyboard hook，修复移动端键盘遮挡输入框"
```

---

### Task 4: 顶栏与侧边栏优化

**Files:**

- Modify: `client/src/components/MobileNav.tsx:18,21`
- Modify: `client/src/components/ui/sheet.tsx:33`
- Modify: `client/src/components/ClipboardRoom.tsx:141,157,199`
- Modify: `client/src/components/SidebarContent.tsx:96-198`

- [ ] **Step 1: 统一 MobileNav 按钮尺寸**

MobileNav.tsx 改为：

```tsx
<Button
  variant="outline"
  size="icon"
  onClick={onOpenSidebar}
  className="lg:hidden h-10 w-10"
  aria-label={t("room.openSidebar")}
>
  <Menu className="h-5 w-5" aria-hidden="true" />
</Button>
```

- [ ] **Step 2: 修改 sheet.tsx 基础宽度**

第 33 行改为：

```tsx
"inset-y-0 left-0 h-full w-[85%] max-w-xs border-r pb-[env(safe-area-inset-bottom)]",
```

- [ ] **Step 3: 修改 ClipboardRoom 侧边栏调用**

第 141 行 `className="w-80 p-0"` → `className="p-0"`

- [ ] **Step 4: 增大顶栏按钮间距**

ClipboardRoom.tsx 第 157 行 `gap-2` → `gap-3`
第 199 行移除分隔线 `<div className="w-px h-6 bg-border mx-1" aria-hidden="true" />`

- [ ] **Step 5: SidebarContent 移动端显示全部按钮**

将 SidebarContent.tsx 中 `{!isMobile && (` 条件包裹的按钮改为直接渲染。具体修改：

- 找到所有 `{!isMobile && (` 模式，移除条件判断和对应的 `)}` 闭合
- 保留按钮本身不变，只是让移动端侧边栏也能看到这些按钮
- 注意：如果移除 `isMobile` 条件后该变量不再被使用，同时移除 `const isMobile = useMediaQuery(...)` 声明

- [ ] **Step 6: 运行验证**

Run: `bun run validate:quick`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/components/MobileNav.tsx client/src/components/ui/sheet.tsx client/src/components/ClipboardRoom.tsx client/src/components/SidebarContent.tsx
git commit -m "fix: 统一顶栏按钮尺寸，优化侧边栏宽度，补全移动端功能入口"
```

---

### Task 5: 消息列表与气泡优化

**Files:**

- Modify: `client/src/components/MessageCard.tsx:36-37,57-77,79-120,131,135`
- Modify: `client/src/components/MessageList.tsx:35-49,51-99`

- [ ] **Step 1: 修改 MessageCard padding**

第 37 行 CardHeader：

```tsx
<CardHeader className="p-3 pb-2 sm:p-6">
```

第 129 行 CardContent：

```tsx
<CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
```

- [ ] **Step 2: 增大消息操作按钮**

所有操作按钮的 `p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`，`gap-1` → `gap-2`。

涉及行：

- 第 57 行撤回确认区：`gap-1` → `gap-2`
- 第 63 行 Check 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`
- 第 71 行 X 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`
- 第 79 行操作按钮区：`gap-1` → `gap-2`
- 第 83 行 Copy 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`
- 第 94 行 Download 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`
- 第 101 行 Share2 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`
- 第 113 行 Undo2 按钮：`p-1.5` → `p-2`，`h-3.5 w-3.5` → `h-4 w-4`

- [ ] **Step 3: 消息气泡区分自己/他人**

第 36 行 Card 加 `min-w-0`：

```tsx
<Card className={`group max-w-full min-w-0 lg:max-w-2xl ${isOwnMessage ? "ml-auto" : "mr-auto"}`}>
```

第 131 行文本消息内容区，根据 isOwnMessage 区分颜色：

```tsx
<div className={`${isOwnMessage ? "bg-blue-50 dark:bg-blue-900/30" : "bg-gray-50 dark:bg-gray-800"} p-3 rounded-lg`}>
```

第 135 行文件消息内容区同理：

```tsx
<div className={`flex items-center gap-3 p-3 ${isOwnMessage ? "bg-blue-50 dark:bg-blue-900/30" : "bg-gray-50 dark:bg-gray-800"} rounded-lg`}>
```

- [ ] **Step 4: 修改 MessageList estimateSize**

第 38 行改为动态估算：

```ts
estimateSize: (index) => {
  const message = messages[index];
  return message?.type === "file" ? 140 : 120;
},
```

注意：`messages` 需要在 `useVirtualizer` 的依赖中可用。检查 `useVirtualizer` 是否需要 `messages` 作为依赖。如果 `estimateSize` 是回调函数，它会在每次渲染时重新创建，因此 `messages[index]` 可以访问当前消息数据。

- [ ] **Step 5: 添加智能滚底逻辑**

修改 MessageList.tsx，添加"新消息"提示条：

1. import 语句补充 `useState`：`import React, { useRef, useEffect, useCallback, useState } from "react";`
2. 添加 ref 跟踪是否在底部（避免 effect 依赖循环）：`const isAtBottomRef = useRef(true);`
3. 添加 state：`const [hasNewMessages, setHasNewMessages] = useState(false);`
4. 添加 scroll 监听：

```ts
const handleScroll = useCallback(() => {
  if (!parentRef.current) return;
  const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
  const atBottom = scrollHeight - scrollTop - clientHeight < 150;
  isAtBottomRef.current = atBottom;
  if (atBottom) setHasNewMessages(false);
}, []);
```

3. 修改滚底 useEffect（使用 ref 而非 state 避免依赖循环）：

```ts
useEffect(() => {
  if (messages.length > 0 && isAtBottomRef.current) {
    virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
  } else if (messages.length > 0) {
    setHasNewMessages(true);
  }
}, [messages.length, virtualizer]);
```

4. 在 parentRef div 上添加 onScroll：

```tsx
<div ref={parentRef} className="flex-1 overflow-y-auto p-4 mobile-scroll" onScroll={handleScroll}>
```

5. 在列表容器外层（parentRef 同级）添加提示条：

```tsx
<div className="relative flex-1">
  <div ref={parentRef} className="flex-1 overflow-y-auto p-4 mobile-scroll" onScroll={handleScroll}>
    {/* ... 消息列表内容 ... */}
  </div>
  {hasNewMessages && (
    <button
      onClick={() => {
        virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
        setHasNewMessages(false);
        isAtBottomRef.current = true;
      }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in fade-in-0 zoom-in-95 duration-200 z-40"
    >
      {t("room.newMessages")}
    </button>
  )}
</div>
```

6. 需要在 i18n 中添加 `room.newMessages` 翻译键（中文："新消息"，英文："New messages"）

- [ ] **Step 6: 添加 i18n 翻译键**

在 `client/src/i18n/locales/zh.json` 和 `client/src/i18n/locales/en.json` 中添加：

```json
// zh.json - room 部分
"newMessages": "新消息"

// en.json - room 部分
"newMessages": "New messages"
```

- [ ] **Step 7: 运行验证**

Run: `bun run validate:quick`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/components/MessageCard.tsx client/src/components/MessageList.tsx client/src/i18n/locales/zh.json client/src/i18n/locales/en.json
git commit -m "feat: 优化消息气泡样式，增大操作按钮，添加智能滚底和新消息提示"
```

---

### Task 6: 最终验证与文档更新

**Files:**

- Modify: `CLAUDE.md` (如有必要)
- Verify: 所有修改文件

- [ ] **Step 1: 运行完整验证**

Run: `bun run validate:quick`
Expected: PASS

- [ ] **Step 2: 运行前端测试**

Run: `bun run test`
Expected: PASS

- [ ] **Step 3: 检查 CLAUDE.md 是否需要更新**

检查新增的 hooks（useKeyboard）和 utils（device.ts）是否需要在 CLAUDE.md 中记录。如果需要，添加相关说明。

- [ ] **Step 4: Commit（如有文档更新）**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md 移动端优化相关说明"
```

---

## 关键决策记录

| 决策                                      | 原因                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 使用 `dvh` 而非纯 JS 方案                 | dvh 是 CSS 原生方案，性能更好；JS 方案作为补充（visualViewport）处理键盘弹出时的输入框定位              |
| viewport-fit=cover                        | iOS 需要 viewport-fit=cover 才能使 env(safe-area-inset-\*) 生效                                         |
| Input 不加 size 变体                      | 保持 input.tsx 不修改的策略，通过 className 和 items-stretch 解决高度匹配                               |
| sheet.tsx 基础宽度修改                    | 统一所有 Sheet 使用方受益，避免 tailwind-merge 覆盖优先级问题                                           |
| 消息气泡用蓝色区分自己                    | 蓝色是聊天应用中"自己消息"的常见约定（iMessage、WhatsApp），暗色模式下 blue-900/30 对比度足够           |
| 滚底逻辑用 ref 而非 state 追踪 isAtBottom | 避免 useEffect 依赖 isAtBottom state 导致循环触发；hasNewMessages 用 state 因为需要触发重渲染显示提示条 |
| 滚底提示条用 absolute 定位                | 虚拟化列表内部使用 absolute 定位的消息项，sticky 在此场景中不可靠                                       |
