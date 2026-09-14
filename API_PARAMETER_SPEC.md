# 忆梦云客服系统接口参数规范

## 1. 版本、范围与阅读约定

- 文档版本：1.0，2026-09-11。基线为 **当前工作区源码（包含原有未提交改动及本次消息入口校验）**，不是线上契约认证，也不表示已部署。
- 应用版本配置为 1.1.8；运行环境可覆盖版本和 edition。本次不升级应用版本、不迁移数据库、不提交或部署。
- 事实来源：Express 实际挂载、全部七个路由模块、控制器、验证器、Mongoose 模型、附件服务、Socket.IO 入口以及三个 Vue 前端 API 调用。HTTP 清单按方法与完整路径逐项列出；自动测试将清单与路由交叉比较。
- 以下表格中 `P`=路径参数，`Q`=查询参数，`B`=JSON body，`H`=请求头，`F`=multipart 文件。`!`=必填，`?`=可选。未标默认值的可选更新字段默认保留；无参数表示无业务 P/Q/B/F，仍须鉴权头（若要求）。每个 `:参数` 都是必填 P，通用定义在下一节。
- 字段类型是客户端应提交的类型；明确标注“转换/模型限制/未统一校验”之处，不能理解为入口已严格拒绝其他类型。未列出的字段不保证处理，当前没有全局拒未知字段机制。
- 普通成功返回 HTTP 200；表内 `201` 表示实际创建状态。表内响应均指 `data`，特殊流/重定向/健康检查除外。

## 2. 通用约定与权限

### 2.1 数据格式

JSON 请求使用 `Content-Type: application/json`，JSON body 限制 5mb。也有 urlencoded 解析兼容，但新消费者应使用 JSON。字段以 camelCase 为主，保留 `_id`、第三方极验 snake_case 和既有业务名称，不重命名接口。

| 参数类型 | 定义与当前行为 |
| --- | --- |
| P id/channelId/conversationId/messageId/krId/qrId | 必填字符串，分别为资源/渠道/会话/消息/关键词/快捷回复 ObjectId；客户端传24位十六进制。多数旧接口仍依赖 Mongoose cast，错误 ID 不保证统一400，不能只靠格式代替资源范围鉴权。 |
| P token | 必填非空渠道 publicToken 字符串，不是 JWT，也不是 ObjectId；轮换后旧链接失效。当前无统一入口长度上限。 |
| H Authorization | 受保护接口必填 `Bearer <JWT>`；token由登录/切换接口取得。禁止把真实 token 写入文档、日志或URL。 |
| 日期 | JSON 输出为 ISO 8601 时间字符串，数据库按 UTC 存储；未发生时间字段可能为 null 或缺失。筛选日期的特殊含义见各端点。 |
| 数字/布尔 | JSON应传 number/boolean，不传数字数组或对象。部分旧接口通过 Number、parseInt、Mongoose或validator转换；具体例外见下文。 |
| 空值/PATCH | 缺省通常保留，不代表 null 可清空；仅明确支持的空字符串可清空。PATCH并非统一JSON Merge Patch。PUT settings实际部分合并；PUT版本省略项可能重置，见版本DTO。 |
| 未知字段 | 当前多为忽略或不参与赋值，本次未添加全局拒绝规则。tenantId/senderId/role等身份和消息归属取自认证与资源，不由消息body指定。 |

### 2.2 身份矩阵

| 标记 | 身份 | 范围 |
| --- | --- | --- |
| 公 | 无需登录 | 公开认证、网站设置、APP信息、渠道公开信息；仍可能受开关、验证码、限流限制。 |
| A | 平台管理员 super/operator | 数据库回查 active 和最新role；operator仅业务读取及本人资料修改。 |
| S | 平台 super | 所有平台敏感写操作、设置、导出与清理。 |
| T | 租户 owner/admin/agent | HTTP回查用户active、租户active/trial；所有业务带tenantId。 |
| TA | 租户 owner/admin | 员工管理、创建删除渠道、Token轮换、分配员工。 |
| O | 租户 owner | 邮箱和密码安全修改，发相应用途验证码；角色限制在控制器执行。 |
| TC | 租户有权访问渠道/会话 | owner/admin在本租户；agent必须在Channel.agentIds；会话waiting可预览，active/closed通常还须本人接待。写控制操作要求本人接待（管理员例外）。 |
| C | 客户JWT | 可为纯全局账号、正式渠道绑定或guest；具体业务能力由后续标记限定。 |
| CB | 客户当前渠道上下文 | 必须具备有效Customer绑定/tenantId/channelId，绑定状态有效；会话必须属于本人。支持guest聊天，不代表guest可改资料或投诉。 |
| CR | 正式客户账号 | 不支持guest；QQ接口当前还需要渠道绑定。 |
| CC | 正式客户完整投诉上下文 | 有accountId、绑定、tenantId、channelId、conversationId且核对一致；当前投诉控制器要求租户active（trial差异待统一）。 |
| Any | A/T/CB | 私有附件还需对应会话权限，不是有JWT即可读取任意文件。 |

`CustomerAccount._id` 是全平台账号ID；`Customer._id` 是账号与渠道的绑定ID，保存 blocked/messageReceivingDisabled。纯账号登录token只有accountId；进入渠道后token的id是绑定ID，另有accountId、tenantId、channelId、conversationId。响应customer在渠道session中 `_id` 也切换为绑定ID，保留accountId/bindingId。不能将二者互换。guest没有全局账号，不能冒用手机号接管旧客户。

管理员登录**不接验证码中间件**。租户与客户登录、注册及客户投诉按系统captcha配置验证；guest入口不使用验证码。忘记密码、发邮箱码不自动要求图形验证码。管理员失败5次锁定15分钟。部分认证URL共享60秒20次限流；邮箱发送另有通常60秒间隔、10分钟有效、一次消费规则，不要假设所有API使用同一限流器。

### 2.3 响应与错误

```json
{"code":0,"message":"success","data":{"items":[],"total":0,"page":1,"limit":20},"requestId":"example-request-id"}
```

通用错误：`{code,message,data:null,requestId}`。`code` 是业务码，**不等于HTTP状态**；`error()`默认仅当code是400–599整数才采用同值HTTP，否则默认400。常见4001参数错误、4004验证码错误、401认证失败、403/4031权限不足、404/4041资源不存在、409/4091冲突、4101附件不可用、4290频率限制、5001业务服务失败、5031邮件不可用、5032验证码服务不可用；同一个业务码在不同控制器的message可以不同，客户端不要仅按业务码判断语义。

既有express-validator错误为 HTTP400 `{code:4001,message:"参数校验失败",data:[{field,message}]}`，当前**不带requestId**、不回显输入值。新消息入口错误使用通用error结构，带requestId。全局404与500为 `{code,message,requestId}`，不带data；生产隐藏内部错误信息。限流也可能只有code/message。客户端应兼容这些差异，不能假设所有错误都有data或requestId。

健康检查、文件流、Range416、数据导出、302下载不使用标准成功包装。HTTP错误应检查状态后再解析适当的JSON或文本；三个前端Axios默认将成功返回解包到response.data。

## 3. 公共请求DTO与返回DTO

### 3.1 身份、安全字段

以下DTO用于端点表的B参数引用，已列明每个字段：

