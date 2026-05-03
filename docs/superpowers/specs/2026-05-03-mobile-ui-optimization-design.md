# 移动端 UI 全面优化设计

## 背景

Cloud Clipboard 移动端存在 20 个 UI/UX 问题，涵盖键盘遮挡、触摸目标过小、布局浪费空间、功能缺失等方面。采用渐进式修复方案，在现有架构基础上逐个修复，保持组件结构不变。

## 修复范围

全部 20 个问题，按 4 个模块分组实施。

---

## 模块 1：键盘适配与视口处理

### 问题

| #   | 严重程度 | 问题                                       | 文件                                               |
| --- | -------- | ------------------------------------------ | -------------------------------------------------- |
| 1   | CRITICAL | 虚拟键盘弹出时输入框被遮挡                 | ClipboardRoom.tsx, RoomJoin.tsx, PasswordInput.tsx |
| 2   | CRITICAL | viewport meta 禁用用户缩放，违反无障碍标准 | index.html                                         |
| 3   | CRITICAL | PasswordInput 缺少 safe-area-inset         | PasswordInput.tsx                                  |

### 修复方案

#### 1.1 视口高度单位替换

- `ClipboardRoom.tsx`：主容器 `h-screen` → `h-dvh`
- `RoomJoin.tsx`：`min-h-screen` → `min-h-dvh`
- `PasswordInput.tsx`：`min-h-screen` → `min-h-dvh`

`dvh`（dynamic viewport height）会随键盘弹出/收起自动调整。浏览器支持：iOS 15+、Android 12+、Chrome 108+。不支持的旧浏览器回退到 `h-screen`，行为与现状一致。

#### 1.2 输入区域键盘适配

在 `ClipboardRoom.tsx` 中监听 `visualViewport` 的 `resize` 和 `scroll` 事件：

- 键盘弹出时：输入区域使用 `position: fixed`，`bottom` 设为 `visualViewport.offsetTop`，宽度跟随 `visualViewport.width`
- 键盘收起时：恢复为正常文档流布局
- 使用 `useEffect` 管理事件监听，组件卸载时清理

**降级策略**：

- 检测 `window.visualViewport` 是否存在，不存在时跳过 JS 适配，仅依赖 `dvh` 单位（覆盖大多数现代浏览器）
- `position: fixed` 切换时使用 `transition` 过渡，避免布局跳动
- 输入区域 `fixed` 状态时设置 `z-50`，确保在消息列表之上
- 组件卸载时在 cleanup 中强制移除 `fixed` 定位，防止残留状态
- 作为渐进增强，可补充 `env(keyboard-inset-height)` CSS 属性（当前仅 Chrome 125+ 支持）

#### 1.3 viewport meta 修复

`index.html` 中移除 `maximum-scale=1.0` 和 `user-scalable=no`：

