# 会话数据与文件存储优化开发设计

## 1. 文档信息

- 项目：忆梦云多租户在线客服系统
- 设计范围：会话、消息、图片、视频、音频、普通文件的云端存储、本地缓存、同步与清理
- 单文件上限：沿用系统设置，当前为 50MB
- 默认会话附件有效期：2 天
- 消息保存原则：消息记录长期保存，附件按有效期清理
- 过期策略：严格失效
- 适用端：管理员后台、租户客服桌面端、租户客服手机端、客户聊天端、客户中心和 Android APP

## 2. 设计目标

1. MongoDB 作为会话和消息的权威数据源，支持跨设备同步、断线恢复和后台审计。
2. 图片、视频和文件不写入 MongoDB，统一保存到文件系统或对象存储。
3. 使用独立附件模型管理上传、绑定、访问、过期、撤回和物理删除。
4. 浏览器和 APP 只保存可清理的本地缓存，不作为唯一聊天记录来源。
5. 首次打开会话后缓存最近消息、头像、图片和视频缩略图，减少重复请求。
6. 不自动完整缓存大视频；视频通过 HTTP Range 分段播放。
7. 附件过期、撤回或无权限后，即使客户端存在受控缓存，也不再通过系统展示。
8. 上传和消息发送支持幂等，避免重复消息及长期残留的孤立文件。
9. 所有数据和附件访问严格校验租户、渠道、会话和用户权限。
10. 支持从当前公开 `/uploads` URL 平滑迁移，不一次性破坏历史消息。

## 3. 非目标

本次不处理以下资源的生命周期：

- 客服、客户和管理员头像；
- 渠道头像及渠道欢迎图片源文件；
- 快捷回复和关键词回复资源；
- 投诉凭证；
- 客服端和客户端 APK；
- 前端构建静态资源；
- 用户主动保存到手机相册或系统下载目录的副本。

这些资源应使用独立目录和独立保留策略，不能由会话附件任务扫描删除。

## 4. 当前实现与主要问题

当前系统采用：

```text
MongoDB
  ├─ Conversation：会话状态、归属、未读数、最近消息时间
  └─ Message：消息正文、附件 URL、缩略图 URL、撤回和单侧删除状态

uploads 持久卷
  └─ <tenantId>/<tenant|customer>/<filename>
```

当前问题：

1. `Message` 只保存 `attachmentUrl` 和 `thumbnailUrl`，没有独立附件状态和过期时间。
2. 上传与发送消息是两个独立请求，上传成功但消息发送失败会产生孤立文件。
3. 服务端信任前端提交的附件 URL，无法可靠验证附件归属。
4. `/uploads` 是公开静态路径，知道 URL 即可绕过会话权限访问。
5. 撤回和单侧删除只修改消息字段，不删除磁盘文件。
6. 视频原件和缩略图缺少统一生命周期。
7. 浏览器没有 IndexedDB 消息缓存，刷新后需要重新请求历史消息。
8. 客服端 `/uploads` 当前采用 7 天公共缓存，与 2 天严格失效策略冲突。
9. 大视频若转换成完整 Blob 再缓存，会产生明显内存和存储压力。
10. 多端媒体消息的 `content` 内容不统一，不利于摘要、搜索和通知。

## 5. 总体架构

```text
客服端 / 客户端 / Android APP
  ├─ 本地消息数据库：IndexedDB 或 Room/SQLite
  ├─ 本地媒体缓存：Cache Storage 或 APP 缓存目录
  └─ 实时通知：Socket.IO
               │
               ▼
API 服务
  ├─ 身份和会话权限校验
  ├─ 消息幂等写入
  ├─ 附件受控读取
  ├─ Range 视频传输
  └─ 附件生命周期任务
       │                 │
       ▼                 ▼
MongoDB             文件存储
  ├─ Conversation     ├─ 本地共享持久卷
  ├─ Message          └─ 后续可切换 S3 兼容对象存储
  ├─ Attachment
  └─ CleanupJob
```

核心原则：

```text
MongoDB 消息记录 = 权威数据
云端文件存储 = 权威附件
浏览器或 APP 本地数据 = 可丢失缓存
Socket.IO = 实时通知，不是数据事实来源
```

## 6. 云端会话与消息存储

### 6.1 Conversation

保留当前 `Conversation` 模型及状态机：

```text
waiting → active → closed
closed + 客户发送新消息 → waiting
```

建议补充可选字段：

```js
{
  lastMessageId: ObjectId,
  lastMessageSequence: Number
}
```