| 请求DTO | 字段、类型、必填及规则 |
| --- | --- |
| CaptchaInput | 配置disabled：无字段；image：captchaId! string（创建响应ID）、captchaCode! string（图中文字，大小写无关，一次消费）；geetest：geetest_challenge! string≤128、geetest_validate! string≤512、geetest_seccode! string≤512。当前验证码中间件对这些值有String转换，图形验证码失败也消费。 |
| TenantRegister | name! string非空，模型≤100；username! string≥3、模型≤50且唯一（owner displayName模型≤50，长企业名兼容问题未统一）；email! string邮件；password! string6–72；confirmPassword! string等于password；emailCode! 6位数字字符串（现路由和前端始终必填，即使配置关闭；控制器仅配置开启时核实邮件码）；加CaptchaInput。无服务端agreementAccepted字段。 |
| CustomerLogin | identifier! string手机号或邮箱；手机号原始格式 `[\d\s+-]{6,20}`；password! 非空字符串，无新设登录密码上限；fingerprint? string，无统一上限；加CaptchaInput。 |
| CustomerRegister | phone! string满足上述手机号格式；qq! string满足 `[1-9]\d{4,11}`；email! string邮件；password! string6–72；confirmPassword! string等于password；emailCode! 6位数字字符串；fingerprint? string；agreementAccepted! boolean且严格true；加CaptchaInput。phone去空格和横杠，邮箱归一化，手机号/非空邮箱全局唯一。 |
| EmailOnly | email! string有效邮件，validator normalizeEmail；无其他业务字段。 |
| Reset | email! string邮件；emailCode! 6位数字字符串；newPassword! string6–72；confirmPassword! 等于newPassword。客户Reset额外phone! 手机号字符串。 |
| ChangePassword | currentPassword! 非空string；emailCode! 6位数字字符串；newPassword! string6–72，不能与当前相同；confirmPassword! 等于newPassword。 |
| EmployeeCreate | username! string trim3–50；displayName! string trim1–50；password! string6–72；role? admin/agent默认agent；status? active/disabled默认active；avatarUrl? string（创建validator接受，但控制器未保存，不应依赖）。 |
| EmployeePatch | username? string trim3–50；displayName? string trim1–50；role? admin/agent；status? active/disabled；avatarUrl? string，可空；不支持修改owner，不使用password字段改密。 |

### 3.2 内容与消息

| 请求DTO | 字段、规则 |
| --- | --- |
| AnnouncementWrite | title! string trim非空≤200；content! string trim非空，无业务长度上限（仍受body限制）；status? draft/published，创建默认draft、更新省略保留；appType? staff/customer，APP公告创建默认staff；租户公告不应依赖appType筛选。PUT仍要求title/content。 |
| VersionWrite | versionCode! 正整数≥1（validator接受整数文本并toInt，尚未统一safe integer）；versionName! string trim1–50；downloadUrl! 完整http/https URL；releaseNotes? string或null，默认空；forceUpdate? boolean默认false；downloadEnabled? boolean默认true；minSupportedVersionCode? 整数≥1默认1；status? draft/published默认draft（更新省略保留）；appType? staff/customer可通过validator，但版本实际归属由路由指定。PUT省略releaseNotes/forceUpdate/downloadEnabled/minSupportedVersionCode会重置为上述默认值，不是部分PATCH。 |
| ChannelCreate | name! trim非空string≤50；brandName? string≤50默认在线客服；brandColor? string默认#2563eb（未校验CSS颜色格式）；welcomeMessage? string≤500，默认“您好，欢迎咨询，请问有什么可以帮助您？”。 |
| ChannelPatch | 所有字段可选；TC可更新brandName string≤50、brandColor string、avatarUrl string、welcomeMessage string≤500、welcomeImageUrl string、welcomeImageName string≤255、offlineMessage string≤500；TA额外name string非空≤50、assignmentMode manual/round_robin/least_load、status online/offline。长度和枚举主要由模型save约束，不保证入口400；URL没有统一格式校验。默认保留，空字符串可用于清除图片/欢迎内容。assignmentMode存储不表示已实现自动派单。 |
| KeywordWrite | keyword! string trim1–100（PATCH可选）；matchType? exact/contains默认contains；replyContent? string≤500默认空；imageUrl? string默认空；imageName? string≤255默认空；priority? number默认0；status? active/disabled默认active。正文与图片合并后至少一个非空。PATCH priority要求安全整数且允许负数；CREATE尚依赖模型数字转换，不宣称完全同规范。CREATE正文/imageName兼容null，PATCH不接受null。 |
| QuickWrite | title! string trim1–50（PATCH可选）；content? string≤500默认空；imageUrl? string默认空；imageName? string≤255默认空；sortOrder? number默认0；status? active/disabled默认active。正文与图片至少一个非空。PATCH sortOrder要求安全整数且允许负数；CREATE仍模型转换。CREATE正文/imageName兼容null，PATCH不接受null。 |
| MessageWrite | clientMessageId! string trim1–128；content? string，text时trim后非空；messageType? string，image/video/file按媒体处理，省略或其他字符串兼容回落text；attachmentId? 24位十六进制string，媒体必填；attachmentUrl/attachmentName/thumbnailUrl? string，旧兼容字段，不能代替媒体attachmentId，不作为私有附件可信来源。未设置正文业务长度上限。新入口拒绝上述字段的null、数组、对象和非字符串；未知字段不全局拒绝。 |

### 3.3 核心返回结构

除明确说明外，模型对象通常带 `_id`、createdAt、updatedAt，ID序列化为字符串；关联字段可能是ID或选定字段的populate对象。

| DTO | 核心字段与类型 |
| --- | --- |
| Page<T> | items:T[]、total:number、page:number、limit:number。数组接口不包装Page。 |
| Admin | _id、username、email、avatarUrl:string；role super/operator；status active/disabled；lastLoginAt/date。无password/loginAttempts/lockedUntil。 |
| Tenant | _id/name/username/email/qq:string；status active/disabled/trial；plan:{agentLimit,channelLimit,messageRetentionDays,attachmentLimitMB}:number；expiresAt/lastLoginAt/date；无password。plan默认10/5/90/1024。 |
| TenantUser | _id/tenantId/username/displayName/avatarUrl:string；role owner/admin/agent；status active/disabled；lastLoginAt/date；无password。 |
| Customer | _id/accountId/bindingId（后两项视上下文）、phone/email/qq/nickname/avatarUrl:string；status；渠道上下文有tenantId/channelId/blocked/messageReceivingDisabled；guest有identityType:guest，公开DTO不提供phone/email/qq。不同列表/会话详情有不同隐私字段投影，不能当成统一可写实体；password和指纹hash不应返回。 |
| Channel | _id/tenantId/publicToken/name/brandName/brandColor/avatarUrl/welcomeMessage/welcomeImageUrl/welcomeImageName/offlineMessage:string；assignmentMode；agentIds:ID[]；status online/offline；link（后台列表/详情/轮换）。详情employees为{id,username,displayName}[]。 |
| Conversation | _id/tenantId/channelId/customerId；assignedAgentId:ID或null；status waiting/active/closed；acceptedAt/closedAt/lastMessageAt；agentUnreadCount/customerUnreadCount:number。列表/详情可补customer/channel/agent/lastMessage/searchMatch；客户端详情agent:{id,name}或null。 |
| Message | _id/tenantId/conversationId；senderType customer/agent/system/bot；senderId ID或populate对象；messageType text/image/video/file/system；content:string；clientMessageId可缺失（系统/机器人）；attachmentId可null；attachmentUrl/attachmentName/thumbnailUrl:string；attachmentStatus none/active/expired/recalled/deleted；attachmentExpiredAt/date或null；recalledAt/deletedForAgentAt/deletedForCustomerAt/date或null；readByAgent/readByCustomer:boolean；autoReplyType keyword/welcome/offline或null。私有URL仅active时生成。 |
| Announcement | _id/title/content；audience tenant/app；appType staff/customer；status draft/published；publishedAt/date或null；key可选系统公告标识，系统公告不可删除。 |
| AppVersion | _id/platform:android/appType/versionCode/versionName/downloadUrl/releaseNotes/forceUpdate/downloadEnabled/minSupportedVersionCode/status/publishedAt。公开更新DTO不保证含全部管理元数据，禁下载时downloadUrl为空。 |
| Keyword/Quick | 对应写DTO字段，加_id/tenantId/channelId；Quick的channelId可能null（租户通用），可有createdBy。 |
| Captcha | disabled:{enabled:false}；image:{enabled:true,provider:image,captchaId,image:dataSVG}；geetest:{enabled:true,provider:geetest,version:3,gt,challenge,success:0或1,new_captcha,captchaId:gt}。不返回验证码答案或极验Key。 |
| AccountSession | token:string、isNew:boolean、profileRequired:boolean、customer:Customer；纯全局账号token。 |
| ChannelSession | token、isNew、profileRequired、customer、channel（品牌公开子集）、conversation:{id,status}。guest以restored:boolean代替isNew，profileRequired:false。 |
| HistoryChannel | _id（渠道ID）、bindingId、publicToken、name、brandName、brandColor、avatarUrl、status、current:boolean、conversationId、lastMessage:Message或null、lastMessageAt、unreadCount:number。 |
| Complaint | _id/conversationId；tenantSnapshot:{id,name}、agentSnapshot:{id,displayName,username}、channelSnapshot:{id,name,brandName}、customerSnapshot:{id,accountId,phone,email,qq,nickname}；category platform/agent；subject/content；images:string[]；status pending/processing/resolved；时间戳。管理列表去掉submittedIp/userAgent，详情可含这两项。 |
| AuditLog | _id/type(login或operation)/tenantId/userId/username/displayName/role/action/detail/ip/userAgent/result(success或failure)/createdAt/updatedAt。agent仅本人，TA全租户。 |
| SystemVersion | version、edition、releasedAt:string；changelog:[{version,releasedAt,title,changes:string[]}]。 |

