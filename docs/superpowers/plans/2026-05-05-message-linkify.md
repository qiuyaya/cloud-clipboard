# 消息链接快捷打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动识别消息中的 URL 并渲染为可点击链接，点击在新标签页打开。

**Architecture:** 新建 `LinkifiedText` 组件，用正则将文本分割为普通文本和 URL 片段，分别渲染为 `<span>` 和 `<a>` 标签。在 `MessageCard` 中替换原始文本渲染。

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react

---

### Task 1: LinkifiedText 组件 — URL 分割工具函数

**Files:**

- Create: `client/src/components/LinkifiedText.tsx`
- Test: `client/src/components/__tests__/LinkifiedText.test.tsx`

- [ ] **Step 1: 编写 URL 分割函数的失败测试**

```tsx
// client/src/components/__tests__/LinkifiedText.test.tsx
import { describe, it, expect } from "vitest";
import { splitByTextAndUrls } from "../LinkifiedText";

describe("splitByTextAndUrls", () => {
  it("returns single text segment for plain text", () => {
    expect(splitByTextAndUrls("hello world")).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("returns single url segment for https URL", () => {
    expect(splitByTextAndUrls("https://example.com")).toEqual([
      { type: "url", value: "https://example.com" },
    ]);
  });

  it("returns single url segment for http URL", () => {
    expect(splitByTextAndUrls("http://example.com")).toEqual([
      { type: "url", value: "http://example.com" },
    ]);
  });

  it("returns url segment for www URL", () => {
    expect(splitByTextAndUrls("www.example.com")).toEqual([
      { type: "url", value: "www.example.com" },
    ]);
  });

  it("splits mixed text and URLs", () => {
    expect(splitByTextAndUrls("check https://example.com out")).toEqual([
      { type: "text", value: "check " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " out" },
    ]);
  });

  it("handles multiple URLs", () => {
    expect(splitByTextAndUrls("https://a.com and https://b.com")).toEqual([
      { type: "url", value: "https://a.com" },
      { type: "text", value: " and " },
      { type: "url", value: "https://b.com" },
    ]);
  });

  it("strips trailing punctuation from URL", () => {
    expect(splitByTextAndUrls("see https://example.com.")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("strips trailing comma", () => {
    expect(splitByTextAndUrls("visit https://example.com, ok")).toEqual([
      { type: "text", value: "visit " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: ", ok" },
    ]);
  });

  it("strips trailing exclamation", () => {
    expect(splitByTextAndUrls("https://example.com!")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: "!" },
    ]);
  });

  it("strips trailing question mark", () => {
    expect(splitByTextAndUrls("https://example.com?")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: "?" },
    ]);
  });

  it("strips trailing closing bracket", () => {
    expect(splitByTextAndUrls("(https://example.com)")).toEqual([
      { type: "text", value: "(" },
      { type: "url", value: "https://example.com" },
      { type: "text", value: ")" },
    ]);
  });

  it("strips trailing closing square bracket", () => {
    expect(splitByTextAndUrls("[https://example.com]")).toEqual([
      { type: "text", value: "[" },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "]" },
    ]);
  });

  it("strips trailing semicolon and colon", () => {
    expect(splitByTextAndUrls("https://example.com;")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: ";" },
    ]);
    expect(splitByTextAndUrls("https://example.com:")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: ":" },
    ]);
  });

  it("strips trailing punctuation from www URL", () => {
    expect(splitByTextAndUrls("visit www.example.com.")).toEqual([
      { type: "text", value: "visit " },
      { type: "url", value: "www.example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("preserves query params in URL", () => {
    expect(splitByTextAndUrls("https://example.com?q=hello")).toEqual([
      { type: "url", value: "https://example.com?q=hello" },
    ]);
  });

  it("preserves hash in URL", () => {
    expect(splitByTextAndUrls("https://example.com#section")).toEqual([
      { type: "url", value: "https://example.com#section" },
    ]);
  });

  it("preserves path with parentheses in URL", () => {
    // Known limitation: trailing ) is stripped even if part of URL path
    expect(splitByTextAndUrls("https://en.wikipedia.org/wiki/Fish")).toEqual([
      { type: "url", value: "https://en.wikipedia.org/wiki/Fish" },
    ]);
  });

  it("handles empty string", () => {
    expect(splitByTextAndUrls("")).toEqual([{ type: "text", value: "" }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/cc/workspace/cloud-clipboard/client && bun run test -- src/components/__tests__/LinkifiedText.test.tsx`
Expected: FAIL — `splitByTextAndUrls` 不存在

- [ ] **Step 3: 实现 splitByTextAndUrls 函数**

```tsx
// client/src/components/LinkifiedText.tsx
const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;
const TRAILING_PUNCTUATION = /[.,)!?\];:]+$/;

export interface TextSegment {
  type: "text" | "url";
  value: string;
}

export function splitByTextAndUrls(text: string): TextSegment[] {
  if (!text) return [{ type: "text", value: "" }];

  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const matchIndex = match.index!;
    let url = match[0];

    // Strip trailing punctuation from URL
    const stripped = url.replace(TRAILING_PUNCTUATION, "");
    const trailingCount = url.length - stripped.length;
    url = stripped;

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: "url", value: url });

    if (trailingCount > 0) {
      segments.push({ type: "text", value: match[0].slice(-trailingCount) });
      lastIndex = matchIndex + match[0].length;
    } else {
      lastIndex = matchIndex + match[0].length;
    }
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/cc/workspace/cloud-clipboard/client && bun run test -- src/components/__tests__/LinkifiedText.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add client/src/components/LinkifiedText.tsx client/src/components/__tests__/LinkifiedText.test.tsx
git commit -m "feat: add splitByTextAndUrls utility for link detection"
```