用途：

- 快速生成会话摘要；
- 避免每次额外查询最后一条消息；
- 为后续稳定增量同步提供游标。

### 6.2 Message

保留当前字段并新增：

```js
{
  sequence: Number,
  attachmentId: ObjectId,
  attachmentStatus: 'none' | 'active' | 'expired' | 'recalled' | 'deleted',
  attachmentExpiredAt: Date
}
```

规则：

1. 文本消息不设置 `attachmentId`。
2. 图片、视频和文件消息必须绑定一个有效附件。
3. `content` 不再保存附件 URL。
4. 媒体消息的摘要由服务端根据 `messageType` 统一生成：

```text
image → [图片]
video → [视频]
file  → [文件] 文件名
```

5. 保留现有 `attachmentUrl`、`thumbnailUrl` 作为迁移兼容字段，迁移结束后停止写入。
6. `clientMessageId` 继续保持会话内唯一；重复发送请求返回已存在消息，不返回数据库重复键错误。
7. 消息必须先持久化，再更新会话摘要并广播 Socket 事件。

### 6.3 分页与增量同步

长期方案使用会话内递增 `sequence`：

```text
首次加载：GET /messages?limit=50
加载更早：GET /messages?beforeSequence=1200&limit=50
断线补拉：GET /messages?afterSequence=1250&limit=200
定位消息：GET /messages?aroundSequence=800&limit=50
```

同一会话内的 `sequence` 必须单调递增。第一阶段可以继续使用当前 ObjectId 游标，待迁移工具补齐历史序号后切换。

## 7. 云端附件存储

### 7.1 ConversationAttachment 模型

新增独立模型：

```js
{
  tenantId: ObjectId,
  channelId: ObjectId,
  conversationId: ObjectId,
  messageId: ObjectId,

  uploaderType: 'agent' | 'customer' | 'bot',
  uploaderId: ObjectId,

  category: 'image' | 'video' | 'audio' | 'file',
  storageProvider: 'local' | 's3',
  storageKey: String,
  thumbnailStorageKey: String,
  originalName: String,
  extension: String,
  mimeType: String,
  size: Number,
  checksum: String,

  status: 'pending' | 'active' | 'deleting' | 'deleted' | 'failed',
  uploadedAt: Date,
  activatedAt: Date,
  expiresAt: Date,
  deleteAfter: Date,
  deletedAt: Date,
  deleteReason: 'expired' | 'recalled' | 'orphaned' | '',

  cleanupAttempts: Number,
  lastCleanupError: String,
  cleanupLeaseUntil: Date
}
```

建议索引：

```text
{ status: 1, deleteAfter: 1 }
{ tenantId: 1, conversationId: 1, uploadedAt: -1 }
{ tenantId: 1, messageId: 1 }
{ storageKey: 1 } unique
{ cleanupLeaseUntil: 1 }
```

### 7.2 文件目录

本地持久卷推荐目录：

```text
uploads/
  conversations/
    <tenantId>/
      <attachmentId>/
        original.<ext>
        thumbnail.jpg
```

要求：

- 文件名由服务端生成，不使用用户原始文件名；
- 数据库只保存相对 `storageKey`，不保存硬编码域名；
- 路径拼接后必须确认仍位于允许的根目录内；
- 视频原件和缩略图属于同一附件记录；
- 非会话资源放在其他顶级目录，避免清理任务误删。

### 7.3 对象存储兼容

业务层使用统一存储接口：

```js
put(stream, metadata)
openReadStream(storageKey, range)
delete(storageKey)
exists(storageKey)
```

第一阶段实现本地持久卷提供者。以后迁移至 S3、MinIO 或云对象存储时，只替换存储实现，不修改消息和权限模型。

## 8. 上传与消息绑定流程

### 8.1 上传

```text
客户端选择文件
  ↓
POST /api/.../conversation-attachments
  ↓
校验身份、租户、渠道和会话权限
  ↓
校验大小、扩展名、声明 MIME 和文件签名
  ↓
写入临时文件并计算 SHA-256
  ↓
视频生成缩略图
  ↓
创建 pending 附件记录
  ↓
返回 attachmentId 和元数据
```

`pending` 附件默认设置：

```text
deleteAfter = uploadedAt + 24小时
```

响应示例：

```json
{
  "attachmentId": "...",
  "category": "video",
  "name": "demo.mp4",
  "size": 52428800,
  "mimeType": "video/mp4",
  "status": "pending"
}
```

