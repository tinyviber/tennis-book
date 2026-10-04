# 书间 · 图文书籍阅读器

Next.js 阅读网站与内容管理后台。框架代码放在 repo；书籍资料、Markdown、图片和管理状态保存在持久化存储中。新增或修改内容时无需修改源码、提交 Git 或重新构建网站。

读者公开阅读；只有预先配置的管理员能管理内容。没有开放注册。本地和 Docker 使用文件系统；部署到 Vercel 时使用私有 Vercel Blob。

## 目录与数据边界

```text
src/
  app/                 阅读页面、后台页面、受保护的写入 API
  components/          阅读器与编辑界面
  lib/content-store.ts 内容读取、校验、Markdown 渲染、保存
  lib/auth-store.ts    密码哈希、会话、登录限速
scripts/               数据导入、校验、管理员配置
Dockerfile             只打包框架，不包含内容或凭据
compose.yaml           框架容器 + 独立持久化数据卷
.env.example           配置示例，可以提交

data/                  本地和 Docker 运行时数据，不提交 Git；可用 DATA_DIR 指向 repo 外部
  books/<book>/
    book.json          书籍资料和发布状态
    chapters/*.md      章节正文和资料
    images/*           原始图片
    extraction.json    扫描裁图记录（如有）
  auth/                本地和 Docker 的会话与登录限速记录，不通过 HTTP 暴露
  history/<book>/       本地和 Docker 覆盖保存前的旧资料和正文
  trash/               本地和 Docker 移除的书籍或章节
.env.local             本机配置与密码哈希，不提交 Git
```

原来的 `content/books/tennis-improvement/` 已迁到 `data/books/tennis-improvement/`，保留 47 节正文、522 幅图组与扫描裁图记录。本地和 Docker 从 `data/` 读取运行时内容；Vercel 部署把 `data/books/` 迁入私有 Blob。首次把框架提交到 Git 前，请另外备份整个数据目录。Git clone 只取得框架，内容需要从备份或 Blob 迁入。

构建不读取数据目录，也不生成 `src/generated/library.json`、`public/books/` 或静态 `out/`。页面和搜索在请求时读取当前数据；保存后的内容在读者刷新页面或重新打开搜索时生效。阅读进度、字号、主题和图片放大功能保留。

## 本地启动

推荐 [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)；框架要求 Node.js 20.9 或更新版本。

```bash
npm ci
npm run init-data
npm run setup-admin
npm run dev
```

`setup-admin` 会交互式询问用户名和密码，密码不回显，至少 12 个字符；仅把密码哈希写入 `.env.local`。不提供默认密码。已有环境变量或部署平台配置优先于 `.env.local`。