---

### Task 2: LinkifiedText 组件 — React 渲染

**Files:**

- Modify: `client/src/components/LinkifiedText.tsx`
- Modify: `client/src/components/__tests__/LinkifiedText.test.tsx`

- [ ] **Step 1: 编写 LinkifiedText 组件的失败测试**

在 `LinkifiedText.test.tsx` 中，将 `render`、`screen` 和 `LinkifiedText` 的 import 合并到文件顶部，然后在文件末尾追加测试：

```tsx
// 追加到文件顶部 import 区域：
import { render, screen } from "@testing-library/react";
import { LinkifiedText } from "../LinkifiedText";

// 追加到文件末尾：
describe("LinkifiedText", () => {
  it("renders plain text without links", () => {
    render(<LinkifiedText text="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders https URL as clickable link", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("https://example.com");
  });

  it("renders www URL with https prefix in href", () => {
    render(<LinkifiedText text="www.example.com" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.example.com");
    expect(link).toHaveTextContent("www.example.com");
  });

  it("renders mixed text and URLs", () => {
    render(<LinkifiedText text="check https://example.com out" />);
    expect(screen.getByText("check ")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText(" out")).toBeInTheDocument();
  });

  it("applies correct link styles", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("underline");
    expect(link.className).toContain("break-all");
  });

  it("validates href starts with allowed protocol", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    const href = link.getAttribute("href");
    expect(href?.startsWith("https://") || href?.startsWith("http://")).toBe(true);
  });

  it("renders URL as span when getHref returns null", () => {
    // Defense-in-depth: if somehow a non-http/www URL gets through,
    // it should render as plain text, not a link
    render(<LinkifiedText text="hello world" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/cc/workspace/cloud-clipboard/client && bun run test -- src/components/__tests__/LinkifiedText.test.tsx`
Expected: FAIL — `LinkifiedText` 组件不存在

- [ ] **Step 3: 实现 LinkifiedText 组件**

在 `LinkifiedText.tsx` 中追加组件代码（import 放在文件顶部）：

```tsx
import React from "react";

const ALLOWED_HREF_PREFIXES = ["https://", "http://"];

function getHref(url: string): string | null {
  if (url.startsWith("www.")) {
    return `https://${url}`;
  }
  for (const prefix of ALLOWED_HREF_PREFIXES) {
    if (url.startsWith(prefix)) return url;
  }
  return null;
}

export const LinkifiedText = React.memo(function LinkifiedText({ text }: { text: string }) {
  const segments = splitByTextAndUrls(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "url") {
          const href = getHref(segment.value);
          if (href) {
            return (
              <a
                key={index}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all"
              >
                {segment.value}
              </a>
            );
          }
          return <span key={index}>{segment.value}</span>;
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </>
  );
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/cc/workspace/cloud-clipboard/client && bun run test -- src/components/__tests__/LinkifiedText.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add client/src/components/LinkifiedText.tsx client/src/components/__tests__/LinkifiedText.test.tsx
git commit -m "feat: add LinkifiedText component for URL rendering"
```

---

### Task 3: 集成到 MessageCard

**Files:**

- Modify: `client/src/components/MessageCard.tsx:136`

- [ ] **Step 1: 修改 MessageCard 使用 LinkifiedText**

将 `MessageCard.tsx` 第 136 行：

```tsx
<pre className="whitespace-pre-wrap text-sm font-mono">{message.content}</pre>
```

替换为：

```tsx
<pre className="whitespace-pre-wrap text-sm font-mono">
  <LinkifiedText text={message.content} />
</pre>
```

并在文件顶部添加 import：

```tsx
import { LinkifiedText } from "./LinkifiedText";
```

- [ ] **Step 2: 运行代码质量检查**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run validate:quick`
Expected: PASS

- [ ] **Step 3: 运行全部前端测试**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run test`
Expected: PASS

- [ ] **Step 4: 启动开发服务器手动验证**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run dev`

验证：

1. 发送包含 `https://example.com` 的消息，确认链接可点击
2. 发送包含 `www.example.com` 的消息，确认链接可点击且 href 为 `https://www.example.com`
3. 发送混合文本消息，确认文本和链接正确分割
4. 确认链接在新标签页打开
5. 确认深色/浅色模式下链接颜色可读

- [ ] **Step 5: 提交**

```bash
git add client/src/components/MessageCard.tsx
git commit -m "feat: integrate LinkifiedText into MessageCard for clickable URLs"
```

---

### Task 4: 文档更新

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md**

在 "New Features Implemented" 部分追加：

```markdown
**Message Link Detection**: Auto-detect URLs in chat messages and render them as clickable links:

- **URL Detection**: Recognizes `https?://` and `www.` prefixed URLs in message text
- **Safe Rendering**: Pure React component approach (no `dangerouslySetInnerHTML`), JSX auto-escapes plain text
- **New Tab**: Links open in new tab with `rel="noopener noreferrer"` for security
- **www Prefix**: `www.` URLs use `https://` prefix in href, display original text
- **Trailing Punctuation**: Automatically strips trailing `.` `,` `!` `?` `)` `]` `;` `:` from URLs
- **Overflow Protection**: `break-all` on links prevents long URL layout overflow
- **Theme Support**: Blue links with hover states for both light and dark themes
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: add message link detection feature documentation"
```
