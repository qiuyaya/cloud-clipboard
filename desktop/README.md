# Cloud Clipboard Desktop

基于 Tauri 的云剪切板桌面应用，支持跨平台部署（Windows、macOS、Linux、iOS、Android）。

## 功能特性

### 核心功能
- 🌐 **跨平台支持**: Windows、macOS、Linux、iOS、Android
- 📋 **自动剪切板监听**: 自动检测并同步剪切板内容到云端
- ⚙️ **灵活配置**: 支持自定义服务器地址、同步设置等
- 🔔 **系统通知**: 实时通知剪切板变化和系统事件
- 🎨 **现代界面**: 集成原有 React 界面，支持主题切换

### 配置选项
- **服务器配置**: 自定义服务器地址
- **剪切板功能**: 开启/关闭自动监听复制操作
- **同步设置**: 调整同步频率（500-10000ms）
- **界面设置**: 主题选择（浅色/深色/跟随系统）、语言切换
- **系统集成**: 系统托盘、开机启动

## 技术架构

### 技术选型
- **Tauri**: 使用 Rust + WebView，体积小、性能优秀
- **前端**: 复用现有 React + TypeScript + Vite 技术栈
- **后端**: Rust，提供原生系统功能接口
- **插件系统**: Tauri 官方插件生态

### 项目结构
```
desktop/
├── src-tauri/           # Rust 后端代码
│   ├── src/
│   │   ├── main.rs      # 主程序入口
│   │   └── lib.rs       # 库文件
│   ├── Cargo.toml       # Rust 依赖配置
│   └── tauri.conf.json  # Tauri 应用配置
├── src/                 # TypeScript 前端集成代码
│   ├── desktop-api.ts   # 桌面 API 封装
│   ├── clipboard-monitor.ts  # 剪切板监听
│   ├── desktop-integration.tsx  # React 集成
│   └── components/      # 桌面专用组件
└── scripts/             # 构建脚本
```

## 开发指南

### 环境准备
1. **安装 Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

2. **安装 Tauri CLI**:
   ```bash
   npm install -g @tauri-apps/cli
   ```

3. **安装依赖**:
   ```bash
   cd desktop
   npm install
   ```

### 开发模式
```bash
# 构建客户端并启动开发模式
npm run dev

# 仅构建客户端
node scripts/build-client.js
```

### 生产构建
```bash
# 构建所有平台
npm run build

# 构建特定平台
npm run tauri build -- --target x86_64-pc-windows-msvc  # Windows
npm run tauri build -- --target x86_64-apple-darwin     # macOS Intel
npm run tauri build -- --target aarch64-apple-darwin    # macOS Apple Silicon
npm run tauri build -- --target x86_64-unknown-linux-gnu # Linux
```

### 移动端构建
```bash
# 添加移动端支持
npm run tauri android init
npm run tauri ios init

# 构建 Android
npm run tauri android build

# 构建 iOS
npm run tauri ios build
```

## API 接口

### 配置管理
```typescript
interface AppConfig {
  server_url: string;     // 服务器地址
  auto_clipboard: boolean; // 自动剪切板监听
  sync_interval: number;   // 同步间隔（毫秒）
  theme: string;          // 主题（light/dark/system）
  language: string;       // 语言（zh/en）
  enable_tray: boolean;   // 系统托盘
  autostart: boolean;     // 开机启动
}

// 获取配置
const config = await DesktopAPI.getConfig();

// 更新配置
await DesktopAPI.setConfig(newConfig);
```

### 剪切板操作
```typescript
// 读取剪切板
const text = await DesktopAPI.getClipboardText();

// 写入剪切板
await DesktopAPI.setClipboardText("Hello World");

// 监听剪切板变化
const monitor = new ClipboardMonitor((text) => {
  console.log('Clipboard changed:', text);
});
monitor.start(1000); // 每秒检查一次
```

### 系统通知
```typescript
await DesktopAPI.showNotification(
  "标题",
  "通知内容"
);
```

## 部署说明

### 应用签名（生产环境）
1. **Windows**: 需要代码签名证书
2. **macOS**: 需要 Apple Developer 账号和证书
3. **Linux**: 支持 AppImage、deb、rpm 等格式
4. **移动端**: 需要相应平台的开发者账号

### 自动更新
Tauri 支持内置的自动更新机制，可以配置 GitHub Releases 或自定义更新服务器。

## 键盘快捷键

- `Ctrl/Cmd + ,`: 打开设置界面
- `Escape`: 关闭设置界面

## 故障排除

### 常见问题
1. **Rust 环境问题**: 确保正确安装 Rust 和 Cargo
2. **依赖错误**: 检查 Tauri 插件版本兼容性
3. **构建失败**: 确保所有平台工具链已安装

### 日志调试
开发模式下会自动打开 DevTools，生产版本可通过日志文件调试。

## 许可证

与主项目相同的许可证。