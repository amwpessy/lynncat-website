# itnew 科技资讯网站设计规格

## 目标

在 Lynncat.com 下新增 `itnew` 子网站，形成“多来源采集 → 30 条批次 → 管理员审核 → 站内发布”的完整闭环。

- 公开资讯首页：`/itnew/`
- 站内文章详情：`/itnew/article/<slug>`
- 管理员入口：`/itnew/admin/`
- 管理员初始账号：`admin`
- 管理员初始密码：`qc666666`
- 采集频率：每小时检查一次
- 批次大小：目标 30 条
- 批次门禁：上一批存在待审核内容时，不生成下一批
- 语言：中文与英文原文均收集，前台保留原文语言

## 已确认的产品边界

### 版权模式

每个来源必须配置明确的 `rights_mode`：

- `licensed_full`：许可证明确允许转载时，审核通过后保存标题、清理后的完整正文、许可使用的图片、许可证和署名信息、原文链接。
- `summary_link`：没有明确全文授权时，只保存标题、原创摘要、主题替代封面、来源信息和原文链接。

所有新来源默认使用 `summary_link`。RSS 可访问不代表可以全文转载。只有来源级许可证与文章级标注均满足条件时，才可以使用 `licensed_full`。文章卡片始终先打开 itnew 站内详情页；详情页再提供醒目的“查看原文”链接。

Fedora Magazine 可作为首个 `licensed_full` 来源候选：其原创内容通常采用 CC BY-SA 4.0，但采集器仍必须检查文章是否标记为例外，并按要求保留作者署名、永久链接和相同方式共享说明。Mozilla 内容只能在具体页面明确标注 CC 许可证时进入全文模式；否则按 `summary_link` 处理。

### 第一批来源注册表

以下来源作为初始来源注册表。实施时必须对官方 Feed/API 做实时连通性验证；验证失败的来源保持禁用，并在后台展示错误，不能伪造采集成功。

中文来源，默认 `summary_link`：

- 36氪
- InfoQ 中文
- OSCHINA 开源中国
- Solidot
- 少数派
- 机器之心

英文来源，默认 `summary_link`：

- TechCrunch
- The Verge
- Ars Technica
- WIRED
- MIT Technology Review
- Cloudflare Blog
- GitHub Blog 与 GitHub Changelog
- Hacker News Top Stories API（仅作为发现信号，文章版权跟随实际来源）

允许在逐篇许可证检查通过后进入 `licensed_full`：

- Fedora Magazine
- Mozilla Hacks 或 Mozilla 其他明确标注 CC 许可证的文章

## 技术架构

采用已确认的方案 A：复用现有 Lynncat.com Cloudflare Worker，但为 itnew 使用独立存储绑定。

- `ITNEW_DB`：独立 Cloudflare D1，保存来源、批次、候选、文章、图片元数据、会话限流与审计记录。
- `ITNEW_IMAGES`：独立 Cloudflare R2，保存获准使用的文章图片与采集阶段的临时正文对象。
- 现有 Worker：增加 `/itnew/api/*` 与 `/itnew/admin/api/*` 路由，不改变现有市场、新闻及静态资源路由语义。
- 现有 Cron：保留 `0 * * * *`，在同一个 `scheduled()` 中并行触发现有新闻任务和 itnew 采集任务；两者错误隔离。
- 静态前端：继续使用原生 HTML、CSS、JavaScript，与仓库现有形态一致，不增加前端框架。

D1 当前单行字符串/BLOB/行大小上限为 2 MB，因此清理后的正文 HTML 按最多 400 KB 的有序段落块存入 D1，避免单篇长文触发行上限。图片二进制和采集阶段尚未审核的临时正文存入 R2，D1 只保存对象键和元数据。R2 图片通过 Worker 的 `/itnew/images/<key>` 路由输出并设置缓存头，不使用公开 `r2.dev` 作为生产地址。8 张主题替代封面作为版本化静态资源随网站部署，不重复写入 R2。

## 组件边界

### 公开前端

公开端由三个独立页面状态组成：

1. 首页 `/itnew/`
   - 今日焦点
   - 编辑精选
   - 分类导航：全部、AI、芯片、互联网、开发者、安全、机器人、硬件、前沿科技
   - 语言筛选：全部、中文、English
   - 搜索
   - 页面下方的 `LATEST SIGNALS · 最新资讯` 单列竖形列表
   - 最新资讯每条按“时间 → 缩略图 → 标题 → 来源 → 语言/阅读时长”排列