## 4. 分页与游标

| 使用位置 | Q规则（全部可选） |
| --- | --- |
| 管理租户列表、租户会话列表 | page默认1、limit默认20；当前parseInt或默认值，**没有统一下界和上限**。建议消费者只发正整数和小批量，不将建议当服务端已限制。 |
| 管理客户、管理会话 | page默认1最小1；limit默认20，截断1–100。 |
| 管理公告、APP公告/版本、投诉 | page默认1最小1；limit默认10，截断1–100。 |
| 租户公告、公开APP公告 | page默认1最小1；limit默认20，截断1–100。 |
| 租户日志 | page默认1最小1；limit默认20，截断1–50。 |
| 管理/租户消息历史 | limit默认50，上限200；管理支持before/around，租户支持before/after/around。 |
| 客户消息历史 | limit默认50，上限50；支持before/after，不支持around。 |

前三类旧列表解析仍有parseInt宽松行为（如尾随非数字、数组等未统一拒绝）。**本次只规范三种消息历史入口**：limit若出现须为十进制正安全整数查询字符串，超过现有业务上限仍截断；0、负数、小数、尾随垃圾、重复数组拒绝4001。before/after/around最多一个；出现但为空或不是24位十六进制拒绝；不支持的模式拒绝，而不是静默忽略。

消息游标是Message._id，不是时间戳，必须属于当前租户/会话。排序依据 `(createdAt,_id)`：before取更早，after取更晚，around包含目标及两侧；输出均时间升序。around limit=1仅目标，禁止数据库limit(0)导致无上限。删除/清理导致目标不存在时返回错误，应清除失效游标重新拉取。普通before/after以目标的排序值建立边界，不要求ID大小与时间一致。消息读取可能改变已读状态；客服waiting预览只有管理员或实际接待者可标客服已读，客户读取会标客服/机器人消息已读。

## 5. HTTP完整清单

下列每一行是一个实际路由。P参数按2.1统一定义；鉴权标记按2.2；B引用DTO包含3.1/3.2所有字段，Q分页引用第4节对应行。无业务参数的写接口无需人为添加空body。

### 5.1 健康与管理员认证、租户、客户、会话

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/health | 公 | 无 | 非包装{ok:boolean,env,services:{mongo,redis},degraded}；Mongo正常200，否则503；redis up/down/disabled。 |
| POST /api/admin/auth/login | 公 | B username!非空string、password!string≥6；免验证码 | {token,admin:Admin} |
| POST /api/admin/auth/logout | A | 无 | null；仅客户端清token，非服务端撤销JWT |
| GET /api/admin/auth/me | A | 无 | Admin |
| PATCH /api/admin/auth/profile | A | B username?string trim3–50、email?邮件string、avatarUrl?string可空；newPassword?6–72、currentPassword?新密码有值时必填正确；密码当前有String转换 | {token,admin}，重新保存token |
| GET /api/admin/dashboard | A | 无 | {tenantCount,activeTenants,agentCount,customerCount}:number |
| GET /api/admin/tenants | A | Q page/limit租户列表分页；status?string直接过滤（模型active/disabled/trial）；keyword?string搜索名称/用户名/邮箱，无入口长度上限 | Page<Tenant> |
| GET /api/admin/tenants/:id | A | P id | Tenant+agentCount |
| PATCH /api/admin/tenants/:id | S | P id；B name?trim1–100、username?trim3–50唯一、email?有效且唯一、qq?空或QQ格式、password?严格string6–72、status?active/disabled/trial；前三字段有String转换 | Tenant，同步owner用户名/资料/密码 |
| PATCH /api/admin/tenants/:id/status | S | P id；B status active/disabled/trial；当前省略会成为无操作更新，消费者应必传 | Tenant；禁用断开租户Socket |
| PATCH /api/admin/tenants/:id/plan | S | P id；B agentLimit/channelLimit/messageRetentionDays/attachmentLimitMB均?非负安全整数number；允许0，不设额外商业上限 | Tenant；只更新提交的plan字段 |
| GET /api/admin/customers | A | Q page/limit客户列表分页；status?active/disabled，非法拒绝；keyword?string搜索 | Page<Customer>（全局账号） |
| PATCH /api/admin/customers/:id | S | P id=accountId；B phone?手机号string、email?有效邮件string、qq?合法QQ或空、nickname?string trim1–50、password?string6–72、status?active/disabled | Customer，全局账号变更同步绑定 |
| PATCH /api/admin/customers/:id/status | S | P id=accountId；B status应必传active/disabled，现省略可能无操作 | Customer；禁用断开账号房间 |
| GET /api/admin/conversations | A | Q page/limit管理会话分页；status?waiting/active/closed；tenantId/channelId?ObjectId；keyword?string trim截100；startDate/endDate?YYYY-MM-DD | Page<Conversation>+filters:{tenants,channels}；含租户/渠道/客户/接待者/搜索命中 |
| GET /api/admin/conversations/:id/messages/search | A | P id；Q keyword?string trim截100，空返回空 | {items:Message[],total}，最多200条 |
| GET /api/admin/conversations/:id/messages | A | P id；Q before或around?ObjectId、limit?正整数，默认50最多200 | Message[]；游标规则见4 |

管理员会话日期按UTC的起始日0点及结束日加一天过滤，范围为 `[startDate,endDate+1day)`；当前只校验格式和Date有效性，未严格拒绝所有日历溢出日期，不将“YYYY-MM-DD”描述成完整日历合法性验证。

