# Cloud Clipboard 文档中心

欢迎来到 Cloud Clipboard 项目文档中心！这里汇集了项目的所有详细文档和指南。

## 📚 文档导航

### 核心文档

- **[README.md](../README.md)** - 项目概述和快速开始指南
- **[CLAUDE.md](../CLAUDE.md)** - Claude Code 开发指南和架构说明
- **[CHANGELOG.md](../CHANGELOG.md)** - 版本更新历史

### 专项指南

#### 🚀 部署指南

- **[Docker 部署指南](./DOCKER_DEPLOYMENT.md)** - 完整的 Docker 部署文档
  - 快速开始（默认部署和完整部署）
  - 环境变量配置
  - 安全特性
  - 生产环境部署
  - 监控和维护
  - 故障排除

#### 🔧 开发与发布

- **[发布指南](./RELEASE_GUIDE.md)** - 详细的版本发布流程
  - 自动化发布流程
  - GitHub Actions 工作流
  - 版本管理
  - 故障排除
  - 回滚发布

#### 🐛 调试与日志

- **[调试日志使用指南](./调试日志使用指南.md)** - 完整的调试系统说明
  - 前端调试日志
  - 后端日志配置
  - 实际使用场景
  - 常见问题

## 🏗️ 文档结构

```
docs/
├── README.md                      # 本文档
├── DOCKER_DEPLOYMENT.md          # Docker 部署指南
├── RELEASE_GUIDE.md              # 发布指南
├── 调试日志使用指南.md            # 调试日志指南
└── stories/                      # 用户故事（预留目录）
    └── （待补充）
```

## 📖 文档分类

### 按读者类型分类

#### 👨‍💻 开发者

- [CLAUDE.md](../CLAUDE.md) - 开发指南
- [发布指南](./RELEASE_GUIDE.md) - 发布流程
- [调试日志使用指南](./调试日志使用指南.md) - 调试方法

#### 🛠️ 运维人员

- [Docker 部署指南](./DOCKER_DEPLOYMENT.md) - 部署配置
- [发布指南](./RELEASE_GUIDE.md) - 发布管理

#### 👥 用户

- [README.md](../README.md) - 快速开始
- [调试日志使用指南](./调试日志使用指南.md) - 故障排除

### 按功能分类

#### 基础文档

- 项目介绍和快速开始
- 技术栈和架构说明
- 开发环境搭建

#### 部署文档

- Docker 容器化部署
- 生产环境配置
- 安全最佳实践

#### 开发文档

- 代码规范和最佳实践
- 测试框架
- 调试和日志

#### 发布文档

- 版本管理和发布流程
- 自动化工作流
- 回滚策略

## 🔄 文档更新

### 何时更新文档

根据 [CLAUDE.md](../CLAUDE.md#文档维护指南)，以下情况需要更新文档：

1. **新增或修改功能时**
   - 更新 README.md 的功能特性列表
   - 更新 CLAUDE.md 的架构说明
   - 更新相关接口文档

2. **新增或修改命令时**
   - 在 package.json 中添加新的 scripts
   - 同步更新 CLAUDE.md 的 Essential Commands 部分
   - 确保所有重要命令都有对应的中文说明

3. **修改架构或依赖时**
   - 更新 CLAUDE.md 的架构说明
   - 更新 README.md 的技术栈信息
   - 如有重大变更，更新 CHANGELOG.md

4. **新增环境变量时**
   - 更新 README.md 的环境变量部分
   - 更新相关的配置说明文档

### 文档一致性检查

项目包含自动化的文档一致性检查：

```bash
# 检查版本一致性
bun run version:check

# 检查文档与代码同步
bun run docs:sync
```

## 🤝 贡献指南

欢迎为文档做出贡献！

1. **发现问题**: 在 [GitHub Issues](https://github.com/your-username/cloud-clipboard/issues) 报告文档问题
2. **提交改进**: 创建 Pull Request 完善文档
3. **补充内容**: 添加新的使用场景或案例

## 📞 获取帮助

- **项目 Issues**: [GitHub Issues](https://github.com/your-username/cloud-clipboard/issues)
- **讨论区**: [GitHub Discussions](https://github.com/your-username/cloud-clipboard/discussions)
- **Wiki**: [项目 Wiki](https://github.com/your-username/cloud-clipboard/wiki) （待补充）

## 📄 许可证

所有文档均遵循 [MIT License](../LICENSE) 许可证。

---

**提示**: 建议按以下顺序阅读文档：

1. README.md - 了解项目
2. docs/README.md - 熟悉文档结构
3. 根据需要选择专项指南
