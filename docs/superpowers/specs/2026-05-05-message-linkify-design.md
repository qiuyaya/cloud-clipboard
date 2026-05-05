# 消息链接快捷打开功能设计

## 目标

当消息内容包含 URL 时，自动识别并渲染为可点击链接，点击后在新标签页打开。

## 方案

纯 React 组件渲染，零新增依赖。将文本按 URL 分割为片段数组，普通文本渲染为 `<span>`，URL 渲染为 `<a>` 标签。

## 识别范围

- `https?://` 开头的 HTTP(S) 链接
- `www.` 开头的链接
- 不支持 Unicode/IDN 域名（如 `https://例子.中国/`），作为已知限制

## 组件设计

### LinkifiedText

新建 `client/src/components/LinkifiedText.tsx`。

**Props**: `text: string`

**URL 检测正则**:

```
/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g
```

匹配 `https?://` 或 `www.` 开头，到空白符为止。URL 末尾的 `.` `,` `!` `?` `)` `]` `;` `:` 等标点不纳入链接（通过渲染时剥离尾随标点实现）。

**括号处理**: 不做平衡括号匹配。`https://en.wikipedia.org/wiki/Fish_(disambiguation)` 中的 `)` 会被截断，这是已知限制，与大多数聊天应用行为一致。

**渲染逻辑**:

1. 用正则将文本分割为 `[{type: "text"|"url", value: string}]` 片段数组
2. text 片段渲染为 `<span key={index}>`，url 片段渲染为 `<a key={index} target="_blank" rel="noopener noreferrer">`
3. www 开头的链接：显示原始文本，href 使用 `https://` 前缀（比协议相对 URL 更安全，避免 HTTP 环境下降级）
4. HTTP(S) 链接：href 使用原始 URL
5. 渲染前校验 href 值必须以 `http://` 或 `https://` 开头（纵深防御）

**样式**: `text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all`

- `break-all` 防止超长 URL 溢出布局
- 自身消息气泡（`bg-blue-50 dark:bg-blue-900/30`）上蓝色链接对比度可接受：浅色模式 `blue-600` 在 `blue-50` 上对比度足够，深色模式 `blue-400` 在 `blue-900/30`（30% 透明度）上也有足够区分度

**性能**: 组件用 `React.memo` 包裹，避免消息未变时重复正则分割。

### MessageCard 修改

将 `<pre>{message.content}</pre>` 改为 `<pre><LinkifiedText text={message.content} /></pre>`，其余不变。

## 测试

测试文件：`client/src/components/__tests__/LinkifiedText.test.tsx`

覆盖场景：

- 纯文本（无链接）原样渲染
- 单个 HTTP(S) 链接渲染为 `<a>`
- www 链接渲染为 `<a>` 且 href 使用 `https://` 前缀
- 混合文本+链接正确分割
- 多链接场景
- 链接后紧跟标点（`.` `,` `!` `?` `)` `]` `;` `:`）不纳入链接
- 超长 URL 不溢出布局

## 安全

- 不使用 `dangerouslySetInnerHTML`，JSX 表达式自动转义普通文本
- `<a>` 标签添加 `rel="noopener noreferrer"` 防止 `window.opener` 攻击
- `target="_blank"` 仅用于用户主动点击的链接
- 渲染前校验 href 值必须以 `http://`、`https://` 开头（纵深防御）
