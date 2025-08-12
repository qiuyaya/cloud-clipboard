#!/bin/bash

# 云剪贴板部署脚本 / Cloud Clipboard Deployment Script
# 此脚本自动化部署过程并进行安全检查 / This script automates the deployment process with security checks

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Language detection based on system locale
if [[ "$LANG" =~ ^zh ]]; then
    LANG_MODE="zh"
else
    LANG_MODE="en"
fi

# Configuration
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env.production"
BACKUP_DIR="backups"
LOG_FILE="deploy.log"

# Functions with bilingual support
msg() {
    local key=$1
    case "$key" in
        "checking_requirements")
            if [ "$LANG_MODE" = "zh" ]; then echo "检查系统要求..."
            else echo "Checking system requirements..."; fi ;;
        "docker_not_installed")
            if [ "$LANG_MODE" = "zh" ]; then echo "Docker 未安装"
            else echo "Docker is not installed"; fi ;;
        "docker_compose_not_installed")
            if [ "$LANG_MODE" = "zh" ]; then echo "Docker Compose 未安装"
            else echo "Docker Compose is not installed"; fi ;;
        "insufficient_disk_space")
            if [ "$LANG_MODE" = "zh" ]; then echo "可用磁盘空间不足 2GB"
            else echo "Less than 2GB available disk space"; fi ;;
        "requirements_passed")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 系统要求检查通过"
            else echo "✓ System requirements check passed"; fi ;;
        "setting_up_directories")
            if [ "$LANG_MODE" = "zh" ]; then echo "设置目录结构..."
            else echo "Setting up directory structure..."; fi ;;
        "ownership_warning")
            if [ "$LANG_MODE" = "zh" ]; then echo "无法设置上传目录所有权"
            else echo "Could not set ownership on uploads directory"; fi ;;
        "directories_created")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 目录结构已创建"
            else echo "✓ Directory structure created"; fi ;;
        "creating_backup")
            if [ "$LANG_MODE" = "zh" ]; then echo "创建现有数据的备份..."
            else echo "Creating backup of existing data..."; fi ;;
        "backup_failed")
            if [ "$LANG_MODE" = "zh" ]; then echo "备份创建失败"
            else echo "Backup creation failed"; fi ;;
        "backup_created")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 备份已创建："
            else echo "✓ Backup created:"; fi ;;
        "security_checks")
            if [ "$LANG_MODE" = "zh" ]; then echo "执行安全检查..."
            else echo "Performing security checks..."; fi ;;
        "default_domain_warning")
            if [ "$LANG_MODE" = "zh" ]; then echo "在 nginx.conf 中发现默认域名 - 生产环境请更新"
            else echo "Default domain found in nginx.conf - please update for production"; fi ;;
        "localhost_warning")
            if [ "$LANG_MODE" = "zh" ]; then echo "在生产配置中发现 localhost URL"
            else echo "Localhost URLs found in production config"; fi ;;
        "fixed_permissions")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 修复了 docker-compose.yml 权限"
            else echo "✓ Fixed docker-compose.yml permissions"; fi ;;
        "security_completed")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 安全检查完成"
            else echo "✓ Security checks completed"; fi ;;
        "starting_deployment")
            if [ "$LANG_MODE" = "zh" ]; then echo "开始部署..."
            else echo "Starting deployment..."; fi ;;
        "services_deployed")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 服务已部署"
            else echo "✓ Services deployed"; fi ;;
        "health_checks")
            if [ "$LANG_MODE" = "zh" ]; then echo "执行健康检查..."
            else echo "Performing health checks..."; fi ;;
        "services_failed")
            if [ "$LANG_MODE" = "zh" ]; then echo "服务启动失败"
            else echo "Services failed to start properly"; fi ;;
        "health_passed")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 健康检查通过"
            else echo "✓ Health check passed"; fi ;;
        "health_failed")
            if [ "$LANG_MODE" = "zh" ]; then echo "健康检查失败，重试次数："
            else echo "Health check failed after"; fi ;;
        "deployment_status")
            if [ "$LANG_MODE" = "zh" ]; then echo "部署状态："
            else echo "Deployment Status:"; fi ;;
        "cleanup")
            if [ "$LANG_MODE" = "zh" ]; then echo "清理旧的 Docker 镜像..."
            else echo "Cleaning up old Docker images..."; fi ;;
        "cleanup_failed")
            if [ "$LANG_MODE" = "zh" ]; then echo "Docker 清理失败"
            else echo "Docker cleanup failed"; fi ;;
        "cleanup_completed")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 清理完成"
            else echo "✓ Cleanup completed"; fi ;;
        "deployment_success")
            if [ "$LANG_MODE" = "zh" ]; then echo "🎉 部署成功完成！"
            else echo "🎉 Deployment completed successfully!"; fi ;;
        "check_logs_hint")
            if [ "$LANG_MODE" = "zh" ]; then echo "使用以下命令查看日志："
            else echo "Check the logs with:"; fi ;;
        "starting_deployment_main")
            if [ "$LANG_MODE" = "zh" ]; then echo "开始云剪贴板部署..."
            else echo "Starting Cloud Clipboard deployment..."; fi ;;
        "wrong_directory")
            if [ "$LANG_MODE" = "zh" ]; then echo "请从项目根目录运行此脚本"
            else echo "Please run this script from the project root directory"; fi ;;
        "stopping_services")
            if [ "$LANG_MODE" = "zh" ]; then echo "停止服务..."
            else echo "Stopping services..."; fi ;;
        "services_stopped")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 服务已停止"
            else echo "✓ Services stopped"; fi ;;
        "restarting_services")
            if [ "$LANG_MODE" = "zh" ]; then echo "重启服务..."
            else echo "Restarting services..."; fi ;;
        "services_restarted")
            if [ "$LANG_MODE" = "zh" ]; then echo "✓ 服务已重启"
            else echo "✓ Services restarted"; fi ;;
        *) echo "$1" ;;
    esac
}

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $(msg "$1")${NC}" | tee -a "$LOG_FILE"
}

