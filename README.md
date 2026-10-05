# 书间 · 图文书籍阅读器

Next.js 阅读网站。框架和四本书的资料都保存在这个 GitHub 仓库中。修改内容后提交并推送，Vercel 会自动部署新版本。

Vercel 上的书架只读。书籍可在本地通过管理后台编辑，也可以直接修改仓库中的 JSON、Markdown 和图片。

## 目录与数据边界

```text
src/
  app/                 阅读页面、后台页面、受保护的写入 API
  components/          阅读器与编辑界面
  lib/content-store.ts 内容读取、校验、Markdown 渲染、保存
  lib/runtime-store.ts 私人可变数据读写，本地文件或私有 Blob
  lib/auth-store.ts    密码哈希、会话、登录限速
scripts/               数据导入、校验、管理员配置
Dockerfile             只打包框架，不包含内容或凭据
compose.yaml           框架容器 + 独立持久化数据卷
.env.example           配置示例，可以提交

data/
  books/<book>/         书籍内容，跟随代码提交到 GitHub
    book.json          书籍资料和发布状态
    chapters/*.md      章节正文和资料
    images/*           原始图片
    extraction.json    扫描裁图记录（如有）
  auth/                私人会话与登录限速记录，不提交 Git
  training/            训练状态、历史版本和私人媒体，不提交 Git
  history/<book>/      本地编辑器覆盖保存前的旧资料和正文，不提交 Git
  trash/               本地编辑器移除的书籍或章节，不提交 Git
.env.local             本机配置与密码哈希，不提交 Git
```

`data/books/` 包含《网球进阶》《网球运动系统训练》《网球步法》和《网球压力训练》。克隆仓库即可取得完整书库；Vercel 部署从同一目录读取书籍和章节。登录会话、私人训练状态和媒体、历史版本和回收内容不会提交到 GitHub；书籍内容与这些可变记录使用独立的存储模块。

页面和搜索在请求时读取仓库中的书籍资料。Vercel 构建会把已发布书籍的图片复制为静态资源，并生成图片尺寸索引；章节和书籍资料由 Next.js 服务读取。网站仍需要 Node.js 服务，不能使用旧的 `out/` 静态导出。

## 本地启动

推荐 [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)；框架要求 Node.js 20.9 或更新版本。

```bash
npm ci
npm run setup-admin
npm run dev
```

`setup-admin` 会交互式询问用户名和密码，密码不回显，至少 12 个字符；仅把密码哈希写入 `.env.local`。本地书库管理与私人训练共用该账号。Vercel 书库只读；若另行开启线上私人训练，仍需要私人账号与持久化运行存储。

