# 项目结构说明

> 本文依据当前 Git 索引中的受控文件逐项核对（`git ls-files`），不把本地未跟踪文件、构建产物或被忽略文件当作项目源码。涉及环境变量、签名与认证的部分只说明用途，不记录任何真实密码、密钥或令牌。

## 1. 根设施

| 路径 | 职责 |
| --- | --- |
| `.dockerignore` | 根构建上下文排除规则，避免依赖、构建产物、环境文件、上传目录和 Git 元数据进入 Docker 上下文。 |
| `.env.example` | Docker 部署环境变量模板，声明四个对外端口、版本/发行版、CORS、客户公开地址及初始化账号所需变量；值仅为示例占位。 |
| `.gitignore` | 全仓忽略规则，详见“忽略项”。 |
| `README.md` | Docker 版系统说明、服务器要求、一键安装、运维、持久化、升级和排错入口。 |
| `compose.yaml` | 编排 MongoDB、Redis、Node 服务和三个 Web/Nginx 容器；定义健康检查、端口映射、服务依赖及数据库、缓存、上传文件三个持久卷。 |
| `install.sh` | Linux 一键安装入口：获取安装包、检查/安装依赖、交互生成本地 `.env`、构建启动容器、等待健康并执行初始化，同时注册 `ymkf` 命令。 |
| `ymkf.sh` | 已部署系统的终端菜单，负责安装/升级、管理员密码重置、端口重设和分级卸载；升级时保留本地环境配置及 Docker 数据卷。 |

## 2. 三个 Web 端

三端均采用 Vue 3 + Vue Router + Vite，`package-lock.json` 锁定 npm 依赖；Dockerfile 负责前端构建并以 Nginx 托管，`nginx.conf` 负责 SPA 回退以及 `/api`、`/socket.io`、`/uploads` 等到服务端的反向代理。各目录中的 `README.md` 是 Vite 项目说明，`.gitignore` 是该子工程的本地忽略规则。

### 2.1 `admin-web/`：平台管理端

| 路径 | 职责 |
| --- | --- |
| `package.json` / `package-lock.json` | 管理 Vue、Router、Axios、Socket.IO 客户端、Pinia 与 Vite 依赖及 dev/build/preview 命令。 |
| `Dockerfile` / `nginx.conf` | 生产构建与静态站点/后端代理配置。 |
| `vite.config.js` | Vue 插件、开发服务器及本地代理配置。 |
| `index.html` | Vite HTML 入口。 |
| `public/favicon.svg` / `public/icons.svg` | 站点图标和公共 SVG 图标集。 |
| `src/main.js` | 创建 Vue 应用并挂载路由和全局样式。 |
| `src/App.vue` | 根组件及路由出口。 |
| `src/api.js` | `/api` Axios 实例；注入管理员 Bearer 令牌、统一解包响应、处理未授权和长时上传。 |
| `src/router.js` | 登录守卫及仪表盘、租户、客户、会话、投诉、公告、APP、设置、版本、个人资料路由。 |
| `src/style.css` | 平台管理端全局布局、组件与响应式样式。 |
| `src/views/Login.vue` | 平台管理员登录与验证码交互。 |
| `src/views/Layout.vue` | 登录后的侧栏、顶栏、导航和子路由布局。 |
| `src/views/Dashboard.vue` | 平台统计概览和最近注册租户。 |
| `src/views/Tenants.vue` | 租户检索、详情编辑、状态及套餐管理。 |
| `src/views/Customers.vue` | 全局客户账号查询、资料编辑和状态管理。 |
| `src/views/Conversations.vue` | 跨租户会话筛选及只读聊天记录检索/查看。 |
| `src/views/Complaints.vue` | 客户投诉列表、详情和处理状态维护。 |
| `src/views/Announcements.vue` | 面向租户的系统公告增删改、发布/下架。 |
| `src/views/AppManagement.vue` | 坐席/客户 Android 应用公告、APK 上传、版本与更新策略管理。 |
| `src/views/Settings.vue` | 网站、注册、邮件、验证码、上传等系统参数及邮件测试。 |
| `src/views/Version.vue` | 当前服务版本、发行信息与更新日志。 |
| `src/views/Profile.vue` | 管理员头像、账号、邮箱和密码资料维护。 |
| `src/components/HelloWorld.vue` | Vite 初始示例组件，当前不是业务路由页面。 |
| `src/assets/hero.png` / `vite.svg` / `vue.svg` | 模板/展示用静态资源。 |
| `verify_ui.py` | 管理端 UI 自动检查辅助脚本。 |