2. 文章详情 `/itnew/article/<slug>`
   - 标题、来源、作者、发布时间、语言、分类、站内发布时间
   - `licensed_full` 显示清理后的完整正文与获准图片
   - `summary_link` 显示原创摘要与版权说明
   - 两种模式均显示原文链接
   - CC 内容显示许可证、署名和相同方式共享要求
3. 空状态与错误状态
   - 首次无已发布内容时给出明确空状态
   - API 失败时保留页面结构并提供重试

### 管理员前端

管理员界面与公开前台完全分离：

1. 登录页 `/itnew/admin/`
   - 账号、密码、保持登录、登录错误和限流提示
   - 前台不显示后台入口
2. 资讯审核
   - 桌面每行 3 张纵向卡片，平板每行 2 张，手机每行 1 张
   - 卡片显示封面、0–100 评分、分类、语言、版权模式、标题、两行摘要、来源、时间、阅读时长
   - 单条预览、通过、拒绝
   - 勾选与批量通过/拒绝
   - 底部固定批量工具栏
   - 当前批次未完成时禁用“立即采集”
3. 已发布内容
   - 搜索、筛选、查看站内文章、查看原文
   - 支持下架；下架写审计日志，不物理删除审计记录
4. 采集来源
   - 显示来源健康状态、上次成功时间、最近错误、语言、版权模式和权重
   - 支持启用/禁用来源；不允许在浏览器里把无授权来源改成全文模式
5. 批次记录
   - 显示采集时间、候选数、通过数、拒绝数、警告和关闭时间

### Worker 后端模块

- 认证模块：登录、登出、会话校验、CSRF、失败限流。
- 来源适配器：RSS/Atom、JSON API、Hacker News 发现信号。
- 规范化模块：统一标题、URL、时间、语言、分类、摘要和图片候选。
- 去重评分模块：规范 URL、内容指纹、近似标题分组和质量评分。
- 批次模块：批次门禁、30 条选择、状态推进、批次关闭。
- 审核模块：单条与批量事务、失败回滚、审计日志。
- 发布模块：正文清理、许可证与署名、R2 图片复制、替代封面、文章 slug。
- 公共 API：已发布列表、文章详情、图片输出。

每个模块只通过明确的数据对象和函数调用协作，避免把采集、鉴权、SQL 与 HTML 清理堆在同一个 Worker 文件中。

## 数据模型

### `itnew_sources`

保存来源配置与健康状态：`id`、`name`、`feed_url`、`homepage_url`、`language`、`rights_mode`、`license_name`、`license_url`、`attribution_template`、`priority_weight`、`enabled`、`etag`、`last_modified`、`last_success_at`、`last_error_at`、`last_error`。

### `itnew_batches`

保存批次生命周期：`id`、`status`（`open`/`closed`）、`target_count`、`candidate_count`、`collected_at`、`closed_at`、`warnings_json`。数据库约束保证同时最多只有一个 `open` 批次。

### `itnew_candidates`

保存临时候选：`id`、`batch_id`、`source_id`、`canonical_url`、`content_fingerprint`、`title`、`summary`、`staged_body_key`、`remote_image_url`、`language`、`category`、`score`、`rights_mode_snapshot`、`license_snapshot_json`、`status`（`pending`/`approved`/`rejected`/`processing_error`）、`processing_error`、`article_id`、`source_published_at`、`created_at`、`reviewed_at`。`staged_body_key` 只用于许可证允许全文且 Feed 已提供正文的候选，并指向 R2 临时对象；其他候选保持为空。

规范 URL 和内容指纹建立唯一索引，防止同一文章进入后续批次。被拒绝的候选保留最小去重信息与审计关联；临时正文在批次关闭后的清理任务中移除。

### `itnew_articles`

保存站内文章：`id`、`slug`、`source_id`、`canonical_url`、`title`、`summary`、`language`、`category`、`rights_mode`、`license_name`、`license_url`、`attribution_text`、`hero_image_kind`（`r2`/`fallback`）、`hero_image_key`、`source_published_at`、`published_at`、`status`（`published`/`unpublished`）。

### `itnew_article_sections`