warn() {
    if [ "$LANG_MODE" = "zh" ]; then
        echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] 警告: $(msg "$1")${NC}" | tee -a "$LOG_FILE"
    else
        echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $(msg "$1")${NC}" | tee -a "$LOG_FILE"
    fi
}

error() {
    if [ "$LANG_MODE" = "zh" ]; then
        echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] 错误: $(msg "$1")${NC}" | tee -a "$LOG_FILE"
    else
        echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $(msg "$1")${NC}" | tee -a "$LOG_FILE"
    fi
    exit 1
}

check_requirements() {
    log "checking_requirements"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "docker_not_installed"
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "docker_compose_not_installed"
    fi
    
    # Check available disk space (at least 2GB)
    available_space=$(df . | awk 'NR==2 {print $4}')
    if [ "$available_space" -lt 2097152 ]; then
        warn "insufficient_disk_space"
    fi
    
    log "requirements_passed"
}

setup_directories() {
    log "setting_up_directories"
    
    mkdir -p data/uploads
    mkdir -p logs
    mkdir -p nginx/ssl
    mkdir -p "$BACKUP_DIR"
    
    # Set proper permissions
    chown -R 1001:1001 data/uploads 2>/dev/null || warn "ownership_warning"
    chmod 755 data/uploads
    
    log "directories_created"
}

backup_existing() {
    if [ -d "data/uploads" ] && [ "$(ls -A data/uploads)" ]; then
        log "creating_backup"
        backup_name="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
        tar -czf "$BACKUP_DIR/$backup_name" data/ 2>/dev/null || warn "backup_failed"
        echo -e "${GREEN}$(msg "backup_created") $backup_name${NC}" | tee -a "$LOG_FILE"
    fi
}

