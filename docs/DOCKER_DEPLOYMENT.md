# Docker 部署指南 / Docker Deployment Guide

> [English](#english) | [中文](#中文)

---

## 中文

## 概述

本指南介绍如何使用 Docker 部署云剪贴板应用程序，采用安全最佳实践和最小镜像大小。支持现代化的PWA图标系统和增强的文件管理功能。

## 快速开始

### 生产环境部署

#### 默认部署（推荐）

**单一容器部署，前端后端统一：**

```bash
# 创建数据目录
mkdir -p data/uploads logs

# 构建并启动服务（默认简单配置）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 应用将在 http://localhost 可用
```

#### 完整部署（带Nginx代理）

**使用Nginx反向代理的完整部署：**

```bash
# 创建数据目录
mkdir -p data/uploads logs

# 使用Nginx配置构建并启动服务
docker-compose -f docker-compose.nginx.yml up -d

# 查看日志
docker-compose -f docker-compose.nginx.yml logs -f
```

#### 手动 Docker 构建

**单一容器手动部署：**

```bash
# 构建镜像
docker build -t cloud-clipboard:latest .

# 运行容器（访问端口80）
docker run -d \
  --name cloud-clipboard \
  -p 80:3001 \
  -v $(pwd)/data/uploads:/app/uploads \
  -e NODE_ENV=production \
  cloud-clipboard:latest

# 应用将在 http://localhost 可用
```

### 开发环境

```bash
# 开发环境热重载
docker-compose -f docker-compose.dev.yml up -d
```

## 配置

### 环境变量

| 变量                      | 默认值                  | 描述                         |
| ------------------------- | ----------------------- | ---------------------------- |
| `NODE_ENV`                | `production`            | 环境模式                     |
| `PORT`                    | `3001`                  | 服务器端口                   |
| `CLIENT_URL`              | `http://localhost:3000` | 允许的客户端 URL（逗号分隔） |
| `UPLOAD_DIR`              | `/app/uploads`          | 文件上传目录                 |
| `MAX_FILE_SIZE`           | `104857600`             | 最大文件大小 (100MB)         |
| `ROOM_CLEANUP_INTERVAL`   | `3600000`               | 房间清理间隔（1小时）        |
| `FILE_RETENTION_HOURS`    | `12`                    | 文件保留时间                 |
| `RATE_LIMIT_WINDOW_MS`    | `60000`                 | 速率限制窗口                 |
| `RATE_LIMIT_MAX_REQUESTS` | `100`                   | 每窗口最大请求数             |

### 卷挂载

- `/app/uploads` - 文件存储（持久化）
- `/app/logs` - 应用程序日志（可选）

## 安全特性

### 容器安全

- **非 root 用户**：以用户 `1001:1001` (cloudclipboard) 运行
- **只读文件系统**：容器文件系统为只读
- **无新权限**：防止权限提升
- **最小基础镜像**：使用 Alpine Linux 减小攻击面
- **安全扫描**：定期漏洞扫描

### 网络安全

- **隔离网络**：自定义 Docker 网络
- **速率限制**：内置请求节流
- **CORS 保护**：可配置的允许来源
- **安全头部**：通过 Nginx 的全面 HTTP 安全头部

### 应用安全

- **输入验证**：所有输入使用 Zod 模式验证
- **文件类型限制**：只接受允许的文件类型
- **路径遍历保护**：安全的文件处理
- **内存限制**：防止资源耗尽

## 生产环境部署

### 1. 准备环境

```bash
# 创建目录结构
mkdir -p cloud-clipboard/{data/uploads,logs,nginx/ssl}
cd cloud-clipboard

# 复制配置文件
cp docker-compose.yml .
cp nginx.conf .
cp .env.production .env
```

### 2. 配置域名（可选）

更新 `nginx.conf` 以支持 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # ... 其余配置
}
```

### 3. SSL 证书

```bash
# 创建 SSL 证书目录
mkdir -p nginx/ssl

# 使用 Let's Encrypt（推荐）：
certbot certonly --standalone -d your-domain.com
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
```

### 4. 启动服务

```bash
# 启动并启用自动更新（可选）
docker-compose --profile auto-update up -d

# 启动不带自动更新
docker-compose up -d
```

### 5. 验证部署

```bash
# 检查服务状态
docker-compose ps