### 2.2 `user-web/`：租户与客服坐席端

| 路径 | 职责 |
| --- | --- |
| `package.json` / `package-lock.json` | 锁定 Vue/Vite、Axios、Socket.IO 等依赖及 npm 命令。 |
| `Dockerfile` / `nginx.conf` / `vite.config.js` / `index.html` | 构建、Nginx 托管与代理、开发配置和 HTML 入口。 |
| `public/favicon.svg` / `public/icons.svg` | 站点图标与公共图标资源。 |
| `src/main.js` / `src/App.vue` / `src/style.css` | 应用启动、根路由出口和全局样式。 |
| `src/api.js` | 租户 API 客户端，从会话级或持久存储读取令牌，统一处理响应及文件上传。 |
| `src/router.js` | 登录/注册/找回密码；按 768px 断点映射 `/desktop` 与 `/m`；兼容旧 URL；实施登录、管理员角色和设备路由守卫。 |
| `src/components/AuthCaptcha.vue` | 图形/极验验证码的可复用认证组件。 |
| `src/components/ChatPanel.vue` | 旧/共享会话面板入口。 |
| `src/components/ConfirmDialog.vue` | 通用确认对话框。 |
| `src/components/HelloWorld.vue` | Vite 初始示例组件。 |
| `src/views/Login.vue` / `Register.vue` / `ForgotPassword.vue` | 租户用户登录、租户注册及邮箱验证码找回密码。 |
| `src/views/Layout.vue` / `MobileLayout.vue` | 桌面与移动端导航、页面框架。 |
| `src/views/AnnouncementDetail.vue` | 桌面/移动共用公告详情。 |
| `src/views/Agents.vue` / `Channels.vue` / `ChannelDetail.vue` | 旧版员工、渠道列表及渠道配置页面，用于兼容/复用。 |
| `src/views/Messages.vue` / `ChatRoom.vue` | 旧版会话列表和独立聊天页入口。 |
| `src/views/desktop/Messages.vue` | 桌面会话列表，按渠道组织并展示未读状态。 |
| `src/views/desktop/ChatRoom.vue` / `ChatPanel.vue` | 桌面独立会话容器及完整聊天交互（历史、实时消息、附件、撤回/删除等）。 |
| `src/views/desktop/Channels.vue` / `ChannelDetail.vue` | 桌面渠道列表及品牌、接待人员、关键词回复、快捷回复配置。 |
| `src/views/desktop/Agents.vue` | 桌面员工创建、编辑、重置密码和代登录管理。 |
| `src/views/desktop/Announcements.vue` | 桌面系统公告列表。 |
| `src/views/desktop/Profile.vue` | 桌面个人资料、邮箱和密码安全设置。 |
| `src/views/mobile/Messages.vue` | 移动会话列表与渠道分组。 |
| `src/views/mobile/ChatRoom.vue` / `ChatPanel.vue` | 移动独立会话容器和触屏聊天交互。 |
| `src/views/mobile/Channels.vue` / `ChannelDetail.vue` | 移动渠道列表与渠道详细配置。 |
| `src/views/mobile/Agents.vue` | 移动员工管理。 |
| `src/views/mobile/Announcements.vue` | 移动系统公告列表。 |
| `src/views/mobile/Profile.vue` / `ProfileEdit.vue` | 移动个人中心展示及资料/邮箱/密码编辑。 |
| `src/views/mobile/About.vue` | 移动端关于、版本、公告和原生桥接入口。 |
| `src/assets/hero.png` / `vite.svg` / `vue.svg` | 模板/展示用静态资源。 |

