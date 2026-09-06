#!/usr/bin/env bash
# 忆梦云团队开发
set -Eeuo pipefail

info() { printf '\033[1;34m[信息]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s 2>/dev/null || true)" = "Linux" ] || die "仅支持 Linux 服务器"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command_exists sudo || die "当前用户不是 root，且系统没有 sudo"
  SUDO="sudo"
fi

install_base_dependencies() {
  local missing=()
  command_exists curl || missing+=(curl)
  command_exists tar || missing+=(tar)
  command_exists openssl || missing+=(openssl)
  [ "${#missing[@]}" -eq 0 ] && return

  info "安装基础依赖: ${missing[*]}"
  if command_exists apt-get; then
    $SUDO apt-get update
    $SUDO apt-get install -y curl ca-certificates tar openssl
  elif command_exists dnf; then
    $SUDO dnf install -y curl ca-certificates tar openssl
  elif command_exists yum; then
    $SUDO yum install -y curl ca-certificates tar openssl
  else
    die "不支持当前包管理器，请先安装 curl、tar 和 openssl"
  fi
}

SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)

bootstrap_source() {
  [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/compose.yaml" ] && return

  install_base_dependencies
  local default_url="${KF_PACKAGE_URL:-https://raw.githubusercontent.com/yunmengnb/customer-service-system/initial-version/KF.tar.gz}"
  local package_url install_dir archive
  echo ""
  info "未检测到本地部署源码，需要下载 KF 安装包。"
  package_url="$default_url"
  [[ "$package_url" =~ ^https?:// ]] || die "安装包地址必须以 http:// 或 https:// 开头"

  read -r -p "安装目录 [/opt/yimeng-kf]: " install_dir
  install_dir=${install_dir:-/opt/yimeng-kf}
  archive=$(mktemp /tmp/yimeng-kf.XXXXXX.tar.gz)
  info "下载安装包"
  curl -fL --connect-timeout 15 --retry 2 "$package_url" -o "$archive" || die "安装包下载失败"
  $SUDO mkdir -p "$install_dir"
  $SUDO tar -xzf "$archive" -C "$install_dir" --strip-components=1 || die "安装包解压失败"
  rm -f "$archive"
  [ -f "$install_dir/compose.yaml" ] || die "安装包不完整：缺少 compose.yaml"
  $SUDO chmod +x "$install_dir/install.sh"
  info "源码已安装到 $install_dir"
  exec $SUDO env KF_LOCAL_INSTALL=1 bash "$install_dir/install.sh"
}

bootstrap_source

SCRIPT_DIR="$SOURCE_DIR"
[ -f "$SCRIPT_DIR/compose.yaml" ] || die "安装目录缺少 compose.yaml"
cd "$SCRIPT_DIR"
install_base_dependencies

install_docker() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then return; fi
  info "未检测到 Docker Engine 和 Compose 插件，准备安装。"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO systemctl enable --now docker 2>/dev/null || $SUDO service docker start 2>/dev/null || true
  $SUDO docker compose version >/dev/null 2>&1 || die "Docker Compose 插件安装失败"
}

ask() {
  local label="$1" default="$2" value
  read -r -p "$label [$default]: " value
  printf '%s' "${value:-$default}"
}

ask_secret() {
  local label="$1" value confirm
  while :; do
    read -r -s -p "$label: " value; printf '\n' >&2
    [ "${#value}" -ge 8 ] || { echo "密码至少 8 位" >&2; continue; }
    [[ "$value" =~ ^[A-Za-z0-9_@%+=:,!.-]+$ ]] || { echo "密码仅支持字母、数字及 _@%+=:,!.-" >&2; continue; }
    read -r -s -p "请再次输入: " confirm; printf '\n' >&2
    [ "$value" = "$confirm" ] && { printf '%s' "$value"; return; }
    echo "两次输入不一致" >&2
  done
}

valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
escape_env() { printf '%s' "$1" | tr -d '\r\n'; }
port_in_use() { command_exists ss && ss -lnt "sport = :$1" 2>/dev/null | grep -q LISTEN; }
dc() { $SUDO docker compose "$@"; }

install_docker
docker info >/dev/null 2>&1 || $SUDO docker info >/dev/null 2>&1 || die "Docker 服务不可用"

info "环境检测完成：Docker Engine、Compose、curl、tar、openssl 均可用。"
info "配置四个对外端口（容器内部端口保持不变）"
API_PORT=$(ask "后端 API 端口" "3000")
ADMIN_PORT=$(ask "平台管理端口" "5174")
USER_PORT=$(ask "租户客服端口" "5175")
CLIENT_PORT=$(ask "客户聊天端口" "5176")
for port in "$API_PORT" "$ADMIN_PORT" "$USER_PORT" "$CLIENT_PORT"; do
  valid_port "$port" || die "无效端口: $port"
  port_in_use "$port" && die "端口已被占用: $port"
done
[ "$(printf '%s\n' "$API_PORT" "$ADMIN_PORT" "$USER_PORT" "$CLIENT_PORT" | sort -u | wc -l)" -eq 4 ] || die "四个端口不能重复"

ADMIN_USERNAME=$(ask "平台管理员账号" "admin")
ADMIN_EMAIL=$(ask "平台管理员邮箱" "admin@example.com")
ADMIN_PASSWORD=$(ask_secret "平台管理员密码（至少 8 位）")
[[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || die "管理员账号仅支持 3-32 位字母、数字、点、下划线和连字符"
[[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "管理员邮箱格式不正确"

TENANT_PASSWORD=$(openssl rand -hex 12)
JWT_SECRET=$(openssl rand -hex 32)
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
HOST_IP=${HOST_IP:-localhost}
CORS_ORIGIN="http://$HOST_IP:$ADMIN_PORT,http://$HOST_IP:$USER_PORT,http://$HOST_IP:$CLIENT_PORT,http://localhost:$ADMIN_PORT,http://localhost:$USER_PORT,http://localhost:$CLIENT_PORT"

cat > .env <<EOF
# 忆梦云团队开发
API_PORT=$(escape_env "$API_PORT")
ADMIN_PORT=$(escape_env "$ADMIN_PORT")
USER_PORT=$(escape_env "$USER_PORT")
CLIENT_PORT=$(escape_env "$CLIENT_PORT")
JWT_SECRET=$(escape_env "$JWT_SECRET")
JWT_EXPIRES_IN=7d
APP_VERSION=1.0.1
APP_EDITION=Docker
CORS_ORIGIN=$(escape_env "$CORS_ORIGIN")
CLIENT_PUBLIC_URL=http://$(escape_env "$HOST_IP"):$(escape_env "$CLIENT_PORT")
DEFAULT_ADMIN_USERNAME=$(escape_env "$ADMIN_USERNAME")
DEFAULT_ADMIN_PASSWORD=$(escape_env "$ADMIN_PASSWORD")
DEFAULT_ADMIN_EMAIL=$(escape_env "$ADMIN_EMAIL")
DEFAULT_TENANT_NAME=示例企业
DEFAULT_TENANT_USERNAME=demo
DEFAULT_TENANT_PASSWORD=$(escape_env "$TENANT_PASSWORD")
EOF
chmod 600 .env

echo ""
echo "安装配置确认"
echo "  安装目录：$SCRIPT_DIR"
echo "  API 端口：$API_PORT"
echo "  管理后台：$ADMIN_PORT"
echo "  用户后台：$USER_PORT"
echo "  客户端口：$CLIENT_PORT"
echo "  管理账号：$ADMIN_USERNAME"
echo "  管理邮箱：$ADMIN_EMAIL"
read -r -p "确认开始安装？[Y/n]: " confirmed
[[ "${confirmed:-Y}" =~ ^[Yy]$ ]] || { rm -f .env; die "已取消安装"; }

info "校验 Compose 配置"
dc config --quiet
info "拉取、构建并启动服务"
dc up -d --build
info "等待后端健康"
for _ in $(seq 1 90); do
  server_id=$(dc ps -q server)
  status=$($SUDO docker inspect --format='{{.State.Health.Status}}' "$server_id" 2>/dev/null || true)
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { dc logs --tail=100 server; die "后端健康检查失败"; }
  sleep 2
done
server_id=$(dc ps -q server)
[ "$($SUDO docker inspect --format='{{.State.Health.Status}}' "$server_id" 2>/dev/null || true)" = "healthy" ] || die "等待后端健康超时"

info "初始化管理员、示例租户及默认渠道"
dc run --rm server node seed.js

if [ -f "$SCRIPT_DIR/ymkf.sh" ]; then
  info "安装 ymkf 管理命令"
  $SUDO install -m 755 "$SCRIPT_DIR/ymkf.sh" /usr/local/bin/ymkf
  printf '%s\n' "$SCRIPT_DIR" | $SUDO tee /etc/yimeng-kf.path >/dev/null
  $SUDO chmod 644 /etc/yimeng-kf.path
else
  warn "安装包缺少 ymkf.sh，未安装 ymkf 管理命令"
fi

echo ""
echo "安装完成"
echo "API 健康检查: http://$HOST_IP:$API_PORT/api/health"
echo "平台管理端:   http://$HOST_IP:$ADMIN_PORT"
echo "租户客服端:   http://$HOST_IP:$USER_PORT"
echo "客户聊天端:   http://$HOST_IP:$CLIENT_PORT"
echo "管理员账号:   $ADMIN_USERNAME"
echo "管理员密码已按输入配置，不会输出到日志。"
echo "管理菜单: ymkf"
echo "常用命令: cd $SCRIPT_DIR && sudo docker compose ps"