### 5.2 管理公告、APP版本、投诉与运维

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/admin/announcements | A | Q page/limit默认10上限100；status?draft/published非法忽略；keyword?string | Page<Announcement> |
| POST /api/admin/announcements | S | B AnnouncementWrite | 201 Announcement |
| PUT /api/admin/announcements/:id | S | P id；B AnnouncementWrite | Announcement |
| PATCH /api/admin/announcements/:id/status | S | P id；B status!draft/published | Announcement |
| DELETE /api/admin/announcements/:id | S | P id | null；系统key公告禁止删除 |
| GET /api/admin/app/announcements | A | Q page/limit默认10上限100；appType?staff/customer默认staff；status?draft/published；无keyword搜索契约 | Page<Announcement> |
| POST /api/admin/app/announcements | S | B AnnouncementWrite | 201 Announcement，audience=app |
| PUT /api/admin/app/announcements/:id | S | P id；B AnnouncementWrite | Announcement |
| PATCH /api/admin/app/announcements/:id/status | S | P id；B status!draft/published | Announcement |
| DELETE /api/admin/app/announcements/:id | S | P id | null |
| GET /api/admin/app/android/versions | A | Q page/limit默认10上限100；status?draft/published | Page<AppVersion>，staff |
| POST /api/admin/app/android/versions | S | B VersionWrite | 201 AppVersion，staff |
| PUT /api/admin/app/android/versions/:id | S | P id；B VersionWrite | AppVersion，staff |
| PATCH /api/admin/app/android/versions/:id/status | S | P id；B status!draft/published | AppVersion |
| DELETE /api/admin/app/android/versions/:id | S | P id | null |
| GET /api/admin/app/customer-center/android/versions | A | Q page/limit默认10上限100；status?draft/published | Page<AppVersion>，customer |
| POST /api/admin/app/customer-center/android/versions | S | B VersionWrite | 201 AppVersion，customer |
| PUT /api/admin/app/customer-center/android/versions/:id | S | P id；B VersionWrite | AppVersion，customer |
| PATCH /api/admin/app/customer-center/android/versions/:id/status | S | P id；B status!draft/published | AppVersion |
| DELETE /api/admin/app/customer-center/android/versions/:id | S | P id | null |
| GET /api/admin/complaints | A | Q page/limit默认10上限100；status?pending/processing/resolved；category?platform/agent（非法枚举忽略）；keyword?string | Page<Complaint> |
| GET /api/admin/complaints/:id | A | P id | Complaint完整快照 |
| PATCH /api/admin/complaints/:id/status | S | P id；B status!pending/processing/resolved | Complaint |
| GET /api/admin/version | A | 无 | SystemVersion |
| GET /api/admin/settings | S | 无 | Settings（见6；密钥脱敏） |
| PUT /api/admin/settings | S | B SettingsPatch（6节全部字段可选） | Settings（脱敏），部分合并 |
| POST /api/admin/settings/test-email | S | B to!有效邮件string | null/成功提示；使用已保存SMTP，不接受临时SMTP配置 |
| POST /api/admin/storage/conversation-files/estimate | S | 无 | {generatedAt,totals:[{_id:status,count,bytes}],due:{count,bytes}}，聚合due可能含_id:null |
| POST /api/admin/storage/conversation-files/cleanup | S | B limit?Number可转换整数1–100，默认storage.cleanupBatchSize | {taskId,startedAt,finishedAt,scanned,deleted,failed,releasedBytes,errors:[{attachmentId,error}]}；已有任务时{running:true,message} |
| GET /api/admin/storage/conversation-files/status | S | 无 | {running,isRunning,scheduled,intervalMs:3600000,lastRun:清理结果或null} |
| GET /api/admin/data/overview | A | 无 | {tenantCount,activeTenants,agentCount,customerAccountCount,customerCount,channelCount,conversationCount,messageCount,loginLogCount,operationLogCount,attachmentCount,attachmentBytes,attachments}；计数/字节为number，attachments按状态映射{count,bytes} |
| POST /api/admin/data/cleanup | S | B before!可被Date解析的日期；types!数组，至少一个login_logs/operation_logs/conversations；非法数组项被过滤 | {loginLogs,operationLogs,conversations,messages,attachmentsMarked}:number |
| GET /api/admin/data/export | S | Q type?tenants/customers/conversations默认tenants；format?csv/json默认csv | 非包装下载：中文列名数组JSON或带BOM的CSV；会话最多50000 |

清理是破坏性操作：日志createdAt<before；仅closed且lastMessageAt<before的会话，物理删除其消息/会话，附件标deleting后清理；不得把测试调用当作只读查询。需要恢复只能依赖事前数据库/文件备份。附件清理删除文件不能通过回滚代码恢复。本次未调用这些写接口。

### 5.3 租户认证与资料

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/tenant/public-settings | 公 | 无 | PublicSettings（6节） |
| GET /api/tenant/auth/captcha | 公 | 无 | Captcha |
| POST /api/tenant/auth/register-code | 公 | B EmailOnly | null/提示；受注册与邮件配置影响 |
| POST /api/tenant/auth/register | 公 | B TenantRegister | {tenant:Tenant,owner:TenantUser}，不是登录token |
| POST /api/tenant/auth/login | 公 | B username!非空string、password!非空string、tenant?租户用户名或ID string≤100（falsy跳过）；CaptchaInput | {token,tenant,user}；员工用户名重名而未指定租户4092/409 |
| POST /api/tenant/auth/forgot-password/code | 公 | B EmailOnly | null；隐藏邮箱是否存在 |
| POST /api/tenant/auth/forgot-password/reset | 公 | B Reset | null；同时更新tenant和owner密码 |
| GET /api/tenant/auth/me | T | 无 | {user,tenant} |
| POST /api/tenant/auth/logout | T | 无 | null；客户端清token，无JWT撤销表 |
| PATCH /api/tenant/auth/profile | T | B displayName?string trim1–50、avatarUrl?string可空、qq?空或QQ格式（仅owner可改） | {token,user,tenant} |
| POST /api/tenant/auth/profile/email-code | O | B purpose!change-email/change-password；email?change-email时必填有效邮件 | null；change-password发至已有邮箱 |
| PATCH /api/tenant/auth/profile/email | O | B email!邮件string、emailCode!6位数字string | Tenant；不返回新token |
| PATCH /api/tenant/auth/profile/password | O | B ChangePassword | null；断开owner Socket，需重新登录 |
| GET /api/tenant/logs/login | T | Q page/limit默认20上限50 | Page<AuditLog> |
| GET /api/tenant/logs/operation | T | Q page/limit默认20上限50 | Page<AuditLog> |
| GET /api/tenant/announcements | T | Q page/limit默认20上限100 | Page<Announcement>，只已发布且publishedAt≤now |
| GET /api/tenant/announcements/:id | T | P id | Announcement，未发布不可见 |