### 8.2 发送附件消息

客户端只提交：

```json
{
  "messageType": "video",
  "attachmentId": "...",
  "clientMessageId": "..."
}
```

服务端验证：

- 附件为 `pending`；
- 附件属于当前租户和上传者；
- 附件所属会话与目标会话一致；
- 上传者仍有会话访问权限；
- 附件分类与消息类型一致；
- 文件真实存在且未超过单文件上限；
- `clientMessageId` 未被其他消息使用。

成功后在 MongoDB 事务中：

1. 创建消息；
2. 将附件更新为 `active` 并写入 `messageId`；
3. 设置 `expiresAt = message.createdAt + 2天`；
4. 更新会话最近消息和未读数；
5. 提交事务后广播 Socket.IO。

若相同 `clientMessageId` 已成功发送，应直接返回原消息和附件状态。

## 9. 受控读取与严格失效

不再向会话页面返回永久公开的磁盘 URL，统一使用：

```text
GET /api/files/:attachmentId
GET /api/files/:attachmentId/thumbnail
GET /api/files/:attachmentId/status
```

每次读取至少校验：

1. JWT 身份有效；
2. 附件所属租户与当前身份一致；
3. 当前用户有权访问附件所属会话；
4. 坐席仍满足渠道授权和会话访问规则；
5. 客户身份匹配当前渠道 Customer 绑定；
6. 附件状态为 `active`；
7. 当前时间早于 `expiresAt`；
8. 消息未撤回，并且对当前用户仍可见。

返回规则：

```text
200/206：允许读取
403：没有权限
404：附件不存在或不向当前身份暴露
410：附件已过期、已撤回或已删除
416：Range 范围无效
```

私有附件响应头：

```http
Cache-Control: private, no-cache
X-Content-Type-Options: nosniff
Content-Disposition: inline; filename*=UTF-8''...
```

视频必须支持：

```http
Accept-Ranges: bytes
Content-Range: bytes start-end/total
```

严格失效下不得继续对会话附件使用 `public, max-age=604800`。头像、渠道图片和构建资源仍可使用长期缓存，但必须与会话附件 URL 和 Nginx 路由分离。

## 10. 浏览器本地存储设计

### 10.1 存储职责

```text
IndexedDB
  ├─ 最近会话摘要
  ├─ 最近消息
  ├─ 同步游标
  └─ 附件元数据和缓存索引

Cache Storage
  ├─ 头像
  ├─ 图片缩略图
  ├─ 视频缩略图
  └─ 小型聊天图片

HTTP Cache
  └─ Vite 哈希构建资源
```

禁止使用 `localStorage` 保存图片、视频或文件。`localStorage` 只适合少量登录状态和用户偏好。

### 10.2 IndexedDB 建议结构

数据库名按应用版本管理：

```text
yimeng-chat-cache-v1
```

对象仓库：

```js
conversations: {
  key: `${identityScope}:${conversationId}`,
  lastMessageAt,
  updatedAt,
  data
}

messages: {
  key: `${identityScope}:${messageId}`,
  conversationId,
  sequence,
  createdAt,
  data
}

attachments: {
  key: `${identityScope}:${attachmentId}`,
  status,
  expiresAt,
  size,
  cachedAt,
  lastAccessedAt,
  cacheKey
}

syncState: {
  key: `${identityScope}:${conversationId}`,
  lastSequence,
  syncedAt
}
```

`identityScope` 必须包含应用类型、账号、租户和渠道边界，防止同一浏览器切换账号后读取前一账号的缓存。

### 10.3 缓存建议

```text
消息：每个会话最近 500 条或最近 30 天
头像：7～30 天
图片缩略图：7 天
视频缩略图：7 天
完整聊天图片：单张不超过 20MB，按需缓存
完整视频：默认不主动缓存
普通文件：默认不主动缓存
手机端缓存总量：建议 100～200MB
桌面端缓存总量：建议 500MB
```

缓存上限是应用策略，不代表浏览器保证提供对应空间。写入前调用：

```js
const { usage = 0, quota = 0 } = await navigator.storage.estimate()
```

只有满足以下条件才缓存完整图片：

```text
剩余配额 > 文件大小 × 2
并且缓存总量未超过应用上限
```

可请求持久化存储：

```js
await navigator.storage.persist()
```

即使申请成功，本地缓存仍可能被用户主动清除，不能作为唯一数据源。

### 10.4 50MB 文件策略

当前单文件上限为 50MB，浏览器通常可以保存，但不应默认将 50MB 文件整体读取为 Blob 后写入缓存。