### 2.3 `client-web/`：客户聊天与客户中心

| 路径 | 职责 |
| --- | --- |
| `package.json` / `package-lock.json` | 锁定 Vue/Vite、Axios、Socket.IO 等依赖及 npm 命令。 |
| `Dockerfile` / `nginx.conf` / `vite.config.js` / `index.html` | 构建、静态托管/代理、开发配置和 HTML 入口。 |
| `src/main.js` / `src/App.vue` / `src/style.css` | 应用启动、根路由出口和客户站全局样式。 |
| `src/api.js` | 客户 API 与 Socket.IO 单例；公开认证接口不注入令牌，受保护请求才携带客户令牌。 |
| `src/router.js` | `/c/:token` 渠道聊天、`/account` 客户中心和根路径分流。 |
| `src/views/ChatPage.vue` | 渠道信息、客户认证、会话与消息历史、实时收发、媒体附件、撤回/删除、在线状态和投诉入口。 |
| `src/views/AccountPage.vue` | 全局客户账号登录/注册/找回密码、历史渠道、资料、密码修改及 Android 客户端下载入口。 |
| `src/components/HelloWorld.vue` | Vite 初始示例组件。 |
| `public/manifest.webmanifest` | 客户中心 PWA 名称、图标、启动地址和显示模式。 |
| `public/sw.js` | 缓存应用壳；网络失败时为页面导航提供客户中心离线回退，不缓存 API。 |
| `public/pwa-192.png` / `pwa-512.png` | PWA 安装图标。 |
| `public/sounds/customer-message.wav` | 浏览器端客户新消息提示音。 |
| `public/favicon.svg` / `icons.svg` | 站点图标与公共图标集。 |
| `src/assets/hero.png` / `vite.svg` / `vue.svg` | 模板/展示用静态资源。 |

## 3. `server/` 分层与逐文件职责

服务端为 CommonJS Node.js + Express + Mongoose + Socket.IO；MongoDB 是核心数据源，Redis 用于缓存、限流、在线状态和多实例 Socket.IO，连接失败时部分能力降级到单进程内存。

### 3.1 根入口、构建与维护脚本

| 文件 | 职责 |
| --- | --- |
| `.dockerignore` | 服务端镜像构建排除项。 |
| `.env.example` | 服务端独立运行时的变量模板，只包含占位配置。 |
| `Dockerfile` | 安装生产依赖、复制源码并启动 `app.js`。 |
| `package.json` / `package-lock.json` | 声明服务版本、start/dev/seed 命令及 Express、Mongo、Redis、认证、上传、邮件、实时通信依赖。 |
| `app.js` | 总启动器：连接 Mongo/Redis，创建 HTTP/Socket.IO，安装安全/CORS/解析/请求 ID/登录限流，公开上传目录和健康检查，挂载六组路由并处理 404/异常。 |
| `seed.js` | 幂等初始化平台管理员、示例租户、租户所有者和默认渠道。 |
| `reset-admin-password.js` | 根据受控环境输入安全重置平台管理员密码和锁定状态。 |
| `check-index.js` | 检查 `messages` 集合现有索引及部分索引条件。 |
| `fix-index.js` | 修复消息幂等索引：检查并移除 `messages` 集合中旧的会话/客户端消息 ID 唯一索引，以便按当前模型重建。 |
| `fix-customers-index.js` | 清理并重建 `customers` 集合的渠道手机号唯一索引及租户、状态查询索引。 |
| `rebuild-index.js` | 重建 `messages` 集合的会话/客户端消息 ID 部分唯一索引，用于消息发送幂等。 |
| `verify-admin-permission.js` | 平台普通/超级管理员接口权限验证脚本。 |
| `verify-e2e.js` | 从租户、渠道、客户到聊天的端到端接口验证脚本。 |
| `verify-v3.js` | 第三版接口及上传流程验证脚本；其中认证文本为测试占位，不是生产凭据。 |

### 3.2 `src/config/` 配置层