### 5.4 员工、渠道与自动回复

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/tenant/employees | TA | 无 | TenantUser[]，无分页 |
| POST /api/tenant/employees | TA | B EmployeeCreate | TenantUser；受plan.agentLimit限制 |
| PATCH /api/tenant/employees/:id | TA | P id；B EmployeePatch | TenantUser |
| DELETE /api/tenant/employees/:id | TA | P id，不能删除owner/当前账号 | null；释放渠道和接待会话，断开连接 |
| POST /api/tenant/employees/:id/reset-password | TA | P id；B password!string6–72；不可重置owner | null；断开员工Socket |
| POST /api/tenant/employees/:id/login | TA | P id（必须本租户active agent） | {token,user,tenant}，代登录身份 |
| GET /api/tenant/channels | T | 无 | Channel[]，agent只授权渠道，无分页 |
| POST /api/tenant/channels | TA | B ChannelCreate | Channel；受plan.channelLimit限制 |
| GET /api/tenant/channels/:id | TC | P id | Channel+link+employees |
| PATCH /api/tenant/channels/:id | TC | P id；B ChannelPatch | Channel |
| DELETE /api/tenant/channels/:id | TA | P id | null；清回复配置与缓存，撤销相关Socket订阅 |
| POST /api/tenant/channels/:id/rotate-token | TA | P id，无B | Channel+link；旧公开Token失效 |
| PUT /api/tenant/channels/:id/employees | TA | P id；B employeeIds!ID[]，空数组清空；元素当前无统一入口ObjectId校验 | Channel；仅保留当前租户active员工，忽略不匹配项 |
| GET /api/tenant/channels/:channelId/keywords | TC | P channelId | Keyword[]，无分页 |
| POST /api/tenant/channels/:channelId/keywords | TC | P channelId；B KeywordWrite（创建） | Keyword |
| PATCH /api/tenant/channels/:channelId/keywords/:krId | TC | P channelId/krId；B KeywordWrite（PATCH全可选） | Keyword |
| DELETE /api/tenant/channels/:channelId/keywords/:krId | TC | P channelId/krId | null |
| GET /api/tenant/channels/:channelId/quick-replies | TC | P channelId | Quick[]，含channelId:null租户通用项，无分页 |
| POST /api/tenant/channels/:channelId/quick-replies | TC | P channelId；B QuickWrite（创建） | Quick |
| PATCH /api/tenant/channels/:channelId/quick-replies/:qrId | TC | P channelId/qrId；B QuickWrite（PATCH全可选） | Quick |
| DELETE /api/tenant/channels/:channelId/quick-replies/:qrId | TC | P channelId/qrId | null |

### 5.5 租户会话与消息

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/tenant/conversations | T | Q page/limit默认1/20未统一上限；status?模型waiting/active/closed但入口直接过滤；channelId?ID；keyword?string trim截100；unread?字符串'1'改变未读排序，其他值不启用 | Page<Conversation>，权限范围自动过滤 |
| GET /api/tenant/conversations/:id | TC | P id | Conversation+customer/channel/agent等详情 |
| POST /api/tenant/conversations/:id/accept | TC | P id，无B | Conversation；waiting条件原子接入，竞争失败不抢占已有坐席 |
| GET /api/tenant/conversations/:id/messages/search | TC | P id；Q keyword?string trim截100，空返回空 | {items:Message[],total}，最多200 |
| GET /api/tenant/conversations/:id/messages | TC | P id；Q before/after/around最多一个、limit?默认50最多200 | Message[] |
| POST /api/tenant/conversations/:conversationId/attachments | TC | P conversationId；F file!单文件，见7 | PendingAttachment |
| POST /api/tenant/conversations/:id/messages | TC | P id；B MessageWrite；会话须active | Message |
| PATCH /api/tenant/conversations/:id/customer-settings | TC（可修改会话） | P id；B blocked?boolean、messageReceivingDisabled?boolean；错误类型当前忽略 | {blocked,messageReceivingDisabled}；仅绑定级状态 |
| DELETE /api/tenant/conversations/:id/messages | TC（可修改会话） | P id，无B | {conversationId}；客服侧全部软删除，不是物理清理 |
| POST /api/tenant/conversations/:id/messages/:messageId/recall | TC（可修改会话） | P id/messageId，无B；仅本人消息且2分钟内 | Message（已撤回） |
| DELETE /api/tenant/conversations/:id/messages/:messageId | TC（可修改会话） | P id/messageId，无B；system禁止单条删除 | {messageId,conversationId,side:agent}；重复删除可省side |
| POST /api/tenant/conversations/:id/close | TC（可修改会话） | P id，无B | Conversation；重复关闭成功，不支持任意status body |

### 5.6 客户认证、历史渠道与资料

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/client/public-settings | 公 | 无 | PublicSettings |
| GET /api/client/auth/captcha | 公 | 无 | Captcha |
| POST /api/client/auth/login | 公 | B CustomerLogin | AccountSession |
| POST /api/client/auth/register-code | 公 | B EmailOnly | null/提示 |
| POST /api/client/auth/register | 公 | B CustomerRegister | AccountSession |
| POST /api/client/auth/forgot-password/code | 公 | B phone!手机号string、email!邮件string | null；隐藏手机号邮箱是否匹配 |
| POST /api/client/auth/forgot-password/reset | 公 | B 客户Reset（含phone） | null；账号和历史绑定密码同步 |
| GET /api/client/channels/history | C | 无 | HistoryChannel[]，guest无全局历史，返回空数组 |
| POST /api/client/channels/:token/switch | CR | P token；B password?string，旧绑定凭据不一致时用于证明；正常无需body | {token}；之后用新token拉me和conversation |
| GET /api/client/channels/:token/captcha | 公 | P token（此handler只创建验证码，不据此返回渠道详情） | Captcha |
| GET /api/client/channels/:token | 公 | P token | {id,name,brandName,brandColor,avatarUrl,welcomeMessage,offlineMessage,status,agentIds,agentOnline} |
| POST /api/client/channels/:token/auth/guest | 公 | P token；B fingerprint!string trim8–500；无验证码 | guest ChannelSession；同指纹恢复绑定，不是账号身份证明 |
| POST /api/client/channels/:token/auth/login | 公 | P token；B CustomerLogin；H Authorization?旧guest JWT用于绑定（非必需） | ChannelSession；历史账号已有对话与guest绑定冲突4091 |
| POST /api/client/channels/:token/auth/register-code | 公 | P token；B EmailOnly | null/提示，验证公开渠道有效性 |
| POST /api/client/channels/:token/auth/register | 公 | P token；B CustomerRegister；H Authorization?旧guest JWT用于绑定 | ChannelSession |
| GET /api/client/me | C | 无 | Customer，纯账号与绑定DTO中_id语义不同 |
| POST /api/client/profile/qq | CR且有绑定 | B qq!合法QQ string | Customer；同步全局账号与所有绑定 |
| POST /api/client/profile/password-code | CR | 无B | null，发至已有邮箱 |
| POST /api/client/profile/password | CR | B ChangePassword | null；要求重新登录 |

### 5.7 客户会话与投诉

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/client/conversation | CB | 无 | Conversation或null |
| GET /api/client/conversation/messages | CB | Q before/after最多一个；limit?默认50最多50 | Message[]，无会话为空 |
| POST /api/client/conversation/attachments | CB | F file!单文件，见7 | PendingAttachment，必要时建立waiting会话 |
| POST /api/client/conversation/messages | CB | B MessageWrite；blocked/messageReceivingDisabled拒绝发消息 | {message:Message,botReply:Message或null} |
| POST /api/client/conversation/messages/:messageId/recall | CB | P messageId；仅本人、2分钟内，system/bot不可撤回 | Message |
| DELETE /api/client/conversation/messages/:messageId | CB | P messageId；system不可删，bot可单侧删 | {messageId,conversationId,side:customer}；重复可能省side |
| GET /api/client/complaints/captcha | C | 无 | Captcha |
| POST /api/client/complaints/email-code | CC | 无B，使用当前账号邮箱 | null/提示 |
| POST /api/client/complaints | CC | B category!platform/agent；subject!trim1–100 string；content!trim1–5000 string；images?/imageSignatures?string[]默认空，≤5且等长；emailCode!6位数字string；CaptchaInput | 201 {id,status:pending}；agent类别需接待客服 |

投诉图片必须是投诉上传API返回的URL，并附同位置signature；签名绑定账号、租户、渠道、绑定和会话，不能用普通上传URL、外部URL或另一会话签名替换。

### 5.8 公开APP与文件