分类策略：

```text
头像、缩略图
  → 自动缓存

图片 ≤ 20MB
  → 用户查看后按需缓存

图片 > 20MB
  → 只缓存缩略图，原图按需请求

视频
  → 只缓存缩略图，播放时使用 HTTP Range 分段加载

普通文件
  → 用户点击下载，不写入聊天缓存
```

禁止使用以下方式自动缓存大视频：

```js
const blob = await fetch(videoUrl).then(response => response.blob())
```

这会同时占用下载缓冲、Blob 和播放器内存，低内存手机可能出现卡顿或页面被系统终止。

### 10.5 本地清理

触发时机：

- 应用启动；
- 打开会话；
- 收到附件状态更新；
- 每 24 小时一次；
- 写入前发现缓存达到上限；
- 退出账号。

规则：

1. 先删除已过期、已撤回和已删除附件缓存；
2. 再按 `lastAccessedAt` 执行 LRU 清理；
3. 删除媒体缓存不删除本地消息记录；
4. 退出账号时清理该账号的私有消息和媒体缓存；
5. 服务端返回 `410` 时立即删除对应缓存并更新消息占位状态。

## 11. Android APP 本地存储

Android APP 与浏览器保持相同数据语义：

```text
Room/SQLite
  ├─ conversations
  ├─ messages
  ├─ attachments
  └─ sync_state

应用缓存目录
  ├─ avatars
  ├─ thumbnails
  └─ viewed_images
```

规则：

- 消息和同步游标写入 Room/SQLite；
- 图片使用图片加载库的磁盘缓存；
- 视频使用流式播放器和 Range 请求；
- 不自动下载完整 50MB 视频；
- WorkManager 定期清理过期和 LRU 缓存；
- 用户主动下载的文件保存到系统下载目录后，不再承诺远程删除；
- 收到 `410` 或附件状态事件时，删除 APP 管理的缓存并显示过期占位。

## 12. 附件生命周期与清理

### 12.1 状态机

```text
pending → active → deleting → deleted
   │                    └────→ failed → deleting
   └─ 超过24小时未绑定 → deleting
```

### 12.2 过期规则

```text
普通附件：expiresAt = message.createdAt + retentionDays
历史附件：expiresAt = 历史消息 createdAt + retentionDays
撤回附件：立即失效，deleteAfter = 当前时间
孤立附件：uploadedAt + 24小时后删除
```

单侧删除不能立即删除物理文件，因为另一侧仍可能有权查看。物理删除由统一有效期、撤回状态或双方不可见且满足保留策略决定。

### 12.3 清理任务

建议每小时执行一次，每批处理 100 条：

1. 原子领取 `deleteAfter <= now` 的附件并设置 MongoDB 租约；
2. 删除缩略图；
3. 删除原文件；
4. 文件不存在视为幂等成功；
5. 更新附件为 `deleted`；
6. 更新消息 `attachmentStatus`；
7. 广播附件状态事件；
8. 记录数量、释放空间和错误。

多实例使用 `cleanupLeaseUntil` 互斥，不使用 Redis 作为任务的唯一事实来源。

## 13. Socket.IO 事件

新增：

```text
attachment.updated
```

消息体：

```json
{
  "conversationId": "...",
  "messageId": "...",
  "attachmentId": "...",
  "status": "expired",
  "expiredAt": "..."
}
```

广播范围：

- 当前会话客户房间；
- 有权查看该会话的坐席房间；
- 租户管理端所需房间。

不得全局广播。客户端收到后更新内存、IndexedDB 和媒体缓存。断线期间遗漏事件时，以 HTTP 历史消息中的附件状态为准。

## 14. API 设计

### 14.1 上传和读取

```text
POST /api/tenant/conversations/:conversationId/attachments
POST /api/client/conversation/attachments
GET  /api/files/:attachmentId
GET  /api/files/:attachmentId/thumbnail
GET  /api/files/:attachmentId/status
```

### 14.2 消息同步

```text
GET /api/tenant/conversations/:id/messages
GET /api/client/conversation/messages
```

兼容参数：

```text
limit
before
around
beforeSequence
afterSequence
aroundSequence
```

迁移完成后逐步停用 ObjectId 游标参数。

### 14.3 管理员配置和任务

```text
GET  /api/admin/settings
PUT  /api/admin/settings
POST /api/admin/storage/conversation-files/estimate
POST /api/admin/storage/conversation-files/cleanup
GET  /api/admin/storage/conversation-files/status
```