| 文件 | 职责 |
| --- | --- |
| `index.js` | 集中读取端口、环境、Mongo、Redis、JWT、CORS 与初始化默认项。 |
| `db.js` | 建立 Mongoose 连接并输出连接状态。 |
| `redis.js` | 创建 Redis 客户端、容错连接、获取主客户端及为 Socket 订阅复制连接。 |
| `version.js` | 当前产品版本、发行版及版本更新日志数据。 |

### 3.3 `src/routes/` 路由层

| 文件 | 职责 |
| --- | --- |
| `admin.js` | `/api/admin`：平台认证、仪表盘、租户/客户/会话/投诉、公告、APP 版本、系统设置和版本信息；写操作按超级管理员权限收口。 |
| `tenant.js` | `/api/tenant`：租户认证与资料、公告、员工、渠道、关键词/快捷回复、会话接待和消息操作。 |
| `client.js` | `/api/client`：公开设置、客户账号与渠道认证、客户资料、历史渠道、会话消息和投诉。 |
| `app.js` | `/api/app`：两类 Android 应用的公开公告、版本检查及客户 APK 下载。 |
| `upload.js` | `/api/upload`：按管理员、租户、客户身份执行受限文件上传；另处理两类 APK 上传。 |
| `complaintUpload.js` | `/api/upload/complaint`：客户投诉图片上传，校验 MIME、扩展名、文件签名及会话归属。 |

### 3.4 `src/controllers/` 控制器层

| 文件 | 职责 |
| --- | --- |
| `AdminAuthController.js` | 平台管理员登录、当前身份、资料更新与退出。 |
| `TenantAdminController.js` | 平台侧租户列表/详情、资料、状态、套餐及仪表盘统计。 |
| `AdminCustomerController.js` | 平台侧全局客户账号查询、资料和状态维护。 |
| `AdminConversationController.js` | 平台侧跨租户会话筛选、消息搜索和只读记录分页。 |
| `TenantAuthController.js` | 租户注册/登录/退出、当前身份、个人资料、邮箱与密码验证码流程。 |
| `CustomerAuthController.js` | 全局客户账号及渠道上下文登录/注册、切换渠道、资料与密码、历史渠道。 |
| `AgentController.js` | 租户员工列表、创建、编辑、删除、密码重置与代登录。 |
| `ChannelController.js` | 渠道 CRUD、令牌轮换、接待人员，以及关键词/快捷回复 CRUD 和缓存失效。 |
| `ChatController.js` | 会话权限、接待/关闭、消息分页搜索、坐席/客户发送、媒体消息、自动回复、撤回/侧删/清空及 Socket 广播。 |
| `AnnouncementController.js` | 面向租户的系统公告后台管理和租户端查询。 |
| `AppController.js` | 坐席/客户 APP 公告与 Android 版本管理、公开检查、下载信息。 |
| `ComplaintController.js` | 投诉验证码邮件、创建、平台列表/详情及处理状态。 |
| `CaptchaController.js` | 按系统设置生成极验参数或本地图形验证码。 |
| `SystemSettingController.js` | 私有/公开系统设置读取、更新与邮件配置测试。 |
| `VersionController.js` | 返回服务版本与更新日志。 |

### 3.5 `src/middleware/` 中间件层

| 文件 | 职责 |
| --- | --- |
| `auth.js` | 校验并回查管理员、租户用户、客户身份，执行超级管理员/租户管理员授权，支持可选认证和请求 ID。 |
| `captcha.js` | 保存、消费和验证图形/极验验证码。 |
| `validators.js` | 各认证、公告、APP 版本、员工、渠道、客户资料与回复请求的声明式校验规则。 |
| `validate.js` | 汇总 express-validator 错误并返回统一业务响应。 |

### 3.6 `src/models/` 数据模型层

