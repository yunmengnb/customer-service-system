#!/usr/bin/env bash
# 忆梦云团队开发
set -Eeuo pipefail

CONFIG_FILE="/etc/yimeng-kf.path"
DEFAULT_INSTALL_DIR="/opt/yimeng-kf"
DEFAULT_PACKAGE_URL="https://raw.githubusercontent.com/yunmengnb/customer-service-system/initial-version/KF.tar.gz"

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

resolve_install_dir() {
  local configured=""
  if [ -r "$CONFIG_FILE" ]; then
    IFS= read -r configured < "$CONFIG_FILE" || true
  fi
  if [ -n "$configured" ]; then
    printf '%s' "$configured"
  elif [ -f "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.yaml" ]; then
    cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
  else
    printf '%s' "$DEFAULT_INSTALL_DIR"
  fi
}

INSTALL_DIR=$(resolve_install_dir)
dc() { (cd "$INSTALL_DIR" && $SUDO docker compose "$@"); }
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
ask() {
  local label="$1" default="$2" value
  read -r -p "$label [$default]: " value
  printf '%s' "${value:-$default}"
}
ask_secret() {
  local value confirm
  while :; do
    read -r -s -p "新管理员密码（至少 8 位）: " value; printf '\n' >&2
    [ "${#value}" -ge 8 ] || { warn "密码至少 8 位"; continue; }
    [[ "$value" =~ ^[A-Za-z0-9_@%+=:,!.-]+$ ]] || { warn "密码仅支持字母、数字及 _@%+=:,!.-"; continue; }
    read -r -s -p "请再次输入: " confirm; printf '\n' >&2
    [ "$value" = "$confirm" ] && { printf '%s' "$value"; return; }
    warn "两次输入不一致"
  done
}
require_installation() {
  [ -f "$INSTALL_DIR/compose.yaml" ] && [ -f "$INSTALL_DIR/.env" ] || die "未检测到有效安装：$INSTALL_DIR"
  command_exists docker || die "未安装 Docker"
  $SUDO docker compose version >/dev/null 2>&1 || die "Docker Compose 插件不可用"
}
read_env() {
  local key="$1" fallback="$2" value
  value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$INSTALL_DIR/.env")
  printf '%s' "${value:-$fallback}"
}
port_in_use() {
  local port="$1" current="$2"
  [ "$port" = "$current" ] && return 1
  command_exists ss && ss -lnt "sport = :$port" 2>/dev/null | awk 'NR > 1 { found=1 } END { exit !found }'
}
wait_for_health() {
  local server_id status
  info "等待后端健康检查"
  for _ in $(seq 1 90); do
    server_id=$(dc ps -q server)
    status=$($SUDO docker inspect --format='{{.State.Health.Status}}' "$server_id" 2>/dev/null || true)
    [ "$status" = "healthy" ] && return
    [ "$status" = "unhealthy" ] && { dc logs --tail=100 server; die "后端健康检查失败"; }
    sleep 2
  done
  die "等待后端健康超时"
}
install_command() {
  $SUDO install -m 755 "$INSTALL_DIR/ymkf.sh" /usr/local/bin/ymkf
  printf '%s\n' "$INSTALL_DIR" | $SUDO tee "$CONFIG_FILE" >/dev/null
  $SUDO chmod 644 "$CONFIG_FILE"
}

