# 长消息折叠功能设计

## 目标

当文本消息超过 6 行时，默认折叠显示，用户点击可展开查看全文。移动端友好。

## 方案

使用 CSS `line-clamp` + 渐变遮罩 + `max-height` 过渡动画。

### 折叠判断

- 文本消息使用 CSS `display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden` 截断
- 底部叠加渐变遮罩（从不透明到透明），暗示有更多内容
- 遮罩层上居中放置 "展开" 按钮

### 展开/收起

- 点击 "展开"：移除 `line-clamp`，`max-height` 从 6 行高度过渡到实际高度（`scrollHeight`）
- 点击 "收起"：反向动画，恢复 `line-clamp`
- 动画：`transition: max-height 0.3s ease`
- 展开后虚拟列表的 `measureElement` 自动重新测量行高

### 交互细节

- "展开/收起" 文案使用 i18n（中英文）
- 按钮样式与现有消息气泡风格一致
- 移动端按钮足够大，方便触摸
- 仅对文本消息生效，文件消息不折叠
- 自己和别人的消息都支持折叠

### 虚拟列表适配

- `estimateSize` 保持不变（预估值，`measureElement` 会纠正）
- 展开后 `measureElement` 自动重新测量
- `overscan: 5` 已有缓冲，避免展开时闪烁

### 实现位置

- `client/src/components/MessageCard.tsx` — 折叠逻辑（`isCollapsed` 状态、CSS class 切换）
- `client/src/index.css` — 新增折叠相关样式类
- `client/src/i18n/locales/zh.json` / `en.json` — 新增 "展开/收起" 翻译

### 不涉及

- 文件消息折叠
- 消息编辑/搜索中的折叠
- 服务端变更