security_check() {
    log "security_checks"
    
    # Check for default passwords or keys
    if grep -q "your-domain.com" nginx.conf 2>/dev/null; then
        warn "default_domain_warning"
    fi
    
    # Check environment file
    if [ -f "$ENV_FILE" ]; then
        if grep -q "localhost" "$ENV_FILE"; then
            warn "localhost_warning"
        fi
    fi
    
    # Check file permissions
    if [ -f "docker-compose.yml" ]; then
        perms=$(stat -c "%a" docker-compose.yml)
        if [ "$perms" != "644" ]; then
            chmod 644 docker-compose.yml
            log "fixed_permissions"
        fi
    fi
    
    log "security_completed"
}

deploy() {
    log "starting_deployment"
    
    # Pull latest images
    docker-compose -f "$COMPOSE_FILE" pull
    
    # Build and start services
    docker-compose -f "$COMPOSE_FILE" up -d --build
    
    log "services_deployed"
}

health_check() {
    log "health_checks"
    
    # Wait for services to start
    sleep 10
    
    # Check if containers are running
    if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
        error "services_failed"
    fi
    
    # Test HTTP endpoint
    max_retries=30
    retry=0
    while [ $retry -lt $max_retries ]; do
        if curl -f -s http://localhost:3001/health > /dev/null; then
            log "health_passed"
            return 0
        fi
        retry=$((retry + 1))
        sleep 2
    done
    
    if [ "$LANG_MODE" = "zh" ]; then
        error "$(msg "health_failed") $max_retries 次后失败"
    else
        error "$(msg "health_failed") $max_retries retries"
    fi
}

show_status() {
    log "deployment_status"
    echo "==================="
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    if [ "$LANG_MODE" = "zh" ]; then
        echo "应用程序 URL: http://localhost"
        echo "API 健康检查: http://localhost/health"
        echo ""
        echo "查看日志: docker-compose logs -f"
        echo "停止服务: docker-compose down"
    else
        echo "Application URL: http://localhost"
        echo "API Health: http://localhost/health"
        echo ""
        echo "To view logs: docker-compose logs -f"
        echo "To stop services: docker-compose down"
    fi
}

cleanup() {
    log "cleanup"
    docker system prune -f > /dev/null 2>&1 || warn "cleanup_failed"
    log "cleanup_completed"
}

# Main deployment flow
main() {
    log "starting_deployment_main"
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ]; then
        error "wrong_directory"
    fi
    
    check_requirements
    setup_directories
    backup_existing
    security_check
    deploy
    health_check
    show_status
    cleanup
    
    log "deployment_success"
    echo -e "${GREEN}$(msg "check_logs_hint") docker-compose logs -f${NC}"
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "stop")
        log "stopping_services"
        docker-compose -f "$COMPOSE_FILE" down
        log "services_stopped"
        ;;
    "restart")
        log "restarting_services"
        docker-compose -f "$COMPOSE_FILE" restart
        log "services_restarted"
        ;;
    "logs")
        docker-compose -f "$COMPOSE_FILE" logs -f
        ;;
    "status")
        docker-compose -f "$COMPOSE_FILE" ps
        ;;
    "backup")
        backup_existing
        ;;
    "cleanup")
        cleanup
        ;;
    *)
        if [ "$LANG_MODE" = "zh" ]; then
            echo "用法: $0 {deploy|stop|restart|logs|status|backup|cleanup}"
            echo ""
            echo "  deploy   - 完整部署（默认）"
            echo "  stop     - 停止所有服务"
            echo "  restart  - 重启所有服务"
            echo "  logs     - 显示服务日志"
            echo "  status   - 显示服务状态"
            echo "  backup   - 创建数据备份"
            echo "  cleanup  - 清理 Docker 资源"
        else
            echo "Usage: $0 {deploy|stop|restart|logs|status|backup|cleanup}"
            echo ""
            echo "  deploy   - Full deployment (default)"
            echo "  stop     - Stop all services"
            echo "  restart  - Restart all services"
            echo "  logs     - Show service logs"
            echo "  status   - Show service status"
            echo "  backup   - Create backup of data"
            echo "  cleanup  - Clean up Docker resources"
        fi
        exit 1
        ;;
esac