敏感操作必须同时使用管理员鉴权和超级管理员权限。

## 15. 前端显示规则

| 状态 | 页面显示 | 是否允许预览/下载 |
|---|---|---|
| pending | 发送中 | 否 |
| active | 正常附件 | 是 |
| expired | 该文件已过期并自动清理 | 否 |
| recalled | 对方撤回了一条消息 | 否 |
| deleted | 该文件已删除 | 否 |
| 上传失败 | 发送失败，可重试 | 否 |

所有端必须统一：

- 图片使用缩略图，点击后加载原图；
- 视频默认只显示缩略图和播放按钮；
- 视频无缩略图时显示占位，不自动加载视频 metadata；
- 头像、图片和缩略图使用懒加载；
- 媒体加载完成不强制把正在查看历史消息的用户拉到底部；
- 服务端返回 `410` 后不得继续使用旧 Blob URL 或 Cache Storage 响应。

## 16. Nginx 与缓存策略

将资源拆分：

```text
/assets/*                      Vite 哈希资源，一年 immutable
/uploads/public/*              头像、渠道资源，可按业务设置缓存
/api/files/:attachmentId       私有会话附件，受控读取
```

私有附件接口不得被以下规则覆盖：

```nginx
Cache-Control: public, max-age=604800
```

推荐：

```text
index.html：no-cache
Vite 哈希资源：public, max-age=31536000, immutable
公开头像和渠道图片：public 或 private，使用版本化 URL
会话附件：private, no-cache
API 和 Socket.IO：不做静态长期缓存
```

## 17. 安全要求

1. 所有附件查询必须包含并验证 `tenantId`。
2. 普通坐席必须验证渠道授权和会话访问范围。
3. 客户必须验证渠道级 `Customer._id`，不得误用全局 `accountId`。
4. 不接受客户端提交的任意文件路径或附件 URL。
5. 文件路径必须防止 `..` 等目录穿越。
6. 上传同时校验扩展名、声明 MIME、文件签名和大小。
7. 响应使用 `X-Content-Type-Options: nosniff`。
8. 下载文件名必须安全编码，禁止响应头注入。
9. 日志不得记录 JWT、完整文件内容、SMTP 密码或客户隐私。
10. 后续可增加病毒扫描；扫描完成前附件不得进入 `active`。
11. Socket 只广播到正确租户、渠道、坐席和客户房间。
12. 严格失效只保证系统和系统管理的缓存不再提供附件，无法删除用户另存到相册或下载目录的副本。

## 18. 历史数据迁移

### 阶段一：建立新模型

- 新增附件模型和字段；
- 保持旧 URL 读取；
- 新上传先生成附件记录；
- 消息接口支持 `attachmentId` 和旧 URL 双读。

### 阶段二：迁移历史附件

逐批扫描具有 `attachmentUrl` 的历史消息：

1. 解析并规范化旧 URL；
2. 确认路径位于 uploads 根目录；
3. 检查原文件和缩略图是否存在；
4. 根据消息、会话补齐租户和渠道；
5. 创建附件记录；
6. 根据消息创建时间计算 `expiresAt`；
7. 回填 `message.attachmentId` 和附件状态；
8. 无法识别或文件缺失时记录异常，不直接删除。

迁移任务必须支持：

- 分批执行；
- 断点续跑；
- dry-run 预估；
- 数量和容量统计；
- 重复执行不产生重复记录；
- 错误清单导出。

### 阶段三：切换受控读取

- 所有前端改用附件 ID；
- 停止向新消息写入公开 URL；
- 移除会话附件的公开 Nginx 缓存；
- 验证 403、404、410 和 Range 请求；
- 观察稳定后关闭旧会话附件公开路径。

### 阶段四：开启物理清理

- 先只标记过期，不删除文件；
- 管理员核对预估结果；
- 备份 MongoDB 和 uploads 持久卷；
- 开启小批量物理删除；
- 检查磁盘释放和失败记录后逐步扩大批次。

## 19. 实施顺序

### 第一阶段：云端附件治理

1. 新增 `ConversationAttachment` 模型。
2. 新增存储提供者接口及本地实现。
3. 新增专用会话附件上传接口。
4. 消息发送改为接受并校验 `attachmentId`。
5. 用 MongoDB 事务保证消息、附件和会话一致性。
6. 完善 `clientMessageId` 幂等响应。

### 第二阶段：受控读取

