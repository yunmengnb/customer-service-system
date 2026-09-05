# 忆梦云客服系统 Docker 版

本目录是忆梦云多租户在线客服系统的 Docker 部署版本，包含平台管理端、租户客服端、客户聊天端、Node.js 服务端、MongoDB 和 Redis。

## 服务组成

| 服务 | 用途 | 默认端口 |
| --- | --- | ---: |
| `server` | API 与 Socket.IO 服务 | 3000 |
| `admin-web` | 平台管理员后台 | 5174 |
| `user-web` | 租户及客服后台 | 5175 |
| `client-web` | 客户聊天端 | 5176 |
| `mongo` | MongoDB 数据库 | 仅容器内访问 |
| `redis` | Redis 缓存与实时通信 | 仅容器内访问 |

安装时可以自定义四个对外端口，容器内部端口不变。

## 服务器要求

- Linux 服务器，推荐 Ubuntu 22.04/24.04、Debian 12、CentOS Stream、Rocky Linux 或 AlmaLinux。
- 建议至少 2 核 CPU、4 GB 内存和 20 GB 可用磁盘。
- 使用 `root` 用户，或具有 `sudo` 权限的普通用户。
- 服务器能够访问 GitHub、Docker 软件源及 Docker Hub。
- 防火墙和云安全组已放行安装时配置的四个端口。

安装脚本会检测 `curl`、`tar`、OpenSSL、Docker Engine 和 Docker Compose；缺失时使用 `apt`、`dnf` 或 `yum` 自动安装。

## GitHub 一键安装

在 Linux 服务器执行：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/yunmengnb/customer-service-system/initial-version/KF/install.sh)
```

脚本会依次完成：

1. 检测 Linux 系统及安装权限。
2. 检测并安装基础依赖。
3. 检测并安装 Docker Engine 与 Docker Compose 插件。
4. 从 GitHub 下载 `KF.tar.gz` 并解压到 `/opt/yimeng-kf`。
5. 交互配置 API、平台管理端、租户客服端和客户聊天端口。
6. 配置平台管理员账号、邮箱和密码。
7. 自动生成 JWT 密钥及示例租户随机密码。
8. 显示安装参数并等待确认。
9. 构建并启动全部容器。
10. 等待后端健康检查并初始化管理员、示例租户和默认渠道。

如需使用其他安装包地址：

```bash
KF_PACKAGE_URL=https://example.com/KF.tar.gz \
bash <(curl -Ls https://raw.githubusercontent.com/yunmengnb/customer-service-system/initial-version/KF/install.sh)
```

## 安装过程中的配置

脚本会依次询问：

```text
安装目录 [/opt/yimeng-kf]
后端 API 端口 [3000]
平台管理端口 [5174]
租户客服端口 [5175]
客户聊天端口 [5176]
平台管理员账号 [admin]
平台管理员邮箱 [admin@example.com]
平台管理员密码（至少 8 位）
```

管理员密码仅写入安装目录下的 `.env`，文件权限设置为 `600`，安装完成后不会在终端中显示密码。

## 本地目录安装

也可以下载仓库后从部署目录安装：

```bash
git clone -b initial-version https://github.com/yunmengnb/customer-service-system.git
cd customer-service-system/KF
chmod +x install.sh
sudo ./install.sh
```

## 安装完成后访问

假设服务器 IP 为 `192.0.2.10`，并使用默认端口：

```text
API 健康检查：http://192.0.2.10:3000/api/health
平台管理端：  http://192.0.2.10:5174
租户客服端：  http://192.0.2.10:5175
客户聊天端：  http://192.0.2.10:5176
```

生产环境建议通过 Nginx、Caddy 或云负载均衡绑定域名并配置 HTTPS。

## 常用运维命令

进入默认安装目录：

```bash
cd /opt/yimeng-kf
```

查看容器状态：

```bash
sudo docker compose ps
```

查看全部日志：

```bash
sudo docker compose logs -f
```

查看后端日志：

```bash
sudo docker compose logs -f server
```

重启全部服务：

```bash
sudo docker compose restart
```

停止服务：

```bash
sudo docker compose down
```

重新构建并启动：

```bash
sudo docker compose up -d --build
```

再次执行初始化程序：

```bash
sudo docker compose run --rm server node seed.js
```

初始化程序具有重复执行保护，不会重复创建同名管理员、示例租户和默认渠道。

## 修改配置

安装配置保存在：

```text
/opt/yimeng-kf/.env
```

修改后重新创建容器：

```bash
cd /opt/yimeng-kf
sudo docker compose up -d --force-recreate
```

不要将生产环境 `.env` 上传到 GitHub，也不要公开管理员密码和 `JWT_SECRET`。

## 数据持久化

Docker Compose 使用三个命名卷：

```text
yimeng-kf_mongo_data    MongoDB 数据
yimeng-kf_redis_data    Redis 数据
yimeng-kf_uploads_data  用户上传文件
```

普通执行以下命令不会删除数据：

```bash
sudo docker compose down
```

不要执行 `docker compose down -v`，除非明确需要永久删除数据库、Redis 数据和全部上传文件。

## 更新系统

进入仓库部署时可以拉取代码后重新构建：

```bash
cd /你的仓库路径
git pull
cd KF
sudo docker compose up -d --build
```

使用一键安装包部署时，建议先备份数据卷，再替换 `/opt/yimeng-kf` 中的源码并重新构建。更新 `.env` 时必须保留原来的 `JWT_SECRET`，否则已有登录令牌会失效。

## 故障排查

查看服务状态：

```bash
cd /opt/yimeng-kf
sudo docker compose ps
```

检查后端健康接口：

```bash
curl http://127.0.0.1:3000/api/health
```

查看最近 200 行后端日志：

```bash
sudo docker compose logs --tail=200 server
```

检查端口监听：

```bash
sudo ss -lntp
```

若网页无法访问，请依次检查：

1. `docker compose ps` 中服务是否为运行或健康状态。
2. 云服务器安全组是否放行对应端口。
3. Linux 防火墙是否放行对应端口。
4. 域名反向代理是否正确转发 `/api/`、`/uploads/` 和 `/socket.io/`。
5. `.env` 中 `CORS_ORIGIN` 是否包含实际访问地址。

## 卸载

停止并移除容器，但保留数据：

```bash
cd /opt/yimeng-kf
sudo docker compose down
```

永久清除容器和数据卷：

```bash
cd /opt/yimeng-kf
sudo docker compose down -v
```

`down -v` 会永久删除数据库、Redis 数据和上传文件，执行前必须确认已经备份。