| 方法 路径 | 鉴权 | 参数 | 核心响应 |
| --- | --- | --- | --- |
| GET /api/app/announcements | 公 | Q page/limit默认20上限100 | Page<Announcement>，staff已发布公告 |
| GET /api/app/announcements/:id | 公 | P id | Announcement，staff且已发布 |
| GET /api/app/android/check-update | 公 | Q versionCode!正整数≥1；当前parseInt仍接受尾随文本，未统一安全整数 | {hasUpdate:boolean,version:公开AppVersion或null}，staff |
| GET /api/app/customer-center/announcements | 公 | Q page/limit默认20上限100 | Page<Announcement>，customer已发布公告 |
| GET /api/app/customer-center/announcements/:id | 公 | P id | Announcement，customer且已发布 |
| GET /api/app/customer-center/android/check-update | 公 | Q versionCode!正整数≥1，当前宽松parseInt | {hasUpdate,version}，customer |
| GET /api/app/customer-center/android/version | 公 | 无 | 公开AppVersion；无已发布版本404 |
| GET /api/app/customer-center/android/download | 公 | 无 | 302到最新已发布下载地址；禁下载403，无版本404 |
| POST /api/upload/admin/app-apk | S | F file! APK，≤200MiB，见7 | {url,thumbnailUrl:"",name,size,mimetype,isImage:false,isVideo:false} |
| POST /api/upload/admin/customer-app-apk | S | F file! APK，≤200MiB | 同上，客户APP存放区 |
| POST /api/upload/tenant/conversation/:conversationId | TC | P conversationId；F file! | PendingAttachment；租户私有上传别名 |
| POST /api/upload/admin | A | F file!普通上传，配置类型/大小 | PublicUpload |
| POST /api/upload/tenant | T | F file!普通上传，配置类型/大小 | PublicUpload |
| POST /api/upload/client | C | F file!普通上传，配置类型/大小 | PublicUpload |
| POST /api/upload/complaint | CC | F file!投诉图片，配置大小、图片类型交集 | {url,signature,name,size,mimetype,isImage:true} |
| POST /api/files/:id/playback | Any+附件权限 | P id=attachmentId；空JSON | {url,expiresAt:epoch毫秒}，HttpOnly短时Cookie；仅video，非访客须pv |
| GET /api/files/:id/playback/:nonce | 播放Cookie+实时权限 | P id/nonce；H Range? | 200/206视频流；授权过期401，失效410 |
| HEAD /api/files/:id/playback/:nonce | 播放Cookie+实时权限 | 同GET | 同GET响应头，无body |
| GET /api/files/:id/status | Any+附件权限 | P id=attachmentId | {attachmentId,status,expiresAt}；只可用active附件成功 |
| GET /api/files/:id/thumbnail | Any+附件权限 | P id=attachmentId；Range不作用于缩略图 | 文件流；无缩略图404，图片可回退原图 |
| GET /api/files/:id | Any+附件权限 | P id=attachmentId；H Range?单字节区间 | 200文件流或206部分内容，详见7 |

Express默认兼容尾斜杠；投诉路由源码相对路径为 `/`，清单规范写无尾斜杠。GET隐含HEAD及静态资源不另计业务路由。`/uploads/*`（非conversations）为公开静态资源，`/uploads/conversations/*`明确禁止访问；它们不是可用于绕过 `/api/files` 鉴权的API。

## 6. 系统设置完整嵌套参数

SettingsPatch以下字段**均为B可选**；未提交字段保留，嵌套对象部分合并。GET管理响应还可能带_id/createdAt/updatedAt；singletonKey不返回。以下范围区分模型限制与入口验证，不能把所有number都说成严格JSON整数。

| 字段 | 类型、默认值与范围 | 更新与返回行为 |
| --- | --- | --- |
| registerEnabled | boolean，true | 仅boolean才写；错误类型忽略 |
| tenantRegisterEmailVerificationEnabled | boolean，false | 仅boolean才写；路由/前端仍始终要求emailCode，待统一 |
| loginEnabled | boolean，true | 仅boolean才写；管理员登录不受该普通登录开关控制 |
| customerServiceDomain | string，空 | 空清除；缺协议补https；仅http/https origin，不可含用户信息、路径、query/hash |
| siteTitle | string，默认忆梦云客服，模型≤120 | String+trim，不可空 |
| siteKeywords | string，空，模型≤500 | String+trim，可空 |
| siteDescription | string，空，模型≤500 | String+trim，可空 |
| forbiddenWords | string[]，[] | 必须数组；项String+trim、去空、大小写去重；同步系统违禁词公告 |
| agreements.disclaimer | string，内置免责协议，≤20000 | 可空；更新后缓存失效，启动可补齐空协议 |
| agreements.terms | string，内置使用协议，≤20000 | 同上 |
| upload.allowedTypes | string[]，默认jpg/jpeg/png/gif/webp/pdf/docx/xlsx/zip/txt/mp3/wav/mp4/webm | 去点、小写、去重；不可空；允许全集另含ogg/mov；禁止其他扩展名 |
| upload.maxFileSizeMB | number，10，模型1–1024 | Number转换，不强制整数；实际字节=maxFileSizeMB×1024×1024 |
| storage.conversationAttachmentRetentionDays | integer，2，1–365 | 控制器验证整数，影响新激活附件有效期，不追溯改已有expiresAt |
| storage.pendingAttachmentHours | integer，24，1–168 | 控制器验证整数，影响新pending附件 |
| storage.cleanupBatchSize | integer，100，1–100 | 控制器验证整数 |
| captcha.enabled | boolean，false | 旧模型cast，未统一严格入口 |
| captcha.provider | image/geetest，image | 模型enum |
| captcha.imageLength | number，4，模型4–8 | 未统一整数校验 |
| captcha.expireSeconds | number，300，模型60–1800 | 未统一整数校验 |
| captcha.geetestId | string，空 | 管理可返回；极验V3公开gt使用此ID |
| captcha.geetestKey | string，空 | 只写；truthy才覆盖，空保留；GET改为geetestKeyConfigured:boolean |
| smtp.enabled | boolean，false | 旧模型cast |
| smtp.host | string，空 | 已保存配置供发送使用 |
| smtp.port | number，465，模型1–65535 | 未统一严格整数 |
| smtp.secure | boolean，true | 旧模型cast |
| smtp.username | string，空 | 管理设置字段，勿作为示例凭据 |
| smtp.password | string，空 | 只写；truthy才覆盖，空保留；GET改为passwordConfigured:boolean |
| smtp.fromName | string，空 | 发件名称 |
| smtp.fromEmail | string，空 | 配置字段，无统一入口邮箱验证保证 |

PublicSettings仅返回：`siteTitle/siteKeywords/siteDescription/tenantRegisterEmailVerificationEnabled/agreements:{disclaimer,terms}`。**不返回**SMTP、极验Key、完整captcha对象、upload对象、registerEnabled/loginEnabled。验证码具体模式应请求captcha接口；上传配置不能从PublicSettings猜测。

## 7. 上传、私有附件与Range

