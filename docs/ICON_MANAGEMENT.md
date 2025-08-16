# 图标管理指南 / Icon Management Guide

*[中文](#中文) | [English](#english)*

---

## 中文

### 概述

Cloud Clipboard 使用集中的图标管理系统，确保所有平台的图标一致性和便于维护。

### 图标架构

```
assets/icons/                    # 图标源文件（集中管理）
├── app-icon.svg                 # 主应用图标（SVG源文件）
├── favicon.svg                  # 网站图标（SVG源文件）
├── 32x32.png                    # 桌面图标 32x32
├── 128x128.png                  # 桌面图标 128x128
├── 128x128@2x.png               # 桌面图标 128x128 高DPI
├── icon.ico                     # Windows ICO格式
└── icon.icns                    # macOS ICNS格式

client/public/                   # Web图标（自动生成）
├── icon.svg                     # 主图标
├── favicon.svg                  # 网站图标
├── favicon-{size}x{size}.svg    # 各种尺寸的favicon
└── site.webmanifest             # PWA清单文件

desktop/src-tauri/icons/         # 桌面应用图标
├── app-icon.svg                 # SVG源文件（自动同步）
├── README.md                    # 转换说明
├── 32x32.png                    # PNG格式图标
├── 128x128.png                  # PNG格式图标
├── 128x128@2x.png               # 高DPI PNG图标
├── icon.ico                     # Windows ICO
└── icon.icns                    # macOS ICNS
```

### 工作流程

#### 1. 修改图标设计

编辑 `assets/icons/app-icon.svg` 文件，这是所有图标的源文件。

#### 2. 生成Web图标

```bash
# 自动生成所有Web平台需要的图标
bun run icons:generate
```

这会生成：
- 主应用图标
- 各种尺寸的favicon
- PWA清单文件

#### 3. 同步桌面图标

```bash
# 同步SVG源文件到桌面应用目录
bun run icons:sync-desktop
```

#### 4. 生成桌面格式（手动）

PNG、ICO、ICNS格式需要手动生成：

**推荐工具：**
- 在线转换：[CloudConvert](https://cloudconvert.com/) 或 [Convertio](https://convertio.co/)
- 本地工具：Inkscape、ImageMagick

**命令示例（如果有工具）：**
```bash
# 使用 ImageMagick
convert app-icon.svg -resize 32x32 32x32.png
convert app-icon.svg -resize 128x128 128x128.png
convert app-icon.svg -resize 256x256 128x128@2x.png
```

### 自动化集成

图标生成已集成到构建流程中：

- `bun run build` - 自动生成Web图标
- `bun run desktop:build` - 自动同步桌面图标

### 设计规范

#### 图标设计原则
- **简洁明了**：在小尺寸下仍能清晰识别
- **品牌一致**：使用统一的颜色和视觉风格
- **平台适配**：考虑不同平台的显示特性

#### 色彩规范
- 主色：`#6366f1` (Indigo-500)
- 辅色：`#3b82f6` (Blue-500)
- 背景：白色到浅灰渐变
- 强调色：`#10b981` (绿色，表示连接状态)

#### 尺寸要求
- **Web**: 16x16, 32x32, 48x48, 180x180, 192x192, 512x512
- **桌面**: 32x32, 128x128, 256x256 (高DPI)
- **源文件**: 256x256 SVG (可缩放)

### 故障排除

#### 图标未更新
1. 清理构建缓存：`rm -rf client/dist server/public`
2. 重新运行：`bun run icons:generate`
3. 重新构建：`bun run build`

#### 桌面图标问题
1. 确保PNG格式正确生成
2. 检查文件权限
3. 重新构建Tauri应用

---

## English

### Overview

Cloud Clipboard uses a centralized icon management system to ensure consistency across all platforms and ease of maintenance.

### Icon Architecture

```
assets/icons/                    # Icon source files (centralized)
├── app-icon.svg                 # Main app icon (SVG source)
├── favicon.svg                  # Website icon (SVG source)
├── 32x32.png                    # Desktop icon 32x32
├── 128x128.png                  # Desktop icon 128x128
├── 128x128@2x.png               # Desktop icon 128x128 high DPI
├── icon.ico                     # Windows ICO format
└── icon.icns                    # macOS ICNS format

client/public/                   # Web icons (auto-generated)
├── icon.svg                     # Main icon
├── favicon.svg                  # Website icon
├── favicon-{size}x{size}.svg    # Various sized favicons
└── site.webmanifest             # PWA manifest

desktop/src-tauri/icons/         # Desktop app icons
├── app-icon.svg                 # SVG source (auto-synced)
├── README.md                    # Conversion instructions
├── 32x32.png                    # PNG format icons
├── 128x128.png                  # PNG format icons
├── 128x128@2x.png               # High DPI PNG icons
├── icon.ico                     # Windows ICO
└── icon.icns                    # macOS ICNS
```

### Workflow

#### 1. Modify Icon Design

Edit the `assets/icons/app-icon.svg` file, which is the source for all icons.

#### 2. Generate Web Icons

```bash
# Auto-generate all icons needed for web platforms
bun run icons:generate
```

This generates:
- Main app icon
- Various sized favicons
- PWA manifest file

#### 3. Sync Desktop Icons

```bash
# Sync SVG source to desktop app directory
bun run icons:sync-desktop
```

#### 4. Generate Desktop Formats (Manual)

PNG, ICO, ICNS formats need manual generation:

**Recommended Tools:**
- Online: [CloudConvert](https://cloudconvert.com/) or [Convertio](https://convertio.co/)
- Local: Inkscape, ImageMagick

**Example Commands (if tools available):**
```bash
# Using ImageMagick
convert app-icon.svg -resize 32x32 32x32.png
convert app-icon.svg -resize 128x128 128x128.png
convert app-icon.svg -resize 256x256 128x128@2x.png
```

### Automation Integration

Icon generation is integrated into the build process:

- `bun run build` - Auto-generates web icons
- `bun run desktop:build` - Auto-syncs desktop icons

### Design Guidelines

#### Icon Design Principles
- **Simple & Clear**: Recognizable at small sizes
- **Brand Consistent**: Unified colors and visual style
- **Platform Adaptive**: Consider different platform characteristics

#### Color Specifications
- Primary: `#6366f1` (Indigo-500)
- Secondary: `#3b82f6` (Blue-500)
- Background: White to light gray gradient
- Accent: `#10b981` (Green, for connection status)

#### Size Requirements
- **Web**: 16x16, 32x32, 48x48, 180x180, 192x192, 512x512
- **Desktop**: 32x32, 128x128, 256x256 (high DPI)
- **Source**: 256x256 SVG (scalable)

### Troubleshooting

#### Icons Not Updating
1. Clear build cache: `rm -rf client/dist server/public`
2. Re-run: `bun run icons:generate`
3. Rebuild: `bun run build`

#### Desktop Icon Issues
1. Ensure PNG formats are correctly generated
2. Check file permissions
3. Rebuild Tauri application