打开 [书架](http://localhost:3000/) 或本地 [管理后台](http://localhost:3000/admin/)。默认 `APP_URL=http://localhost:3000`；如果使用其他端口或访问地址，请同步修改 `APP_URL`，否则后台会拒绝不同来源的写入请求。

生产模式：

```bash
npm run check
npm test
npm run build
npm start
```

`npm run preview` 同样启动 Next.js 生产服务。网站已改为需要 Node 后端的应用，不能使用旧的 `out/` 静态导出或旧静态服务器部署。

## 管理内容

私人网球训练入口为 `/training/`，与本地管理后台共用账号，训练资料与四册书分开保存。包含录像复盘、当前练习任务、健身记录导入和每周预算排期；可选开启影像 AI 与浏览器姿态参考。使用、导入格式、备份范围和配置见 [私人训练说明](docs/private-training.md)。

本地运行时可以在 `/admin/` 添加书籍，填写书籍标识（如 `tennis-notes`）和书名。新书默认是草稿。保存会修改 `data/books/` 下的仓库文件；推送这些改动后，Vercel 会部署更新后的书籍。

在书籍编辑页：

- 展开「书籍资料」，设置作者、简介、封面和书籍发布状态。
- 「新建」章节，填写稳定的章节标识、资料区和 Markdown 正文。
- 使用「预览正文」检查排版；上传图片后会自动插入相对路径，保存章节后生效。
- 图片库可搜索现有图片，点击图片插入正文；上传的图片也可选为封面。
- 移除书籍或章节会移入回收目录。覆盖保存前保留旧版本，发生版本冲突时返回错误，不覆盖较新的内容。

章节示例：

```markdown
---
title: 握拍练习
order: 1
group: 基础训练
pageStart: 12
pageEnd: 15
published: true
---

在这里写正文。

![握拍示意](../images/grip.webp "原书第 12 页")
```

书籍和章节的 `published` 都是 `true` 时，章节才公开；一本书至少有一节已发布章节才显示在书架。旧内容没有 `published` 字段时视为已发布。草稿正文不会出现在阅读页面或公开搜索接口。**已发布书籍的图片属于公开资源**，不要把私人文件上传到其图片库；草稿书籍的图片需要管理员登录才能访问。

图片支持 WebP、PNG、JPEG 和 GIF，每张最多 10 MB、4000 万像素；只接受当前书籍 `images/` 内的相对引用。上传时生成新的文件名，避免覆盖旧图。不接受 SVG、远程图片或越界路径。Markdown 的原始 HTML 被转义，资料区只接受 YAML，不执行代码。

也可直接修改 `data/books/` 下的 JSON、Markdown 和图片，再校验：

```bash
npm run check-content
npm run add-book -- tennis-notes "网球训练笔记"
```

直接修改文件时，请保留资料结构。后台保存会在本地生成历史版本；文件提交到 Git 后，可以用 GitHub 历史恢复内容。

## 导入、备份和恢复

`DATA_DIR` 默认是仓库中的 `data/`，包括书籍和本地运行状态。自托管时可把它设为持久化目录，例如 `/srv/shujian-data`。

从备份的 `books/` 导入：

```bash
npm run init-data -- --from /path/to/backup/books
```

导入先复制到暂存目录，校验所有章节与引用图片后移入 `data/books/`。源文件保持原样；同名书籍已存在时跳过，不覆盖。

备份请包含整个 `DATA_DIR`，以及单独妥善保存部署配置。为取得一致的快照，备份或恢复时短暂停止服务。恢复时把备份放回数据目录并重启服务即可。`history/` 保存覆盖前的原文件；`trash/<批次>/<book>/` 保存已移除的章节，整本书在该路径的 `book/` 下。恢复单个条目时，停止服务、把文件放回 `books/<book>/` 对应位置，再运行 `check-content`。历史记录和回收目录不会自动清理。

密码忘记或需要轮换时，重新运行 `npm run setup-admin` 并重启本地服务。账号或密码哈希变化会使旧会话失效；会话有效期 12 小时，退出登录会在服务端撤销。全局账号在 15 分钟窗口内最多允许 5 次失败尝试。会话和限速状态保存在本地/Docker 数据目录，或线上私人训练连接的私有 Blob；书库始终从 Git 文件读取。

## Vercel 部署

书籍内容和图片跟随 GitHub 仓库部署；仅阅读书库无需创建 Blob，也无需添加内容环境变量。线上内容只读；在 GitHub 改动并推送后，Vercel 会重新构建部署。

1. 在 Vercel 导入 `tinyviber/tennis-book`，使用 Next.js 默认构建设置。
2. 点击部署。仓库中的 `data/books/` 会随项目构建；Vercel 不需要 Blob store、管理员变量或内容迁移步骤。
3. 更新书籍时，修改 GitHub 上 `data/books/<书籍标识>/` 中的 `book.json`、`chapters/*.md` 或 `images/`，提交改动。也可以在本地编辑后运行 `npm run check-content`，再提交并推送。Vercel 会在推送后自动部署。

部署版 `/admin/` 只展示内容更新说明，所有书库管理接口都会拒绝修改。本地后台保存书籍后，需要提交并推送到 GitHub 才会更新线上阅读版。

`/training/` 是独立的私人功能，不会将记录上传到书库。若需要在 Vercel 使用可保存的私人训练，请连接一个 **Private Blob** store，并配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH` 与 `APP_URL`。这些配置只用于私人身份、录像和训练记录，不再用于书籍内容。没有设置账号时显示配置提示，书库照常可读。Vercel 函数文件系统只读，不能用临时目录代替私人记录的持久化存储。Production 与 Preview 使用独立的私人 store 和账号，避免预览写入日常记录。可选 AI 另需 `OPENAI_API_KEY`；不配置时人工流程仍可用。

## 服务器部署

可以直接运行 `npm run build` 和 `npm start`，把 `DATA_DIR` 设置为源码目录外的持久化目录，并让运行服务的账号有读写权限。请用进程管理器维护服务，通过 HTTPS 反向代理提供访问，设置 `APP_URL=https://你的域名`。写入接口核对浏览器 Origin 与该配置，HTTPS 下使用 HttpOnly、Secure、SameSite=Strict 会话 Cookie。

Docker Compose 使用独立命名卷保存内容，重建或替换镜像不会修改该卷：

```bash
# 先设置 .env.local 中的管理员和 APP_URL=https://你的域名
npm run setup-admin
docker compose --env-file .env.local up -d --build

# 仅首次部署时，导入现有本地内容
docker compose cp data/books reader:/data/books
docker compose exec --user root reader chown -R 1001:1001 /data
```

容器只绑定服务器本地 `127.0.0.1:3000`，由现有 HTTPS 反向代理转发到它。导入或恢复时先停用后台编辑，避免与复制同时写入。后续升级框架只需要再次 `up -d --build`，**不要重新复制旧数据覆盖线上内容，也不要用 `docker compose down -v` 删除数据卷**。

备份容器数据：

```bash
# 在暂停内容编辑时执行，备份目录应不存在
mkdir -p backups
docker compose stop reader
docker compose cp reader:/data backups/shujian-data
docker compose start reader
```

子路径部署：构建时设置 `BASE_PATH=/bookshelf`；Docker 使用上面的 `--env-file` 读取 `.env.local` 中的 `BASE_PATH`。`APP_URL` 仍填写域名的 Origin（如 `https://example.com`）。图片、搜索和管理请求会自动带上构建时的子路径。修改子路径需要重建框架。

Vercel 从 GitHub 部署快照读取书籍文件。线上书库更新需要创建新的 Git 提交并触发部署；本地与 Docker 编辑继续使用文件系统。私人的身份和训练状态由 `runtime-store.ts` 独立持久化，不在静态内容或 Git 文件中保存。

## 验证与来源说明

`npm run check` 验证类型；`npm test` 覆盖发布状态、即时读取、保存冲突、历史版本、回收、图片校验、路径边界、密码哈希、会话过期/撤销/轮换、CSRF 和持久化登录限速。`npm run check-content` 单独校验实际数据，不作为框架构建的依赖。

认证校验遵循 [Next.js 认证指南](https://nextjs.org/docs/app/guides/authentication)：每个写入 API 在服务端核验会话；不是仅隐藏后台按钮。密码使用 Node.js 的 scrypt（N=32768、r=8、p=3、独立随机盐），参数参考 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

正文由扫描 OCR 转成 Markdown，尚未逐字校对；插图保留原书的动作、箭头和标注。裁图记录保存在各书籍的 `extraction.json`。扫描导入脚本 `scripts/import-scanned-book.py` 使用 `--data-dir` 或 `DATA_DIR` 指定目标，需要安装 `pymupdf` 与 `Pillow`；Python 脚本不自动加载 `.env.local`。字体和界面依赖的许可文本收录在 `LICENSES/`。

第二本书《网球运动系统训练》的导入、图像来源和重建方式见[导入说明](docs/import-training-book.md)；结合两本书编写新手版的提案见[整合方案](docs/beginner-edition-plan.md)。
