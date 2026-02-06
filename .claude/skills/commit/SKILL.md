---
name: commit
description: 智能提交代码，自动进行代码质量检查并生成符合项目规范的 commit 信息
---

# Commit Skill

提交代码前进行代码质量检查和规范的 commit 信息生成。

## 使用方式

```
/commit                                    # 自动生成 commit 信息
/commit 修复登录问题                       # 使用指定的 commit 信息
/commit fix: 修复登录问题                  # 使用带 type 的完整信息
```

## 执行步骤

### 1. 获取变更信息

运行以下命令获取当前变更：

```bash
git status
git diff --staged
git diff
git log --oneline -5                      # 查看最近提交风格
```

### 2. 代码质量检查

根据 CLAUDE.md 中的命令进行验证：

```bash
# 运行快速验证（format + lint + type-check）
bun run validate:quick

# 如果有测试文件变更，运行相关测试
CHANGED_TEST_FILES=$(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(test|spec)\.(ts|tsx)$' | tr '\n' ' ')
if [ -n "$CHANGED_TEST_FILES" ]; then
  bun run test -- "$CHANGED_TEST_FILES"
fi
```

**如果验证失败，必须修复后才能提交。**

### 3. 代码审查

审查变更的代码，关注以下方面：

- 是否有明显的 bug 或逻辑错误
- 是否符合 CLAUDE.md 中的编码规范
- 是否有潜在的性能问题
- 是否有安全隐患
- 文档是否需要同步更新（参考 CLAUDE.md 文档维护指南）

### 4. 生成 Commit 信息

**如果用户提供了完整的 commit 信息**：直接使用。

**如果用户只提供了 subject**（如 `修复登录问题`）：根据变更自动推断 type。

**如果用户未提供任何信息**：根据变更内容自动生成。

Commit 信息格式：

```
<type>: <subject>
```

**Type 类型**：

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档修改
- `style`: 格式修改（不影响代码逻辑）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关
- `perf`: 性能优化
- `revert`: 回滚

**规范**：

- 使用中文描述，符合项目语言习惯
- Header 最多 72 字符
- 每行最多 100 字符
- 不要包含 issue 号（本项目不使用 issue 系统）

### 5. 确认并提交

向用户展示：

1. 将要提交的文件列表
2. 生成的 commit 信息
3. 代码审查发现的问题（如有）

用户确认后执行：

```bash
git add <具体文件>
git commit -m "<commit信息>"
```

## 注意事项

- **优先添加具体文件**，避免使用 `git add -A`
- 不要提交 `.env`、`credentials.json` 等敏感文件
- 本项目使用 **中文** commit 信息
- 提交前确保相关测试通过
- 文档变更（README.md、CLAUDE.md）需要同步提交
- 提交后不要自动 push，除非用户明确要求
- 遵循本项目的提交风格，参考最近几次提交
