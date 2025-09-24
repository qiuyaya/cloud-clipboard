# 🚀 Cloud Clipboard 发布指南

本文档详细说明了如何发布 Cloud Clipboard 的新版本，包括自动化流程和手动步骤。

## 📋 发布流程概览

我们使用自动化的发布流程，通过 GitHub Actions 构建和发布跨平台应用：

```
1. 版本更新 → 2. 创建标签 → 3. 自动构建 → 4. 发布到 GitHub Releases
```

## 🛠️ 准备工作

### 环境要求

- Node.js 18+
- Git 配置完整
- GitHub 仓库访问权限
- 干净的工作目录（无未提交的更改）

### 权限检查

确保 GitHub Actions 有以下权限：

- `contents: write` - 创建 releases
- `actions: read` - 访问工作流
- `packages: write` - 发布包（如果需要）

## 🎯 发布类型

### 语义化版本

我们遵循 [Semantic Versioning](https://semver.org/) 规范：

- **MAJOR** (x.0.0): 不兼容的 API 更改
- **MINOR** (0.x.0): 新功能，向后兼容
- **PATCH** (0.0.x): 向后兼容的 bug 修复

### 版本类型示例

```bash
# 补丁版本（bug 修复）
node scripts/release.js patch      # 1.0.0 → 1.0.1

# 次要版本（新功能）
node scripts/release.js minor      # 1.0.1 → 1.1.0

# 主要版本（破坏性更改）
node scripts/release.js major      # 1.1.0 → 2.0.0

# 指定版本
node scripts/release.js 2.1.0      # → 2.1.0

# 预发布版本
node scripts/release.js 2.1.0-beta.1
```

## 📝 发布步骤

### 1. 预发布检查

```bash
# 检查版本一致性
node scripts/version-sync.js check

# 检查代码质量
npm run lint
npm run type-check

# 检查构建状态
npm run build

# 检查过期依赖
node scripts/version-sync.js outdated
```

### 2. 创建发布

```bash
# 选择合适的版本类型
node scripts/release.js patch

# 或者预览更改（不实际发布）
node scripts/release.js patch --dry-run
```

发布脚本会自动：

- ✅ 检查工作目录状态
- ✅ 更新所有包的版本号
- ✅ 更新 Cargo.toml 和 tauri.conf.json
- ✅ 生成更新日志
- ✅ 创建 git commit 和 tag
- ✅ 推送到远程仓库

### 3. 监控自动构建

发布脚本完成后，GitHub Actions 会自动开始构建：

1. **访问 Actions 页面**: https://github.com/your-username/cloud-clipboard/actions
2. **监控 "Release" 工作流**
3. **等待所有平台构建完成**

### 4. 验证发布

构建完成后：

1. 检查 [Releases 页面](https://github.com/your-username/cloud-clipboard/releases)
2. 验证所有平台的文件都已上传
3. 测试下载链接
4. 验证版本号正确

## 🎨 发布脚本选项

### 基本使用

```bash
# 自动递增补丁版本
node scripts/release.js patch

# 自动递增次要版本
node scripts/release.js minor

# 自动递增主要版本
node scripts/release.js major

# 设置特定版本
node scripts/release.js 1.5.0
```

### 高级选项

```bash
# 预览模式（不做实际更改）
node scripts/release.js patch --dry-run

# 仅更新版本，不创建 git 标签
node scripts/release.js patch --no-git

# 创建标签但不推送到远程
node scripts/release.js patch --no-push

# 显示帮助
node scripts/release.js --help
```

## 🏗️ GitHub Actions 工作流

### Release 工作流 (`.github/workflows/release.yml`)

触发条件：

- 推送标签 `v*`
- 手动触发（workflow_dispatch）

构建矩阵：

- **Windows**: `x86_64-pc-windows-msvc` (.exe, .msi)
- **macOS Intel**: `x86_64-apple-darwin` (.dmg, .tar.gz)
- **macOS Apple Silicon**: `aarch64-apple-darwin` (.dmg, .tar.gz)
- **Linux**: `x86_64-unknown-linux-gnu` (binary, .deb, .AppImage)

输出文件：

- `cloud-clipboard-windows-x64.exe/msi`
- `cloud-clipboard-macos-x64.dmg/tar.gz`
- `cloud-clipboard-macos-arm64.dmg/tar.gz`
- `cloud-clipboard-linux-x64/.deb/.AppImage`
- `cloud-clipboard-web.tar.gz`

### CI 工作流 (`.github/workflows/ci.yml`)

在每个 PR 和推送时运行：

- 代码检查和类型检查
- Web 应用构建测试
- 桌面应用构建测试
- 安全审计
- 版本一致性检查

## 🔧 故障排除

### 常见问题

#### 1. 版本不一致错误

```bash
❌ Version mismatch: desktop has 1.0.0, expected 1.0.1
```

**解决方案**:

```bash
# 检查所有版本
node scripts/version-sync.js check

# 重新运行发布脚本
node scripts/release.js patch
```

#### 2. 工作目录不干净

```bash
❌ Working directory is not clean
```

**解决方案**:

```bash
# 查看未提交的更改
git status

# 提交或储藏更改
git add .
git commit -m "fix: your changes"
# 或
git stash
```

#### 3. 构建失败

**检查步骤**:

1. 查看 GitHub Actions 日志
2. 本地重现构建问题
3. 检查依赖项更新
4. 验证 Rust 工具链

#### 4. 发布资产缺失

**可能原因**:

- 构建脚本路径错误
- 文件名模式不匹配
- 权限问题

**解决方案**:

1. 检查工作流文件中的路径
2. 验证构建输出结构
3. 重新触发工作流

### 手动修复发布

如果自动发布失败，可以手动修复：

```bash
# 1. 删除远程标签
git push --delete origin v1.0.1
git tag -d v1.0.1

# 2. 修复问题后重新发布
node scripts/release.js 1.0.1

# 3. 或手动触发 GitHub Actions
# 在 GitHub 网页界面中使用 "Run workflow" 按钮
```

## 📊 发布检查清单

### 发布前

- [ ] 所有测试通过
- [ ] 代码审查完成
- [ ] 版本号遵循语义化规范
- [ ] 更新日志准备就绪
- [ ] 工作目录清洁

### 发布中

- [ ] 发布脚本执行成功
- [ ] GitHub Actions 构建开始
- [ ] 所有平台构建完成
- [ ] 发布资产上传成功

### 发布后

- [ ] 验证下载链接
- [ ] 测试关键平台
- [ ] 更新文档
- [ ] 通知用户
- [ ] 社交媒体宣传（可选）

## 🎁 发布资产详情

### 桌面应用

| 平台    | 文件格式                | 说明                      |
| ------- | ----------------------- | ------------------------- |
| Windows | .exe, .msi              | 便携版和安装包            |
| macOS   | .dmg, .tar.gz           | 磁盘镜像和压缩包          |
| Linux   | binary, .deb, .AppImage | 二进制、Debian 包、便携版 |

### Web 应用

| 文件                       | 内容          | 用途       |
| -------------------------- | ------------- | ---------- |
| cloud-clipboard-web.tar.gz | 完整 web 应用 | 自托管部署 |

## 🔄 回滚发布

如果发布有严重问题：

```bash
# 1. 立即删除有问题的发布
# 在 GitHub Releases 页面手动删除

# 2. 删除标签
git push --delete origin v1.0.1
git tag -d v1.0.1

# 3. 修复问题并重新发布
node scripts/release.js 1.0.2
```

## 🚨 紧急发布流程

对于安全修复或关键 bug：

```bash
# 1. 创建热修复分支
git checkout -b hotfix/security-fix

# 2. 提交修复
git add .
git commit -m "fix: critical security issue"

# 3. 合并到主分支
git checkout main
git merge hotfix/security-fix

# 4. 立即发布补丁版本
node scripts/release.js patch
```

---

## 📞 支持

如果在发布过程中遇到问题：

1. 查看 [GitHub Actions 日志](https://github.com/your-username/cloud-clipboard/actions)
2. 检查 [Issues](https://github.com/your-username/cloud-clipboard/issues)
3. 联系维护者

---

✨ **记住**: 自动化是我们的朋友！大部分发布流程都是自动化的，只需要执行 `node scripts/release.js patch` 就可以完成整个发布流程。