# 检查日志
docker-compose logs -f cloud-clipboard

# 测试端点
curl http://localhost/health
```

## 监控和维护

### 健康检查

应用程序包含内置的健康检查：

- HTTP 端点：`/health`
- Docker 健康检查：每 30 秒
- Nginx 上游健康监控

### 日志管理

```bash
# 查看应用程序日志
docker-compose logs cloud-clipboard

# 查看 Nginx 日志
docker-compose logs nginx

# 实时跟踪日志
docker-compose logs -f --tail=100
```

### 更新

```bash
# 手动更新
docker-compose pull
docker-compose up -d

# 使用 Watchtower（自动）
# 使用 --profile auto-update 启用
```

### 备份

```bash
# 备份上传的文件
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# 备份配置
cp docker-compose.yml nginx.conf .env.production backup/
```

## 扩展

### 水平扩展

高流量部署：

```yaml
services:
  cloud-clipboard:
    deploy:
      replicas: 3
    # ... 其余配置
```

### 资源限制

```yaml
services:
  cloud-clipboard:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
        reservations:
          cpus: "0.5"
          memory: 512M
```

## 故障排除

### 常见问题

1. **权限错误**：确保数据目录的正确所有权
2. **端口冲突**：检查端口 80, 443, 3001 是否可用
3. **文件上传失败**：验证上传目录权限和磁盘空间
4. **WebSocket 连接问题**：检查 CORS 和代理配置

### 调试命令

```bash
# 检查容器资源使用情况
docker stats

# 检查容器配置
docker inspect cloud-clipboard-app

# 访问容器 shell 进行调试
docker-compose exec cloud-clipboard sh

# 检查网络连接
docker-compose exec cloud-clipboard ping nginx
```

### 性能调优

1. **增加 nginx.conf 中的 worker 连接数**
2. **根据需求调整文件上传限制**
3. **配置适当的速率限制**
4. **监控内存使用情况**并调整容器限制

## 安全检查清单

- [ ] 容器以非 root 用户运行
- [ ] 启用只读文件系统
- [ ] 配置安全头部
- [ ] 启用速率限制
- [ ] 文件类型限制已就位
- [ ] 安装 SSL/TLS 证书
- [ ] 应用定期安全更新
- [ ] 配置日志监控
- [ ] 实施备份策略
- [ ] 配置网络分段

---

## English

## Overview

This guide covers deploying the Cloud Clipboard application using Docker with security best practices and minimal image sizes. Includes support for modern PWA icon system and enhanced file management features.

## Quick Start

### Production Deployment

#### Default Deployment (Recommended)

**Single container deployment with unified frontend and backend:**

```bash
# Create data directory
mkdir -p data/uploads logs

# Build and start services (default simple configuration)
docker-compose up -d

# View logs
docker-compose logs -f

# Application will be available at http://localhost
```

#### Full Deployment (with Nginx Proxy)

**Complete deployment with Nginx reverse proxy:**

```bash
# Create data directory
mkdir -p data/uploads logs

# Build and start services with Nginx configuration
docker-compose -f docker-compose.nginx.yml up -d

# View logs
docker-compose -f docker-compose.nginx.yml logs -f
```

#### Manual Docker Build

**Single container manual deployment:**

```bash
# Build the image
docker build -t cloud-clipboard:latest .

# Run the container (access on port 80)
docker run -d \
  --name cloud-clipboard \
  -p 80:3001 \
  -v $(pwd)/data/uploads:/app/uploads \
  -e NODE_ENV=production \
  cloud-clipboard:latest

# Application will be available at http://localhost
```

### Development

```bash
# Development with hot reload
docker-compose -f docker-compose.dev.yml up -d
```

## Configuration

### Environment Variables

| Variable                  | Default                 | Description                           |
| ------------------------- | ----------------------- | ------------------------------------- |
| `NODE_ENV`                | `production`            | Environment mode                      |
| `PORT`                    | `3001`                  | Server port                           |
| `CLIENT_URL`              | `http://localhost:3000` | Allowed client URLs (comma-separated) |
| `UPLOAD_DIR`              | `/app/uploads`          | File upload directory                 |
| `MAX_FILE_SIZE`           | `104857600`             | Max file size (100MB)                 |
| `ROOM_CLEANUP_INTERVAL`   | `3600000`               | Room cleanup interval (1 hour)        |
| `FILE_RETENTION_HOURS`    | `12`                    | File retention period                 |
| `RATE_LIMIT_WINDOW_MS`    | `60000`                 | Rate limit window                     |
| `RATE_LIMIT_MAX_REQUESTS` | `100`                   | Max requests per window               |