打开 [书架](http://localhost:3000/) 或 [管理后台](http://localhost:3000/admin/)。默认 `APP_URL=http://localhost:3000`；如果使用其他端口或访问地址，请同步修改 `APP_URL`，否则后台会拒绝不同来源的写入请求。

生产模式：

```bash
npm run check
npm test
npm run build
npm start
```

`npm run preview` 同样启动 Next.js 生产服务。网站已改为需要 Node 后端的应用，不能使用旧的 `out/` 静态导出或旧静态服务器部署。

## 管理内容

在 `/admin/` 添加书籍，填写书籍标识（如 `tennis-notes`）和书名。新书默认是草稿。

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

也可直接修改 `DATA_DIR/books/` 下的 JSON、Markdown 和图片，再校验：

```bash
npm run check-content
npm run add-book -- tennis-notes "网球训练笔记"
```

直接修改文件时，请保留资料结构并避免与后台同时修改同一个文件。只有后台保存才会自动生成历史版本。

## 导入、备份和恢复

`DATA_DIR` 指向包含 `books/` 的目录，例如 `/srv/shujian-data`。它是运行时配置，修改后重启服务，无需重建框架。

从旧项目的 `content/books/` 或备份的 `books/` 导入：

```bash
npm run init-data -- --from /path/to/backup/books
```

导入先复制到暂存目录，校验所有章节与引用图片后移入数据目录。源文件保持原样；同名书籍已存在时跳过，不覆盖。

备份请包含整个 `DATA_DIR`，以及单独妥善保存部署配置。为取得一致的快照，备份或恢复时短暂停止服务。恢复时把备份放回数据目录并重启服务即可。`history/` 保存覆盖前的原文件；`trash/<批次>/<book>/` 保存已移除的章节，整本书在该路径的 `book/` 下。恢复单个条目时，停止服务、把文件放回 `books/<book>/` 对应位置，再运行 `check-content`。历史记录和回收目录不会自动清理。

密码忘记或需要轮换时，重新运行 `npm run setup-admin` 并重启服务。账号或密码哈希变化会使旧会话失效；会话有效期 12 小时，退出登录会在服务端撤销。全局账号在 15 分钟窗口内最多允许 5 次失败尝试。会话和限速状态保存在本地/Docker 数据目录或 Vercel Blob，重启服务不会重置。

## Vercel 部署

Vercel Functions 的文件系统不适合保存运行时改动。本项目在 Vercel 上把书籍资料、章节、图片、历史版本、回收内容、管理会话和登录限速状态保存到**私有 Vercel Blob**；图片由浏览器直传 Blob，并通过短时签名地址读取。函数请求体有 4.5 MB 上限，因此图片不会经过函数上传或下载。

1. 在 Vercel 导入 `tinyviber/tennis-book`，使用 Next.js 默认构建设置。项目的 `.nvmrc` 为 Node.js 24；Vercel 当前默认支持 24.x。
2. 在项目的 **Storage** 中创建并连接一个 **Private Blob** store，至少连接 Production 环境。不要把生产 Blob store 共享给可编辑内容的 Preview 部署；需要预览时给 Preview 单独连接一个私有 store。
3. 在 Vercel 项目设置中为 Production 配置 `APP_URL`、`ADMIN_USERNAME` 和 `ADMIN_PASSWORD_HASH`。`APP_URL` 填最终访问域名的 Origin，例如 `https://books.example.com`，不要带路径。Preview 环境没有设置 `APP_URL` 时会自动使用 Vercel 提供的部署域名；如果要在 Preview 使用后台，请为其配置单独的管理员凭据和私有 Blob store。可在本机运行 `npm run setup-admin` 生成管理员配置，再把 `.env.local` 中这两个管理员变量复制到 Vercel。Blob store 会提供所需的访问凭据；`STORAGE_DRIVER` 在 Vercel 上会自动选择 Blob。
4. 把现有书库迁入 Production Blob。安装并登录 Vercel CLI 后，在项目目录运行：

   ```bash
   vercel link
   vercel env pull .env.local --environment=production
   npm run migrate-vercel-blob
   ```

   脚本读取 `data/books/`，只上传书籍、章节、图片和图片尺寸索引；不会上传认证信息、会话、历史版本或回收目录。当前本地书库约 37 MB。重复运行会跳过已有对象；只有确认要用本地文件覆盖线上同名内容时才加 `--overwrite`。

部署完成后，后台上传和编辑会直接写入 Blob；Vercel Function 的 4.5 MB 请求/响应限制由图片直传和签名读取绕开。更多说明见 [Vercel Blob 私有存储](https://vercel.com/docs/vercel-blob/private-storage)、[浏览器直传](https://vercel.com/docs/vercel-blob/client-upload) 和 [函数限制](https://vercel.com/docs/functions/limitations)。

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

Vercel 使用私有 Blob 的条件写入保存编辑版本，多个函数实例可以共享书籍、会话和限速状态。其他无持久化磁盘的平台仍需提供兼容的持久化存储实现。

## 验证与来源说明

`npm run check` 验证类型；`npm test` 覆盖发布状态、即时读取、保存冲突、历史版本、回收、图片校验、路径边界、密码哈希、会话过期/撤销/轮换、CSRF 和持久化登录限速。`npm run check-content` 单独校验实际数据，不作为框架构建的依赖。

认证校验遵循 [Next.js 认证指南](https://nextjs.org/docs/app/guides/authentication)：每个写入 API 在服务端核验会话；不是仅隐藏后台按钮。密码使用 Node.js 的 scrypt（N=32768、r=8、p=3、独立随机盐），参数参考 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

正文由扫描 OCR 转成 Markdown，尚未逐字校对；插图保留原书的动作、箭头和标注。裁图记录保存在各书籍的 `extraction.json`。扫描导入脚本 `scripts/import-scanned-book.py` 使用 `--data-dir` 或 `DATA_DIR` 指定目标，需要安装 `pymupdf` 与 `Pillow`；Python 脚本不自动加载 `.env.local`。字体和界面依赖的许可文本收录在 `LICENSES/`。

第二本书《网球运动系统训练》的导入、图像来源和重建方式见[导入说明](docs/import-training-book.md)；结合两本书编写新手版的提案见[整合方案](docs/beginner-edition-plan.md)。