- 所有上传是 `multipart/form-data` 单个 `file` 字段。浏览器FormData由库自动生成boundary，不手工固定boundary。size响应单位为字节；配置MB实际按MiB计算。配置默认10MiB，上限1024MiB。APK固定200MiB，不随普通配置扩张。
- PublicUpload：`{url,thumbnailUrl,name,size,mimetype,isImage,isVideo}`。普通上传检查扩展名、MIME、大小；视频生成缩略图失败删除原文件。普通文件未全面魔数校验，不能宣称完成内容安全检测。
- 投诉只允许配置allowedTypes与jpg/jpeg/png/gif/webp的交集，同时MIME/魔数校验；响应signature必须与URL一起提交投诉。
- APK要求.apk与允许APK/八位字节流MIME，检查PK头；这不等于完整APK签名验证。上传后返回的实际下载URL可能使用服务端固定来源，外部消费者应使用响应URL而不是自行拼接。
- PendingAttachment：`{attachmentId,category:image|video|audio|file,name,size,mimeType,status:pending}`。会话上传有文件魔数检查（txt没有特殊头），同时核对会话权限。原文件名basename化、去CR/LF/引号并截255。
- 两阶段：先上传pending，再发送MessageWrite携attachmentId，服务端核实同tenant/channel/conversation/uploader和类型并激活；一个附件不能绑定多条消息。音频category=audio以messageType=file发送。媒体正文应空，URL/文件名由受控附件生成，不能用普通URL绕过。
- pending默认24小时；active默认2天（均由设置控制新附件）。读取时检查expiresAt，不必等定时物理删除才失效；撤回变为deleting、随后清理，消息保留recalled状态。过期/已撤回/本侧删除/无有效关联消息返回4101/410；权限不足4031/403，ID或文件不存在4041/404。
- 文件响应 `Cache-Control: private, no-store, max-age=0`、nosniff，inline UTF-8文件名；私有文件不能通过公开静态目录访问。前端通常带Bearer请求blob后生成对象URL，不应直接把JWT放下载query。
- 原文件支持单Range：`bytes=0-1023`、`bytes=1024-`、`bytes=-1024`。有效范围206并有Content-Range/Content-Length/Accept-Ranges；无Range200。多范围、非法/越界范围416，带`Content-Range: bytes */总字节数`，无标准JSON；不支持multipart byte ranges。缩略图不执行Range。

### 7.1 视频播放授权

- 三端视频以已鉴权POST换取最长300秒的播放授权（不超过登录有效期），只返回受限URL和expiresAt；登录JWT和播放票据均不放URL。票据由JWT密钥派生的独立密钥签名，HS256、aud=attachment-playback、purpose=video，绑定附件ID、随机nonce及主体上下文。普通Bearer鉴权不能接受此票据。
- HttpOnly、SameSite=Strict、host-only Cookie仅匹配每次预览独立路径，多标签页/多附件不覆盖；过期自动清除，不写应用存储或缓存。短期大量预览可能触发浏览器Cookie淘汰，表现为明确失败，可重新打开。HTTP同源可用；直接HTTPS或同Host HTTPS Origin签发Secure。HTTPS反代必须保留Host和Origin；不可信转发头不作为Secure依据。禁止在代理/APM日志记录Cookie/Set-Cookie。
- 每个GET/HEAD重新回查当前主体状态、pv、租户/客户渠道及原附件可见性、消息撤回/单侧删除/失效。非访客旧登录令牌缺pv需重新登录。沿用原授权角色边界，不扩大管理员/租户权限。
- 播放响应与授权响应no-store、no-referrer、nosniff。Express sendFile处理Range，包括开放/后缀、越界416；HEAD无body。非法或多段Range遵循Express行为（可能忽略返回200），不提供multipart承诺。
- 到期终止仍在发送的响应；前端停止视频并提示点击重新授权，无自动重试。关闭/切换/撤回中止签发请求、移除src、停止媒体和定时器，迟到响应不能覆盖新预览。浏览器暂停后台计时不影响后端拒绝过期请求。每次请求校验不等于已发出字节可被追回。
- 图片/缩略图继续鉴权blob和原下载功能；视频使用metadata preload、原生controls/playsinline和媒体事件状态。无attachmentId旧视频禁止直接URL预览，可走原下载兼容入口或重新上传。浏览器不支持的MIME/编码明确提示，不承诺所有MOV/WEBM编码均可播放。
- 仅新会话MP4上传使用FFmpeg stream copy +faststart（30秒超时），同受保护目录临时输出；成功替换后stat/checksum，超限或失败保留原文件并清理临时文件。无旧库迁移、全量转码或HLS。

## 8. 消息幂等、撤回、单侧删除

1. 客户端为每个逻辑发送生成稳定clientMessageId，HTTP超时重试必须复用，不能每次重试生成新的时间戳。服务端按会话、发送方类型、发送方ID、clientMessageId唯一索引防重；查询还限制tenantId。重复成功返回原消息，客户重复结果botReply:null，不重新触发机器人回复。
2. 私有附件的重复发送先查幂等消息，再尝试pending激活；相同ID不同内容也不会“更新原消息”。要发新内容必须新ID。
3. waiting→active接待、active→closed关闭；客户再次发送会将closed重开waiting并清接待信息；进入渠道session也可能重开既有关闭会话。系统/欢迎/离线/关键词消息持久化后广播。
4. 撤回只允许本人customer/agent消息，窗口120000毫秒；清正文、附件展示字段并更新摘要。system/bot不能撤回；重复撤回返回成功。
5. 单条删除只设置本侧deletedForAgentAt或deletedForCustomerAt，不影响对方记录，system禁止单条删除，bot允许单侧删除。客服清空接口是独立能力，会将客服侧所有消息（包含系统消息）软删除。不得将其与管理员物理data cleanup混用。
6. 客服文字命中系统违禁词时在保存、广播前拒绝。客服发送必须已接待active；客户blocked/messageReceivingDisabled时拒绝发送。身份、权限和附件失败不得由前端绕过。

## 9. Socket.IO协议

Socket.IO（不是裸WebSocket），默认同源连接；握手推荐 `auth:{token}`，兼容query.token但不建议URL携凭据。客户端传auth.type不是可信身份，服务器按JWT type和数据库鉴权。无token可建连接但无业务房间；坏token触发connect_error。没有客户端Socket发消息入口，写消息统一HTTP。

### 9.1 服务端加入的房间

| 房间 | 成员/用途 |
| --- | --- |
| admin | 平台管理员 |
| tenant-{tenantId} | owner/admin，租户业务事件 |
| channel-staff-{channelId} | 该渠道授权agent；waiting广播与配置/附件事件 |
| agent-{userId} | 租户用户个人；active/closed会话指向接待者 |
| customer-{绑定ID} | 当前客户/guest绑定消息 |
| channel-{channelId} | 当前客户渠道，渠道失效时断连 |
| customer-account-{accountId} | 正式客户全局账号，多渠道历史与通知 |
| presence-tenant-{tenantId} | 对应租户用户/客户在线状态 |

客户端不能随意指定room。会话广播通常给tenant房间，加waiting渠道坐席或非waiting接待者个人，以及该客户；单侧删除只发被删除一侧。不要把channel-staff理解成该渠道全部历史消息的无条件读取权限。

### 9.2 事件和payload