### Volume Mounts

- `/app/uploads` - File storage (persistent)
- `/app/logs` - Application logs (optional)

## Security Features

### Container Security

- **Non-root user**: Runs as user `1001:1001` (cloudclipboard)
- **Read-only filesystem**: Container filesystem is read-only
- **No new privileges**: Prevents privilege escalation
- **Minimal base image**: Uses Alpine Linux for small attack surface
- **Security scanning**: Regular vulnerability scans

### Network Security

- **Isolated networks**: Custom Docker networks
- **Rate limiting**: Built-in request throttling
- **CORS protection**: Configurable allowed origins
- **Security headers**: Comprehensive HTTP security headers via Nginx

### Application Security

- **Input validation**: All inputs validated with Zod schemas
- **File type restrictions**: Only allowed file types accepted
- **Path traversal protection**: Secure file handling
- **Memory limits**: Prevents resource exhaustion

## Production Deployment

### 1. Prepare Environment

```bash
# Create directory structure
mkdir -p cloud-clipboard/{data/uploads,logs,nginx/ssl}
cd cloud-clipboard

# Copy configuration files
cp docker-compose.yml .
cp nginx.conf .
cp .env.production .env
```

### 2. Configure Domain (Optional)

Update `nginx.conf` for HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # ... rest of configuration
}
```

### 3. SSL Certificates

```bash
# Create SSL certificates directory
mkdir -p nginx/ssl

# For Let's Encrypt (recommended):
certbot certonly --standalone -d your-domain.com
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
```

### 4. Start Services

```bash
# Start with auto-updates (optional)
docker-compose --profile auto-update up -d

# Start without auto-updates
docker-compose up -d
```

### 5. Verify Deployment

```bash
# Check service status
docker-compose ps

# Check logs
docker-compose logs -f cloud-clipboard

# Test endpoint
curl http://localhost/health
```

## Monitoring and Maintenance

### Health Checks

The application includes built-in health checks:

- HTTP endpoint: `/health`
- Docker health check: Every 30 seconds
- Nginx upstream health monitoring

### Log Management

```bash
# View application logs
docker-compose logs cloud-clipboard

# View Nginx logs
docker-compose logs nginx

# Follow logs in real-time
docker-compose logs -f --tail=100
```

### Updates

```bash
# Manual update
docker-compose pull
docker-compose up -d

# With Watchtower (automatic)
# Enabled with --profile auto-update
```

### Backup

```bash
# Backup uploaded files
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Backup configuration
cp docker-compose.yml nginx.conf .env.production backup/
```

## Scaling

### Horizontal Scaling

For high-traffic deployments:

```yaml
services:
  cloud-clipboard:
    deploy:
      replicas: 3
    # ... rest of configuration
```

### Resource Limits

```yaml
services:
  cloud-clipboard:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
        reservations:
          cpus: "0.5"
          memory: 512M
```

## Troubleshooting

### Common Issues

1. **Permission errors**: Ensure proper ownership of data directories
2. **Port conflicts**: Check that ports 80, 443, 3001 are available
3. **File upload failures**: Verify upload directory permissions and disk space
4. **WebSocket connection issues**: Check CORS and proxy configuration

### Debug Commands

```bash
# Check container resource usage
docker stats

# Inspect container configuration
docker inspect cloud-clipboard-app

# Access container shell for debugging
docker-compose exec cloud-clipboard sh

# Check network connectivity
docker-compose exec cloud-clipboard ping nginx
```

### Performance Tuning

1. **Increase worker connections** in nginx.conf
2. **Adjust file upload limits** based on requirements
3. **Configure appropriate rate limits**
4. **Monitor memory usage** and adjust container limits

## Security Checklist

- [ ] Container runs as non-root user
- [ ] Read-only filesystem enabled
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] File type restrictions in place
- [ ] SSL/TLS certificates installed
- [ ] Regular security updates applied
- [ ] Log monitoring configured
- [ ] Backup strategy implemented
- [ ] Network segmentation configured