| 文件 | 职责 |
| --- | --- |
| `PlatformAdmin.js` | 平台管理员账号、角色、状态、安全与登录信息。 |
| `Tenant.js` | 租户主体、套餐配额、联系与状态信息。 |
| `TenantUser.js` | 租户所有者/管理员/坐席账号及租户内唯一性。 |
| `CustomerAccount.js` | 跨渠道共享的全局客户账号、联系方式、密码和状态。 |
| `Customer.js` | 全局客户账号在具体租户/渠道下的绑定，兼容保存渠道客户资料、状态及消息接收限制。 |
| `Channel.js` | 客服渠道公开令牌、品牌、欢迎/离线信息、分配方式、状态及可接待员工。 |
| `Conversation.js` | 租户、渠道、客户与坐席之间的会话状态、接待关系、双方未读数及最后消息时间。 |
| `Message.js` | 消息正文、发送方、类型、附件、客户端幂等 ID、撤回和双方删除标记。 |
| `KeywordReply.js` | 渠道关键词匹配方式、自动回复文本/图片及启用状态。 |
| `QuickReply.js` | 渠道坐席快捷回复标题、文本/图片及排序。 |
| `Announcement.js` | 系统/APP 公告受众、应用类型、正文、发布状态与时间。 |
| `AppVersion.js` | 按平台和应用类型记录版本码、下载地址、更新说明、强更/最低版本和发布状态。 |
| `Complaint.js` | 投诉内容、图片、客户/会话快照、联系方式与处理状态。 |
| `SystemSetting.js` | 单例式网站、注册、邮件、验证码与上传策略配置。 |

### 3.7 `src/sockets/` 与 `src/utils/`

| 文件 | 职责 |
| --- | --- |
| `sockets/index.js` | Socket.IO 认证回查、按管理员/租户/坐席/客户加入隔离房间、Redis Adapter、在线状态广播、查询与心跳。 |
| `utils/index.js` | 密码哈希比较、JWT 签发校验、随机令牌、手机号/指纹/IP 规范化和统一成功/错误响应。 |
| `utils/cache.js` | Redis JSON 缓存封装，并在 Redis 不可用时回退到带 TTL 的进程内缓存。 |
| `utils/presence.js` | Redis/内存在线连接计数、续期、断连和在线查询。 |
| `utils/emailVerification.js` | 邮箱归一化、验证码散列、发送、校验和一次性消费。 |
| `utils/mailer.js` | 根据系统邮件设置创建 Nodemailer 传输并发送邮件。 |
| `utils/systemSettings.js` | 系统设置缓存、对外字段裁剪和客户服务链接构建。 |

### 3.8 `migrations/` 数据迁移

| 文件 | 职责 |
| --- | --- |
| `20260905-chat-enhancements.js` | 为渠道、客户、关键词/快捷回复和消息补齐聊天增强字段；提供 up/down。 |
| `20260905-global-customer-accounts.js` | 从历史渠道客户数据生成全局客户账号并建立绑定/索引；提供回滚。 |
| `20260907-app-version-types.js` | 为 APP 版本加入坐席/客户类型，替换旧唯一索引并支持回滚。 |

## 4. 两个 Android 端

两者都是单模块原生 Java Android 工程，使用 Gradle Wrapper、Java 17、AndroidX WebView 和 Socket.IO 客户端。应用主体以安全 WebView 承载对应 Web 站点，原生前台服务在后台保持消息连接并产生系统通知。

### 4.1 `android-native-app/`：坐席 Android 端