| 方向/事件 | payload/ack | 说明 |
| --- | --- | --- |
| S→C connected | {ok:true} | 应用层就绪，不等于历史补拉完成 |
| C→S ping | 无业务payload，callback函数；ack {pong:true} | 当前callback类型未完整防御，必须传函数 |
| C→S presence:query | {type:tenant_user或customer,userId:ID}, callback函数；ack {online:boolean} | 当前仅校验已认证及callback，未完整验证type/ID/查询范围，见遗留项 |
| S→C presence:changed | {type,userId,online:boolean} | admin或对应presence-tenant房间；约30秒touch，多连接计数 |
| S→C message.new | Message；全局客户账号通知另可含publicToken/channelToken | 持久化后广播；可能同时经绑定/账号房间到达，须幂等合并 |
| S→C message.recalled | 撤回后的Message | 双方有权会话房间，清本地附件对象URL |
| S→C message.deleted | {conversationId,messageId,side:agent或customer}；清空为{conversationId,clearAll:true,side:agent} | 单侧广播，clearAll无messageId |
| S→C conversation.created | {conversationId,status,channelId,customerId} | 客户发消息路径可发此事件，不保证每次都是首次创建，按ID upsert |
| S→C conversation.accepted | {conversationId,status,agentId,agentName,assignedAgentId,lastMessage,lastMessageAt,agentUnreadCount,customerUnreadCount} | 原waiting受众；只在接待状态仍有效时发 |
| S→C conversation.updated | 必有conversationId，其余为部分字段：status/assignedAgentId/acceptedAt/agent/lastMessage/lastMessageAt/agentUnreadCount/customerUnreadCount；agent可{id,name}或null | 必须部分合并，不用缺失字段清空已有状态；员工释放也发waiting与null接待字段 |
| S→C conversation.closed | {conversationId,status,assignedAgentId,lastMessage,lastMessageAt,agentUnreadCount,customerUnreadCount} | 前接待受众及客户；并发重开时不能仅凭旧事件强制关闭 |
| S→C channel-history.updated | HistoryChannel但无current；含_id/bindingId/publicToken/品牌字段/status/conversationId/lastMessage/lastMessageAt/unreadCount | 发送至customer-account房间，维护多渠道历史 |
| S→C attachment.updated | {conversationId,messageId,attachmentId,status:expired或recalled或deleted,expiredAt} | 清理任务发tenant/channel-staff及客户；文件已失效时应清媒体缓存 |

重连后重新鉴权、服务器重建房间；修改身份/切换渠道需使用新token重建Socket。前端以当前租户、渠道、会话和身份代次过滤迟到事件，再按_id/clientMessageId合并，以(createdAt,_id)排序；使用HTTP after补拉，搜索定位用around（仅支持端），向前滚动用before。没有服务端事件offset/replay或exactly-once保证，不能只靠Socket维持完整历史。HTTP读取和事件回包可能交错，不能让实时新消息推进尚未补齐的历史游标。

## 10. 无真实凭据的调用示例

以下域名、ID、内容均为示例；`${JWT}`、`${CHANNEL_TOKEN}`由调用方安全注入，不能原样作为真实凭据。

```http
GET /api/tenant/conversations/0123456789abcdef01234567/messages?after=1123456789abcdef01234567&limit=50 HTTP/1.1
Host: api.example.invalid
Authorization: Bearer ${JWT}
```

```json
{"clientMessageId":"example-stable-message-001","messageType":"text","content":"请问如何使用这个功能？"}
```

该body可POST到租户消息或客户消息入口。媒体发送先将FormData的file上传对应会话端点，取得attachmentId后提交：

```json
{"clientMessageId":"example-stable-image-001","messageType":"image","content":"","attachmentId":"2123456789abcdef01234567"}
```

```http
GET /api/files/2123456789abcdef01234567 HTTP/1.1
Host: api.example.invalid
Authorization: Bearer ${JWT}
Range: bytes=0-1023
```

设置部分更新示例（不含密钥）：

```json
{"siteTitle":"示例客服平台","storage":{"conversationAttachmentRetentionDays":2,"pendingAttachmentHours":24,"cleanupBatchSize":100}}
```

## 11. 本次落地、兼容性与待规范化

### 已落地

- 三个消息历史路由使用同一个入口中间件，拒绝非法limit类型/范围、无效ObjectId游标、混用与不支持的游标模式，保留各自默认/上限以及原有时间+ID分页实现。
- 客服/客户两个发消息路由在鉴权后校验body对象、clientMessageId、正文/媒体字段类型与attachmentId格式，避免非字符串正文进入trim导致500。不给正文凭空设置长度上限，不把未知messageType字符串改为强制枚举，不全局拒未知字段。
- 没有修改数据库结构、旧会话控制器分页、三个前端或原有nginx配置。已核对三端实际发送为字符串、每次单一游标、limit为正整数；无需同步修改消费者。
- 新测试覆盖消息入口行为、路由挂载和文档方法路径集合；原回归文件及既有五项分页回归保留。

### 明确未落实，不应被客户端当作现有保证

1. 其他列表的分页/数字严格化，尤其管理租户与租户会话没有统一上限；后续需明确产品最大批量，不能臆造商业边界。
2. 所有路径ID、query筛选对象、employeeIds元素尚未统一入口校验，部分坏输入仍会触发Mongoose cast或全局500。新消息校验只覆盖游标和body附件ID，不是整个系统ID治理。
3. 租户注册邮箱验证码开关：validator和前端Register始终必填，控制器配置关闭时却不核实验证码。需产品确认后同时调整前后端，不能宣称已按配置完整闭环。
4. 回复CREATE/PATCH的数字、null和状态规则不一致；渠道PATCH依赖模型校验，URL/颜色未统一格式验证；状态单独更新接口缺省可能无操作成功。
5. Android check-update仍parseInt宽松解析，版本写入未统一safe integer；系统设置部分number/boolean仍模型cast。所有JSON字段强类型是后续规范目标而非当前全局保证。
6. HTTP与Socket对trial不完全一致：租户HTTP接受trial，租户Socket当前只接受active；投诉上下文也只接受active。纯账号Socket的密码版本与在线状态查询范围需要独立安全验证；本次未改实时鉴权流程。
7. 普通上传未统一魔数/恶意内容扫描；APK仅简单PK头检查。文件大小策略、Range和授权已记录，不代表做了完整内容安全审计。
8. validator错误缺requestId、全局错误缺data、部分特殊接口非标准包装仍保留；旧密码/文本存在String转换，不应将本文推荐类型误认为全局强制。
9. 旧共享客服ChatPanel组件存在transfer调用，但当前路由未挂载该端点；不把前端残留调用写成真实API，也未增加转接功能。
10. 注销当前不服务端撤销JWT；密码变更的Socket断开行为并非所有身份路径统一。数据导出/清理、注册发信、Redis多实例、真实Mongo并发与真实浏览器端到端不由参数单元回归替代。

回滚本次参数规范只需移除三个路由文件中的新增中间件调用/引入及新增中间件文件；不可整文件恢复到Git HEAD，否则会覆盖工作区既有修改。无需数据库回滚。文档与新增测试可保留作为后续治理依据。

## 12. 覆盖统计与验证记录

2026-09-11，当前本地工作区实际统计：

| 路由模块 | HTTP端点数 |
| --- | ---: |
| admin | 49 |
| tenant | 50 |
| client | 28 |
| app | 8 |
| upload | 6 |
| complaintUpload | 1 |
| files | 3 |
| app.js健康检查 | 1 |
| 合计 | 146 |

按方法与完整挂载路径去重，文档清单与源码集合交叉校验通过；不把Express隐式HEAD/OPTIONS、静态文件或前端残留transfer调用算作新增业务端点。第9节列出13个主要应用层Socket事件，不含Socket.IO内建connect/disconnect等生命周期事件。

- `node --unhandled-rejections=strict --test regression.test.js`：25项通过，0失败，0跳过；含后端JavaScript语法检查及既有分页回归。
- `node --unhandled-rejections=strict --test api-parameters.test.js`：7项通过，0失败，0跳过；包括真实参数中间件行为、5处鉴权后挂载的源码断言、146个端点的文档集合检查。挂载源码断言不是完整HTTP集成测试。
- `git diff --check`：通过；Git提示部分文件未来LF→CRLF转换，不是空白错误。未更改Git配置。
- 原回归有Mongoose validateSync弃用警告，不影响此次结果。运行测试时项目依赖自动调用dotenv加载本地配置；未通过文件工具查看配置内容，测试输出未展示配置值。未执行真实注册、发信、数据库清理或部署。
- 本轮未修改前端，未额外执行前端build或浏览器端到端测试；不声称这些验证已通过。原有8个修改文件及未跟踪JPG均保留，未提交、推送或部署。
