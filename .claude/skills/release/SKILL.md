---
name: release
description: 提交代码、发布新版本并推送到远程仓库
---

# Release Skill

一站式完成代码提交、版本发布和远程推送。

## 使用方式

```
/release                                   # 交互式选择版本类型
/release patch                             # 发布补丁版本
/release minor                             # 发布次要版本
/release major                             # 发布主要版本
/release 2.0.0                             # 发布指定版本号
```

## 执行步骤

### 1. 检查当前状态

运行以下命令了解项目状态：

```bash
git status
git log --oneline -5
bun run version:check
```

### 2. 处理未提交的变更

如果存在未提交的变更，调用 `/commit` skill 完成代码提交。

如果没有未提交的变更，跳过此步骤。

### 3. 确认版本号

```bash
# 查看当前版本
node -e "console.log(require('./package.json').version)"
```

- 如果用户指定了版本类型（patch/minor/major）或具体版本号，直接使用
- 如果用户未指定，根据自上次发布以来的 commit 内容推荐版本类型：
  - 存在 `feat:` 类型 commit → 推荐 `minor`
  - 仅有 `fix:` / `refactor:` / `chore:` 等 → 推荐 `patch`
  - 存在 breaking change → 推荐 `major`
- 向用户确认最终版本号

### 4. 执行发布

确认后执行发布脚本：

```bash
bun run release:<type>
```

或者使用具体版本号：

```bash
node scripts/release.js <version>
```

发布脚本会自动完成：

- 更新所有 package.json 中的版本号（root、client、server、shared）
- 生成 CHANGELOG.md
- 创建 release commit（`chore: release v<version>`）
- 创建 git tag（`v<version>`）
- 推送 commit 和 tag 到远程仓库

### 5. 验证发布结果

发布完成后验证：

```bash
git log --oneline -3
git tag -l --sort=-v:refname | head -5
git status
```

向用户报告发布结果，包括：

- 新版本号
- 推送状态
- 远程仓库状态

## 注意事项

- 发布前必须确保所有变更已提交（工作区干净）
- 发布前必须通过完整验证（`bun run validate`），包含测试
- 版本号遵循语义化版本规范（Semantic Versioning）
- 所有 package.json 版本号保持一致
- 发布过程中每个关键步骤都需要用户确认
- 如果发布失败，分析错误原因并指导用户修复