保存完整正文的有序 HTML 段落块：`id`、`article_id`、`section_index`、`html`。每块清理后的 UTF-8 数据不得超过 400 KB；`article_id + section_index` 唯一。文章详情 API 按顺序读取并拼接，保证长文章仍完整保存在自己的 D1 中。

### `itnew_article_images`

保存 R2 图片映射：`id`、`article_id`、`object_key`、`source_url`、`alt_text`、`sort_order`、`created_at`。

### 安全与审计表

- `itnew_login_attempts`：IP 摘要、窗口开始时间、失败次数、锁定截止时间。
- `itnew_audit_log`：管理员、动作、目标类型、目标 ID、批次 ID、结果、时间和不含秘密值的详情 JSON。

### 搜索索引

使用 D1 FTS5 为已发布文章的标题与摘要建立全文搜索索引；正文不进入默认搜索索引，控制索引体积。

## 采集与评分流程

1. 每小时 Cron 或管理员手动请求进入同一个 `collectNextBatch()`。
2. 数据库事务检查是否存在 `open` 批次或 `pending`/`processing_error` 候选；存在则返回 `batch_in_progress`，不采集。
3. 并发拉取已启用来源，使用来源级超时、ETag 和 Last-Modified；单来源失败不终止其他来源。
4. 规范化 URL、时间、语言、分类、摘要和图片候选。
5. 精确重复按 canonical URL/指纹剔除；近似标题聚类只保留质量最高的一条，并记录多来源佐证。
6. 计算 0–100 分：来源权重 30、时效性 25、IT 相关度 20、内容完整度 15、多来源佐证 10。
7. 从高分到低分选择目标 30 条：在来源充足时目标中英文各 15 条；单来源最多 5 条；单分类最多 8 条。
8. 实际不足 30 条时创建较小批次，并写入 `warnings_json`。

时效性规则：3 小时内满分，12 小时内 20 分，24 小时内 15 分，48 小时内 8 分，超过 48 小时默认不进入候选。

## 审核与发布流程

- 单条审核与批量审核共用同一服务函数。
- 批量操作先验证所有 ID 均属于当前批次且仍为 `pending`；任一无效则整批拒绝，不做部分更新。
- `approved`：
  - `licensed_full` 清理正文 HTML、按 400 KB 上限切分并写入正文段落表，复制获准图片到 R2，写入文章、图片和审计记录。
  - `summary_link` 写入标题、原创摘要、主题替代封面和原文链接。
- `rejected`：保存决策、时间和审计记录，不创建文章。
- 图片复制失败时使用对应分类替代封面并记录警告，不阻塞文字文章发布。
- 正文抓取或清理失败时转为 `processing_error`，不发布；后台提供“重新处理”。
- 当前批次没有 `pending` 或 `processing_error` 后，自动标记为 `closed`。

## 主题替代封面

已确认 8 张 1536×1024 PNG，均包含中文大标题与英文副标题：

- `itnew/assets/fallback/ai.png`：人工智能 / ARTIFICIAL INTELLIGENCE
- `itnew/assets/fallback/chips.png`：芯片与半导体 / CHIPS & SEMICONDUCTORS
- `itnew/assets/fallback/security.png`：网络安全 / CYBERSECURITY
- `itnew/assets/fallback/robotics.png`：机器人与自动化 / ROBOTICS & AUTOMATION
- `itnew/assets/fallback/development.png`：软件开发与开源 / SOFTWARE & OPEN SOURCE
- `itnew/assets/fallback/cloud.png`：云计算与网络 / CLOUD & NETWORKS
- `itnew/assets/fallback/devices.png`：消费电子 / CONSUMER TECHNOLOGY
- `itnew/assets/fallback/frontier.png`：量子与前沿科技 / QUANTUM & FRONTIER TECH

图片视觉采用深海军蓝、柔光紫、暖白和少量薄荷绿，与前台 C 系主题一致。列表页横向裁切，文章页保留 3:2 构图。无法判断分类时使用 `frontier.png`。

## 视觉规范

### 公开前台

- C 方案的浅色、留白、柔和渐变和紫色强调。
- B 方案的时间戳、实时信号感和高信息密度。
- `LATEST SIGNALS` 位于页面下方并使用竖形单列排列。
- 最新资讯标题前必须有文章缩略图或主题替代封面。
- 文章正文使用较窄阅读列、清晰段落间距和稳定图片宽度。

### 管理后台