install_or_upgrade() {
  if [ ! -f "$INSTALL_DIR/compose.yaml" ] || [ ! -f "$INSTALL_DIR/.env" ]; then
    warn "未检测到已安装系统，将启动一键安装程序。"
    if [ -f "$INSTALL_DIR/install.sh" ]; then
      exec $SUDO bash "$INSTALL_DIR/install.sh"
    fi
    command_exists curl || die "请先安装 curl"
    exec bash <(curl -fsSL "${KF_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/yunmengnb/customer-service-system/initial-version/install.sh}")
  fi

  require_installation
  [ -f "$INSTALL_DIR/ymkf.sh" ] || die "安装目录缺少 ymkf.sh，无法安全升级"
  command_exists curl || die "请先安装 curl"
  command_exists tar || die "请先安装 tar"
  local archive staging source_root env_backup package_url
  package_url="${KF_PACKAGE_URL:-$DEFAULT_PACKAGE_URL}"
  [[ "$package_url" =~ ^https?:// ]] || die "升级包地址必须以 http:// 或 https:// 开头"
  read -r -p "将从远程安装包升级并保留配置与数据，确认继续？[y/N]: " confirmed
  [[ "${confirmed:-N}" =~ ^[Yy]$ ]] || { info "已取消"; return; }

  archive=$(mktemp /tmp/yimeng-kf-upgrade.XXXXXX.tar.gz)
  staging=$(mktemp -d /tmp/yimeng-kf-upgrade.XXXXXX)
  env_backup=$(mktemp /tmp/yimeng-kf-env.XXXXXX)
  cp "$INSTALL_DIR/.env" "$env_backup"
  info "下载升级包"
  curl -fL --connect-timeout 15 --retry 2 "$package_url" -o "$archive" || die "升级包下载失败"
  tar -tzf "$archive" | awk '/(^|\/)\.\.($|\/)|^\// { bad=1 } END { exit bad ? 0 : 1 }' && die "升级包包含不安全路径"
  tar -xzf "$archive" -C "$staging" || die "升级包解压失败"
  if [ -f "$staging/compose.yaml" ]; then
    source_root="$staging"
  else
    local compose_file
    compose_file=$(find "$staging" -mindepth 2 -maxdepth 2 -name compose.yaml -print -quit)
    [ -n "$compose_file" ] || die "升级包不完整：缺少 compose.yaml"
    source_root=$(dirname "$compose_file")
  fi
  [ -f "$source_root/compose.yaml" ] || die "升级包不完整：缺少 compose.yaml"

  info "更新程序文件（保留 .env 和 Docker 数据卷）"
  $SUDO cp -a "$source_root/." "$INSTALL_DIR/"
  $SUDO cp "$env_backup" "$INSTALL_DIR/.env"
  $SUDO chmod 600 "$INSTALL_DIR/.env"
  $SUDO chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR/ymkf.sh"
  install_command
  dc config --quiet
  dc up -d --build
  wait_for_health
  rm -f "$archive" "$env_backup"
  rm -rf "$staging"
  info "系统升级完成"
}

reset_admin_password() {
  require_installation
  local default_username username password
  default_username=$(read_env DEFAULT_ADMIN_USERNAME admin)
  username=$(ask "平台管理员账号" "$default_username")
  [[ "$username" =~ ^[A-Za-z0-9_.-]{3,50}$ ]] || die "管理员账号格式不正确"
  password=$(ask_secret)
  info "重置管理员密码"
  RESET_ADMIN_USERNAME="$username" RESET_ADMIN_PASSWORD="$password" \
    dc run --rm -e RESET_ADMIN_USERNAME -e RESET_ADMIN_PASSWORD server node reset-admin-password.js
  unset password RESET_ADMIN_PASSWORD
}

reset_ports() {
  require_installation
  local old_api old_admin old_user old_client api admin user client host_ip cors client_url tmp
  old_api=$(read_env API_PORT 3000)
  old_admin=$(read_env ADMIN_PORT 5174)
  old_user=$(read_env USER_PORT 5175)
  old_client=$(read_env CLIENT_PORT 5176)
  api=$(ask "后端 API 端口" "$old_api")
  admin=$(ask "平台管理端口" "$old_admin")
  user=$(ask "租户客服端口" "$old_user")
  client=$(ask "客户聊天端口" "$old_client")
  for pair in "$api:$old_api" "$admin:$old_admin" "$user:$old_user" "$client:$old_client"; do
    local port=${pair%%:*} current=${pair##*:}
    valid_port "$port" || die "无效端口: $port"
    port_in_use "$port" "$current" && die "端口已被其他程序占用: $port"
  done
  [ "$(printf '%s\n' "$api" "$admin" "$user" "$client" | sort -u | wc -l)" -eq 4 ] || die "四个端口不能重复"

  host_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  host_ip=${host_ip:-localhost}
  cors="http://$host_ip:$admin,http://$host_ip:$user,http://$host_ip:$client,http://localhost:$admin,http://localhost:$user,http://localhost:$client"
  client_url="http://$host_ip:$client"
  tmp=$(mktemp "$INSTALL_DIR/.env.XXXXXX")
  awk -v api="$api" -v admin="$admin" -v user="$user" -v client="$client" -v cors="$cors" -v client_url="$client_url" '
    BEGIN { seen_api=seen_admin=seen_user=seen_client=seen_cors=seen_url=0 }
    /^API_PORT=/ { print "API_PORT=" api; seen_api=1; next }
    /^ADMIN_PORT=/ { print "ADMIN_PORT=" admin; seen_admin=1; next }
    /^USER_PORT=/ { print "USER_PORT=" user; seen_user=1; next }
    /^CLIENT_PORT=/ { print "CLIENT_PORT=" client; seen_client=1; next }
    /^CORS_ORIGIN=/ { print "CORS_ORIGIN=" cors; seen_cors=1; next }
    /^CLIENT_PUBLIC_URL=/ { print "CLIENT_PUBLIC_URL=" client_url; seen_url=1; next }
    { print }
    END {
      if (!seen_api) print "API_PORT=" api
      if (!seen_admin) print "ADMIN_PORT=" admin
      if (!seen_user) print "USER_PORT=" user
      if (!seen_client) print "CLIENT_PORT=" client
      if (!seen_cors) print "CORS_ORIGIN=" cors
      if (!seen_url) print "CLIENT_PUBLIC_URL=" client_url
    }
  ' "$INSTALL_DIR/.env" > "$tmp"
  $SUDO mv "$tmp" "$INSTALL_DIR/.env"
  $SUDO chmod 600 "$INSTALL_DIR/.env"
  dc config --quiet
  dc up -d --force-recreate
  wait_for_health
  info "端口已更新：API=$api，管理端=$admin，租户端=$user，客户端=$client"
  warn "如使用防火墙、安全组或反向代理，请同步放行和更新新端口。"
}

uninstall_system() {
  require_installation
  echo ""
  echo "1) 仅停止并移除容器，保留数据卷和安装文件"
  echo "2) 永久删除容器、数据卷和安装文件"
  echo "0) 取消"
  read -r -p "请选择 [0]: " mode
  case "${mode:-0}" in
    1)
      dc down
      info "已停止并移除容器，数据卷和安装文件已保留"
      ;;
    2)
      warn "此操作会永久删除 MongoDB、Redis、上传文件和安装目录，无法恢复。"
      read -r -p "请输入 DELETE 确认永久卸载: " confirmed
      [ "$confirmed" = "DELETE" ] || { info "已取消"; return; }
      dc down -v --remove-orphans
      $SUDO rm -rf -- "$INSTALL_DIR"
      $SUDO rm -f /usr/local/bin/ymkf "$CONFIG_FILE"
      info "系统及全部数据已永久卸载"
      exit 0
      ;;
    *) info "已取消" ;;
  esac
}

show_menu() {
  while :; do
    echo ""
    echo "================================"
    echo "      忆梦云客服管理工具 ymkf"
    echo "================================"
    echo "1) 安装 / 升级"
    echo "2) 重置管理员密码"
    echo "3) 卸载"
    echo "4) 重置端口"
    echo "0) 退出"
    read -r -p "请选择 [0-4]: " choice
    case "$choice" in
      1) install_or_upgrade ;;
      2) reset_admin_password ;;
      3) uninstall_system ;;
      4) reset_ports ;;
      0) info "已退出"; exit 0 ;;
      *) warn "无效选项，请重新选择" ;;
    esac
  done
}

show_menu