1. 新增文件、缩略图和状态接口。
2. 支持视频 Range 请求。
3. 修改管理员端、客服桌面端、客服手机端和客户聊天端。
4. 统一媒体消息摘要和过期占位。
5. 调整 Nginx 私有附件缓存规则。

### 第三阶段：自动清理

1. 系统设置“上传”改为“存储配置”。
2. 增加 2 天有效期、清理范围和孤立文件配置。
3. 实现定时任务、租约、重试、统计和手动执行接口。
4. 实现撤回附件快速失效及清理。
5. 迁移历史附件并分批开启删除。

### 第四阶段：客户端本地缓存

1. IndexedDB 保存最近会话、消息和同步游标。
2. Cache Storage 缓存头像、缩略图和小型图片。
3. 实现配额检测、LRU 和过期删除。
4. 完成客服桌面端、手机端和客户聊天端行为对齐。
5. Android APP 使用 Room/SQLite 和应用缓存目录实现相同策略。

### 第五阶段：稳定增量同步

1. 为消息增加会话内 `sequence`。
2. 实现 `beforeSequence` 和 `afterSequence`。
3. Socket 重连按序号补拉，不再固定补最近 50 条。
4. 完成历史消息序号迁移后停用 ObjectId 游标。

## 20. 验收标准

### 功能

- 新附件上传后为 `pending`，发送成功后变为 `active`。
- 上传后 24 小时未发送的附件可以自动删除。
- 图片、视频原件、视频缩略图和普通文件可以按消息时间正确过期。
- 附件过期后消息记录仍存在，并统一显示过期提示。
- 撤回附件立即无法通过系统读取，物理删除失败可重试。
- 任意一方单侧删除消息不会误删另一方仍可查看的附件。
- 50MB 视频可以通过 Range 请求正常播放，不要求完整加载后开始播放。
- 重试同一 `clientMessageId` 不产生重复消息和重复附件绑定。

### 权限

- 未登录用户不能访问私有附件。
- 跨租户、跨渠道、跨会话访问被拒绝。
- 未授权普通坐席不能读取其他渠道附件。
- 客户不能读取其他客户或其他渠道的附件。
- 已过期、已撤回和已删除附件返回正确状态。

### 本地缓存

- 第二次打开最近会话可以优先显示本地消息，再完成服务端增量同步。
- 同一头像和缩略图不重复下载。
- 大于 20MB 的图片和完整视频不被自动写入应用媒体缓存。
- 缓存超限后按 LRU 清理，不删除云端消息。
- 退出账号后不会向下一个账号展示前一个账号的私有缓存。
- 收到 `410` 后本地受控缓存被移除。

### 稳定性

- 清理任务多次运行结果一致。
- 多实例不会同时处理同一附件。
- 文件已不存在时清理任务仍能幂等完成。
- 删除失败具有错误记录和重试次数。
- Redis 不可用不影响消息持久化和附件清理事实状态。
- 迁移支持中断后继续，且不会生成重复附件记录。

### 性能

- 首次进入只加载最近 50 条消息。
- 加载历史消息不会一次性渲染全部媒体原件。
- 图片和视频默认先展示缩略图。
- 50MB 视频播放时服务端返回 `206 Partial Content`。
- 高频 Socket 消息不会触发会话列表和历史消息的全量重复加载。

## 21. 监控和审计

建议记录：

- 当前附件总数量和总容量；
- pending、active、expired、failed 数量；
- 每次清理扫描数、删除数和释放空间；
- 上传失败率和视频缩略图生成失败率；
- 文件接口 403、404、410、416 数量；
- Range 请求数量和流量；
- 本地存储配额不足次数；
- 历史迁移进度和异常数量。

清理审计至少包含：

```text
taskId
attachmentId
tenantId
messageId
deleteReason
size
startedAt
finishedAt
result
error
```

## 22. 最终方案结论

忆梦云应采用以下组合：

```text
MongoDB
  → 长期保存会话、消息、状态、权限关系和附件索引

本地持久卷或对象存储
  → 保存图片、视频、缩略图和普通文件

受控附件 API
  → 负责权限、有效期、Range 播放和严格失效

IndexedDB / Room
  → 缓存最近会话、消息和同步游标

Cache Storage / APP 缓存目录
  → 缓存头像、缩略图和小型图片

生命周期任务
  → 清理过期、撤回和孤立附件
```

该设计兼顾客服系统需要的跨设备云端记录、浏览器和 APP 的打开速度、50MB 文件限制、两天附件有效期、多租户权限隔离以及未来迁移对象存储的能力。