- 登录页为左右分栏：左侧登录表单，右侧抽象科技视觉。
- 审核页使用深色侧栏和浅色工作区。
- 审核卡片桌面每行 3 张、平板 2 张、手机 1 张。
- 卡片封面在上，内容与操作在下，减少横向扫描疲劳。
- 通过为薄荷绿、拒绝为浅红、选中为紫色描边。
- 底部批量工具栏固定，但不得覆盖最后一排卡片。

## 登录与安全

- `ITNEW_ADMIN_USERNAME` 与 `ITNEW_ADMIN_PASSWORD` 使用 Cloudflare Secret；生产初始值分别为 `admin` 和 `qc666666`，不得写入仓库或前端响应。
- 登录成功后签发 HMAC 签名的 HttpOnly Cookie，有效期 8 小时，启用 `Secure`、`SameSite=Strict`，路径限制为 `/itnew/admin`。
- 会话包含随机 CSRF 令牌；所有变更请求验证会话、CSRF 和同源 Origin。
- IP 使用带独立 Secret pepper 的摘要，不保存明文；15 分钟内最多失败 5 次。
- 凭据比较使用常量时间比较。
- 文章 HTML 使用允许列表清理；删除 `script`、`style`、`iframe`、表单、事件属性、危险 URL 协议与未知嵌入。
- 外链使用 `rel="noopener noreferrer"`。
- R2 对象键由内容哈希生成，禁止使用未清理的远程文件名。
- 管理 API 响应统一 `Cache-Control: no-store`；公开文章 API 使用短缓存并在发布后失效。

## 错误处理与可观测性

- 每次采集保存来源级成功、失败、耗时和候选数。
- 单来源失败不终止整批；所有来源失败时不创建空批次。
- 登录、采集、审核、发布均返回稳定错误码，前端显示可操作信息。
- 定时任务是否成功必须通过批次、来源健康、文章数量和更新时间验证，不能只看 Worker 是否运行。
- 审计日志不记录密码、Cookie、CSRF、完整 IP 或正文内容。
- D1/R2 配置缺失时管理端显示系统配置错误，公开端仍可读取已有静态资源，不暴露内部绑定名。

## 测试与验收

### 自动化测试

- 登录成功、错误密码、会话过期、常量时间比较、限流、CSRF 与同源检查。
- 当前批次门禁、每小时触发、手动采集、来源失败隔离。
- URL/指纹去重、近似标题聚类、0–100 评分、语言与来源配额。
- 单条通过/拒绝、批量全有或全无事务、重复点击幂等。
- `licensed_full` 与 `summary_link` 两条发布路径。
- HTML 清理、危险链接、图片复制失败与分类替代封面。
- 批次关闭、重新处理、审计记录与已发布内容下架。
- 中英文、分类、搜索、分页和文章详情 API。

### 浏览器验收

- 公开首页、竖形最新资讯、文章详情、原文链接。
- 管理员登录、错误与限流提示、保持登录、退出。
- 桌面三列、平板两列、手机单列审核卡片。
- 勾选、单条审核、批量工具栏、处理进度和新批次门禁。
- 主题替代封面显示、文章图片加载失败降级与深浅内容对比度。

### 部署验收

1. 本地应用 D1 migration 并运行全部测试。
2. 本地 Wrangler 启动 Worker，执行完整采集与审核流程。
3. 创建并绑定独立远程 D1 与 R2。
4. 设置管理员与签名 Secret，不在日志中输出值。
5. 远程应用 migration，部署 Worker。
6. 冒烟测试登录、手动采集、批量审核、站内文章和原文链接。
7. 等待至少一次真实整点 Cron，并从批次记录验证实际采集结果。

## 官方依据

- Cloudflare Cron Triggers：<https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Cloudflare D1 limits：<https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare R2 limits：<https://developers.cloudflare.com/r2/platform/limits/>
- Fedora Magazine Terms and Conditions：<https://fedoramagazine.org/terms-and-conditions/>
- Mozilla Licensing Policies：<https://www.mozilla.org/en-US/foundation/licensing/>
- MDN Attribution and Copyright Licensing：<https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license>

## 明确不在本期范围

- 自动翻译或改写中英文全文
- AI 生成新闻正文
- 多管理员角色与邀请系统
- 评论、点赞、收藏与用户账号
- 付费订阅、广告和邮件简报
- 未经授权的全文转载或图片复制