| 路径 | 职责 |
| --- | --- |
| `.gitignore` | 忽略 Gradle/Android Studio、本机构建与签名相关文件。 |
| `settings.gradle` | 定义工程名并包含 `:app`。 |
| `build.gradle` | 根工程 Android Gradle Plugin 仓库和版本。 |
| `gradle.properties` | Gradle/JVM 与 AndroidX 构建参数。 |
| `gradlew` / `gradlew.bat` | Unix/Windows Gradle Wrapper 启动脚本。 |
| `gradle/wrapper/gradle-wrapper.properties` / `gradle-wrapper.jar` | 固定并引导 Gradle 发行版。 |
| `app/build.gradle` | 坐席应用 ID、SDK、版本、Java 17、release 构建及 AndroidX/Socket.IO 依赖。 |
| `app/proguard-rules.pro` | 应用自定义 R8/ProGuard 规则。 |
| `app/src/main/AndroidManifest.xml` | 声明网络、通知、开机、前台消息权限，注册单任务 Activity、前台服务和开机接收器，并禁用明文流量/备份。 |
| `.../AppConfig.java` | 坐席站点、移动消息页、公告/更新 API、偏好键和安全会话深链生成。 |
| `.../AppVisibility.java` | 记录应用当前是否在前台，防止前台重复弹系统通知。 |
| `.../BootReceiver.java` | 开机或应用更新后恢复前台消息服务。 |
| `.../MainActivity.java` | 配置受限 WebView、文件选择、返回导航、令牌桥接、通知权限、会话通知深链、启动公告、关于和版本更新。 |
| `.../MessageSocketService.java` | 持久化租户令牌，连接 Socket.IO；后台收到客户消息时建立高优先级通知并跳转对应会话。 |
| `res/layout/activity_main.xml` | WebView 与加载进度条主布局。 |
| `res/drawable/ic_notification.xml` | 单色状态栏通知图标。 |
| `res/values/strings.xml` / `colors.xml` / `themes.xml` | 应用文案、颜色和主题。 |
| `res/xml/backup_rules.xml` / `data_extraction_rules.xml` | 备份及设备迁移排除规则。 |
| `res/xml/network_security_config.xml` | 网络安全策略，仅允许受信任 HTTPS。 |
| `res/mipmap-anydpi-v26/ic_launcher.xml` / `ic_launcher_round.xml` | Android 8+ 自适应普通/圆形启动图标。 |
| `res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/` | 各密度的 `ic_launcher.png`、`ic_launcher_round.png` 和 `ic_launcher_foreground.png` 启动图资源。 |

### 4.2 `customer-android-app/`：客户 Android 端

| 路径 | 职责 |
| --- | --- |
| `.gitignore`、`settings.gradle`、根 `build.gradle`、`gradle.properties` | 工程包含关系、Android 插件/仓库、Gradle 参数和本地忽略规则。 |
| `gradlew` / `gradlew.bat` / `gradle/wrapper/*` | 跨平台、固定版本的 Gradle Wrapper。 |
| `app/build.gradle` | 客户应用 ID、SDK、版本、Java 17 与依赖；release 必须从本机 Gradle 属性或环境变量取得签名参数，签名文件不受控。 |
| `app/proguard-rules.pro` | 应用自定义混淆/压缩规则。 |
| `app/src/main/AndroidManifest.xml` | 声明网络、通知、开机与前台消息权限，注册 Activity、消息服务和开机接收器，禁用明文流量/备份。 |
| `.../AppConfig.java` | 客户站、客户中心、客户 APP 公告/更新 API、状态键及渠道深链生成。 |
| `.../AppVisibility.java` | 跟踪前后台可见性。 |
| `.../BootReceiver.java` | 开机/更新后恢复消息服务。 |
| `.../MainActivity.java` | 加载客户 Web 端，限定站内导航，支持文件选择、Web/原生令牌与渠道同步、通知深链、启动公告和版本更新。 |
| `.../MessageSocketService.java` | 保存客户及渠道状态、维持 Socket.IO、去重消息；后台收到坐席/机器人消息时通知并返回相应渠道。 |
| `res/layout/activity_main.xml` | WebView 与加载进度主界面。 |
| `res/drawable/ic_notification.xml` | 状态栏通知图标。 |
| `res/raw/customer_message.wav` | 客户端内置新消息音频资源。 |
| `res/values/strings.xml` / `colors.xml` / `themes.xml` | 客户应用文案、色彩和主题。 |
| `res/xml/backup_rules.xml` / `data_extraction_rules.xml` / `network_security_config.xml` | 禁止敏感状态备份/迁移并约束 HTTPS 网络访问。 |
| `res/mipmap-anydpi-v26/*` | Android 8+ 自适应普通/圆形启动图标。 |
| `res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/` | 各密度普通、圆形和前景启动图 PNG。 |