```html
<!-- Before -->
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
/>
<!-- After -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

#### 1.4 PasswordInput 移动端优化

- 外层容器加 `safe-area-inset` 类
- 按钮加 `size="mobile"` + `className="mobile-touch"`
- 输入框通过 className 传入移动端样式（如 `className="h-12 min-h-[44px]"`），因为 Input 组件不支持 `size` 变体系统

---

## 模块 2：顶栏与侧边栏优化

### 问题

| #   | 严重程度 | 问题                                    | 文件                         |
| --- | -------- | --------------------------------------- | ---------------------------- |
| 4   | HIGH     | 顶栏按钮间距不足，易误触                | ClipboardRoom.tsx            |
| 5   | HIGH     | MobileNav 按钮与右侧按钮尺寸/图标不一致 | MobileNav.tsx                |
| 10  | MEDIUM   | 侧边栏 Drawer 宽度在小屏几乎占满        | sheet.tsx, ClipboardRoom.tsx |
| 11  | MEDIUM   | 移动端缺少置顶和设置功能入口            | SidebarContent.tsx           |
| 14  | LOW      | RoomJoin 顶部按钮可能被刘海遮挡         | RoomJoin.tsx                 |

### 修复方案

#### 2.1 统一顶栏按钮尺寸

- `MobileNav.tsx`：`h-12 w-12` → `h-10 w-10`，与右侧 `mobile-sm` 按钮高度一致（40px）
- 图标统一：MobileNav 的 Menu icon `h-6 w-6` → `h-5 w-5`（20px），与右侧图标比例协调

#### 2.2 增大按钮间距

- 右侧按钮组 `gap-2` → `gap-3`（12px），减少误触
- 移除分隔线 `w-px h-6`，用统一间距替代

#### 2.3 侧边栏宽度优化

- `sheet.tsx`：基础宽度从 `w-3/4 sm:max-w-sm` 改为 `w-[85%] max-w-xs`，所有 Sheet 使用方统一受益
- `ClipboardRoom.tsx`：调用处 `className="w-80 p-0"` 简化为 `className="p-0"`，宽度由 sheet.tsx 基础样式控制
- 小屏留出 15% 可见主内容区域，提示用户可以关闭侧边栏
- SheetContent 底部加 `pb-[env(safe-area-inset-bottom)]`，防止内容被 Home Indicator 遮挡

#### 2.4 补全移动端功能入口

- `SidebarContent.tsx`：移除 `{!isMobile && ...}` 条件，移动端侧边栏也显示置顶和设置按钮
- 顶栏保留锁、分享、退出三个高频操作，低频操作（置顶、设置）通过侧边栏访问

#### 2.5 RoomJoin 顶部按钮安全区域

- `top-4` → `top-[calc(1rem+env(safe-area-inset-top))]`，避免刘海遮挡

---

## 模块 3：消息列表与气泡优化

### 问题

| #   | 严重程度 | 问题                            | 文件                      |
| --- | -------- | ------------------------------- | ------------------------- |
| 6   | HIGH     | CardHeader p-6 在移动端浪费空间 | card.tsx, MessageCard.tsx |
| 7   | HIGH     | 消息操作按钮触摸目标仅 25px     | MessageCard.tsx           |
| 8   | MEDIUM   | 消息内容水平溢出风险            | MessageCard.tsx           |
| 12  | MEDIUM   | 虚拟化列表 estimateSize 偏差大  | MessageList.tsx           |
| 13  | MEDIUM   | 新消息自动滚底打断阅读          | MessageList.tsx           |
| 18  | LOW      | 暗色模式消息气泡对比度不足      | MessageCard.tsx           |

### 修复方案

#### 3.1 移动端 CardHeader padding 缩减

- `MessageCard.tsx`：CardHeader 使用 `className="p-3 pb-2 sm:p-6"`（保留现有 `pb-2`，移动端从 24px 减到 12px）
- CardContent 同步调整：`className="p-3 pt-0 sm:p-6 sm:pt-0"`
- 节省约 24px 水平空间，在 375px 屏幕上提升约 7% 的内容宽度

#### 3.2 消息操作按钮增大

- 按钮 padding：`p-1.5` → `p-2`
- 图标尺寸：`h-3.5 w-3.5` → `h-4 w-4`
- 触摸区域从约 25px 提升到约 32px
- 按钮间距：`gap-1` → `gap-2`（4px → 8px），减少误触
- 撤回确认按钮同步调整

#### 3.3 消息气泡区分自己/他人

- 自己的消息内容区：`bg-blue-50 dark:bg-blue-900/30`
- 他人的消息内容区：`bg-gray-50 dark:bg-gray-800`
- 暗色模式下自己的消息 `blue-900/30` 与他人的 `gray-800` 形成明确区分，同时与页面背景 `gray-900` 对比度也优于原来
- 实施时需在暗色模式下验证：自己消息 vs 他人消息的区分度、文字在 `blue-900/30` 上的可读性

#### 3.4 虚拟列表 estimateSize 优化

- 从固定 `80` 改为根据消息类型动态估算：
  - 文本消息：120px
  - 文件消息：140px
- 消息列表中只有 `text` 和 `file` 两种类型（系统消息以 toast 展示，不进入列表），无需额外分类
- 通过消息的 `type` 字段判断类型

#### 3.5 智能滚底逻辑

- 追踪用户是否在列表底部（距离底部 150px 以内视为"在底部"）
- 用户在底部时：新消息自动滚底（现有行为）
- 用户向上浏览时：新消息显示"新消息"提示条，点击才滚到底部
- 提示条定位策略：在 `parentRef`（滚动容器）同级使用 `position: absolute`，`bottom` 值定位在可见区域底部。不放在虚拟化列表内部容器中，避免与 `position: absolute` 的消息项冲突

#### 3.6 消息内容溢出防护

- 消息卡片加 `min-w-0`，防止 flex 子元素溢出
- 长文本/URL 的 `whitespace-pre-wrap` 已处理换行，`min-w-0` 确保在 flex 容器中正确收缩

---

## 模块 4：输入区域与杂项优化

### 问题

| #   | 严重程度 | 问题                                    | 文件                            |
| --- | -------- | --------------------------------------- | ------------------------------- |
| 9   | MEDIUM   | 输入区提示文字在键盘弹出时可能被裁切    | ClipboardRoom.tsx               |
| 15  | LOW      | Input 移动端高度与按钮不匹配            | input.tsx, ClipboardRoom.tsx    |
| 16  | LOW      | RoomJoin 卡片在极小屏内容区域过窄       | RoomJoin.tsx                    |
| 17  | LOW      | detectDeviceType 重复定义               | RoomJoin.tsx, PasswordInput.tsx |
| 19  | LOW      | safe-area-inset 笼统施加浪费空间        | index.css, ClipboardRoom.tsx    |
| 20  | LOW      | useMediaQuery 初始值 false 导致布局闪烁 | useMediaQuery.ts                |

### 修复方案

#### 4.1 输入区域高度统一

- 输入区域容器使用 `items-stretch`，让上传和发送按钮自动匹配输入框高度
- 不再依赖固定的 `h-12` / `h-10` 值，消除高度不匹配

#### 4.2 safe-area 精细化

- 移除 ClipboardRoom 外层笼统的 `safe-area-inset` 类
- 顶栏加 `pt-[env(safe-area-inset-top)]`
- 输入区域加 `pb-[env(safe-area-inset-bottom)]`
- 消息列表区域不加左右 safe-area padding，最大化内容宽度

#### 4.3 useMediaQuery 初始值修复

- `useState(false)` → `useState(() => window.matchMedia(query).matches)`
- 同步获取初始值，消除首次渲染布局闪烁
- 本项目为 Vite SPA 架构，不存在 SSR 场景，无需 `typeof window` 检查

#### 4.4 detectDeviceType 提取到公共工具

- 从 `RoomJoin.tsx` 和 `PasswordInput.tsx` 中提取到 `client/src/utils/device.ts`
- 两个组件改为 import 使用

#### 4.5 输入区提示文字优化

- `mt-2` → `mt-1`，减少垂直空间占用
- 加 `pb-[env(safe-area-inset-bottom)]` 防止被安全区域裁切

#### 4.6 RoomJoin 卡片极小屏适配

- `mx-4` → `mx-3`（16px → 12px 外边距）
- CardHeader/CardContent：`p-6` → `sm:p-6 p-4`
- 320px 屏幕上多出约 16px 内容宽度

---

## 影响范围

### 修改文件清单

| 文件                                       | 修改类型                                            |
| ------------------------------------------ | --------------------------------------------------- |
| `client/index.html`                        | viewport meta 修改                                  |
| `client/src/index.css`                     | safe-area-inset 工具类保留（不修改）                |
| `client/src/components/ClipboardRoom.tsx`  | 键盘适配、safe-area 精细化、输入区域布局            |
| `client/src/components/MessageCard.tsx`    | padding 缩减、按钮增大、气泡颜色、溢出防护          |
| `client/src/components/MessageList.tsx`    | estimateSize 优化、智能滚底逻辑                     |
| `client/src/components/RoomJoin.tsx`       | dvh、safe-area、padding 适配、提取 detectDeviceType |
| `client/src/components/PasswordInput.tsx`  | dvh、safe-area、mobile 标记、提取 detectDeviceType  |
| `client/src/components/SidebarContent.tsx` | 移动端显示全部按钮                                  |
| `client/src/components/MobileNav.tsx`      | 按钮尺寸统一                                        |
| `client/src/components/ui/sheet.tsx`       | 基础宽度调整、底部 safe-area                        |
| `client/src/hooks/useMediaQuery.ts`        | 初始值修复                                          |
| `client/src/utils/device.ts`               | 新建，提取 detectDeviceType                         |

### 不修改的文件

- `client/src/components/ui/card.tsx`：CardHeader 的 `p-6` 在 MessageCard 中通过 className 覆盖，不修改全局 card 组件
- `client/src/components/ui/input.tsx`：保持现有 `lg:h-10 h-12`，通过 `items-stretch` 解决高度匹配问题
- `client/src/components/ui/button.tsx`：保持现有 mobile/mobile-sm 变体不变

### 测试策略

- 每个模块修改后运行 `bun run validate:quick` 确保无编译错误
- 使用 Chrome DevTools 设备模拟器测试 375px (iPhone SE)、390px (iPhone 14)、320px (极小屏)
- 实机测试 iOS Safari 和 Android Chrome 的键盘弹出/收起行为
- 验证暗色模式下消息气泡对比度
