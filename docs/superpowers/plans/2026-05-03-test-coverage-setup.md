# 测试覆盖率工具配置 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为前端（Vitest）和后端（Rust）配置测试覆盖率工具，支持终端报告、HTML 报告和 CI 集成。

**Architecture:** 前端使用 @vitest/coverage-v8（Vitest 原生推荐），后端使用 cargo-tarpaulin（兼容 Alpine Docker，需 `--security-opt seccomp=unconfined`）。覆盖率输出统一到 `coverage/` 目录。

**Tech Stack:** @vitest/coverage-v8, cargo-tarpaulin, Bun, Docker

---

## 文件变更清单

| 文件                      | 操作 | 说明                                               |
| ------------------------- | ---- | -------------------------------------------------- |
| `client/package.json`     | 修改 | 添加 @vitest/coverage-v8 依赖和 coverage 脚本      |
| `client/vitest.config.ts` | 修改 | 添加 coverage 配置                                 |
| `server-rust/Cargo.toml`  | 修改 | 无需修改（tarpaulin 是 CLI 工具，不进 Cargo.toml） |
| `package.json`（根）      | 修改 | 添加 coverage 相关脚本                             |
| `.gitignore`              | 修改 | 添加覆盖率输出目录                                 |
| `CLAUDE.md`               | 修改 | 添加覆盖率命令文档                                 |

---

### Task 1: 前端覆盖率配置（Vitest + coverage-v8）

**Files:**

- Modify: `client/package.json`
- Modify: `client/vitest.config.ts`

- [ ] **Step 1: 安装 @vitest/coverage-v8**

```bash
cd client && bun add -d @vitest/coverage-v8
```

- [ ] **Step 2: 修改 client/vitest.config.ts 添加 coverage 配置**

在 `defineConfig` 中添加 `test.coverage` 配置：

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/__tests__/**",
        "src/test/**",
        "src/vite-env.d.ts",
        "src/main.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: 添加 client/package.json coverage 脚本**

在 `scripts` 中添加：

```json
"test:coverage": "vitest run --coverage",
"test:coverage:ui": "vitest run --coverage && open coverage/index.html"
```

- [ ] **Step 4: 验证前端覆盖率**

```bash
cd client && bun run test:coverage
```

预期：终端输出覆盖率表格，`client/coverage/` 目录生成 HTML 和 lcov 报告。

---

### Task 2: 后端覆盖率配置（cargo-tarpaulin）

**Files:**

- Modify: `package.json`（根）

- [ ] **Step 1: 构建 tarpaulin Docker 镜像**

创建包含 cargo-tarpaulin 的基础镜像（基于 Debian，因为 tarpaulin 依赖 ptrace，Alpine 兼容性差）：

```bash
docker build -t cloud-clipboard-rust-coverage -f- server-rust/ <<'EOF'
FROM rust:1.93-bookworm
RUN cargo install cargo-tarpaulin
EOF
```

- [ ] **Step 2: 添加根 package.json coverage 脚本**

在 `scripts` 中添加：

```json
"rust:coverage": "docker run --rm --security-opt seccomp=unconfined -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-coverage cargo tarpaulin --all-features --out Stdout --out Html --out Lcov --output-dir /app/coverage",
"rust:coverage:ci": "docker run --rm --security-opt seccomp=unconfined -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-coverage cargo tarpaulin --all-features --out Xml --out Lcov --output-dir /app/coverage"
```

- [ ] **Step 3: 验证后端覆盖率**

```bash
bun run rust:coverage
```

预期：终端输出覆盖率表格，`server-rust/coverage/` 目录生成 HTML 和 lcov 报告。

---

### Task 3: 根级覆盖率脚本和 .gitignore

**Files:**

- Modify: `package.json`（根）
- Modify: `.gitignore`

- [ ] **Step 1: 添加根 package.json 统一 coverage 脚本**

```json
"test:coverage": "bun run client:test:coverage",
"test:coverage:all": "bun run client:test:coverage && bun run rust:coverage"
```

- [ ] **Step 2: 更新 .gitignore 添加覆盖率输出目录**

```
# Coverage
coverage/
client/coverage/
server-rust/coverage/
```

- [ ] **Step 3: 验证 .gitignore 生效**

```bash
git status  # 确认 coverage 目录不被追踪
```

---

### Task 4: 更新 CLAUDE.md 文档

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 Essential Commands > Testing 部分添加覆盖率命令**

```markdown
### Coverage

- `bun run test:coverage` - Run frontend test coverage report
- `bun run rust:coverage` - Run Rust backend test coverage report (requires Docker)
- `bun run test:coverage:all` - Run coverage for both frontend and backend
```

- [ ] **Step 2: 在 Rust Backend 部分添加覆盖率相关说明**

在 Docker 命令列表中添加：

```markdown
- 覆盖率报告：`docker run --rm --security-opt seccomp=unconfined -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-coverage cargo tarpaulin --all-features --out Stdout --out Html --out Lcov --output-dir /app/coverage`
- 覆盖率 Docker 镜像构建：`docker build -t cloud-clipboard-rust-coverage -f- server-rust/ <<'EOF'\nFROM rust:1.93-bookworm\nRUN cargo install cargo-tarpaulin\nEOF`
```

- [ ] **Step 3: 验证文档一致性**

确认 CLAUDE.md 中的命令与实际 package.json scripts 一致。

---

## 关键决策记录

1. **前端选择 @vitest/coverage-v8 而非 istanbul**：v8 是 Vitest 官方推荐，性能更好，与 Vitest 4.x 兼容性最佳
2. **后端选择 cargo-tarpaulin 而非 cargo-llvm-cov**：llvm-cov 不兼容 Alpine/musl，tarpaulin 虽需 `--security-opt seccomp=unconfined` 但可在 Debian 容器中正常工作
3. **后端覆盖率使用独立 Debian 镜像**：tarpaulin 的 ptrace 依赖在 Alpine 上不稳定，Debian bookworm 更可靠
4. **不设置覆盖率阈值**：项目已有 580 个测试，先建立基线，后续再考虑阈值
5. **覆盖率输出目录**：前端 `client/coverage/`，后端 `server-rust/coverage/`，统一在 .gitignore 中排除