## 5. `releases/` 发布物

| 文件 | 职责 |
| --- | --- |
| `yimeng-staff-1.1.1.apk` | 已纳入版本控制的坐席 Android 安装包，与坐席工程当前 `versionName` 对应。 |
| `yimeng-customer-1.1.6.apk` | 已纳入版本控制的客户 Android 安装包，与客户工程当前 `versionName` 对应。 |

该目录保存可直接分发的二进制发布物；后台上传版本后，服务端以 `AppVersion` 记录下载地址和升级策略，并由 Android 客户端检查更新。

## 6. 运行链路

### 6.1 部署启动

1. `install.sh` 检查 Linux、基础工具、Docker/Compose，安全采集部署参数并在本地生成不受控 `.env`。
2. `docker compose up -d --build` 先构建所需镜像，再按健康依赖启动 MongoDB、Redis、`server` 和三个 Web 容器。
3. `server/app.js` 连接数据服务、挂载 HTTP API/上传目录/Socket.IO；MongoDB 必须可用，Redis 不可用时缓存、在线状态、限流和 Socket 扩展能力按代码降级。
4. 三个 Web 容器在 `server` 健康后启动 Nginx；各浏览器端以同源 `/api`、`/socket.io`、`/uploads` 访问后端。
5. 安装流程执行 `server/seed.js` 完成幂等初始数据，并安装 `ymkf` 运维入口。

### 6.2 业务请求与实时聊天

1. 平台、租户或客户浏览器进入各自 Vue 路由；Axios 请求进入相应的 `/api/admin`、`/api/tenant` 或 `/api/client` 路由。
2. 路由按需依次执行登录限流、验证码、参数校验、JWT/数据库状态回查和角色授权，再调用控制器。
3. 控制器读写 Mongoose 模型；缓存类配置、验证码和在线状态优先使用 Redis。
4. 聊天控制器写入 `Conversation`/`Message` 后向租户、渠道、坐席、客户账号或具体客户房间广播事件；三端 Socket.IO 客户端据此更新会话、消息、未读和在线状态。
5. 上传请求按身份及系统策略校验后写入 `server/uploads/` 持久卷，通过 `/uploads` 提供访问。

### 6.3 Android 链路

1. 坐席 APK 的 WebView 打开 `user-web` 移动路由；客户 APK 打开 `client-web` 客户中心或渠道路由。
2. 页面存储中的登录令牌经限定的 JavaScript Bridge 同步到应用私有偏好；前台服务用令牌连接同一 Socket.IO 服务。
3. 应用退到后台时，服务接收对端新消息并创建系统通知；点击通知通过已校验的会话 ID/渠道公开令牌回到 WebView 对应页面。
4. 启动/恢复时 Android 端调用 `/api/app` 的分类公告及版本接口；后台在 `admin-web` 管理公告、APK 与强制/最低版本策略。

## 7. 忽略项与受控边界

根 `.gitignore` 当前明确排除：

- 依赖和构建产物：任意 `node_modules/`、`dist/`、`build/`、`.gradle/`。
- 本机和敏感配置：任意 `.env`（但保留 `.env.example`）、Android `local.properties`、`signing/`、`*.jks`、`*.keystore`。
- 运行数据：`server/uploads/`、根或子目录 `.dbg/`。
- 编辑器/临时文件：`.vscode/`、交换文件、`*.tmp`、`*.log`。
- 本地工具/副本：`.trae/`、`KF/`、`.deploy_remote.py`、`.remote_*`。
- 本地调试记录：`debug-*.md`。

根 `.dockerignore` 还排除依赖、前端产物、环境文件、上传目录和 `.git`，避免将运行数据或凭据打进镜像。

核对时发现的根目录未跟踪图片不属于 Git 受控结构，因此本文不赋予其项目职责；被忽略的本地 `.env`、签名目录、上传数据、构建目录、IDE 配置和调试资料同样不逐文件描述。真实环境变量、邮件凭据、JWT 密钥、管理员密码、Android 签名材料和运行中令牌均不得写入本文或提交版本库。
