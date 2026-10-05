# 私人网球训练

入口是 `/training/`，与内容管理共用管理员账号。四册原书保持原样；新的记录保存在 `DATA_DIR/training/`，本地为文件，Vercel 为私人 Blob。训练区没有注册、多用户、自动订场或支付。

## 四步工作流

1. **先完成一轮正手试练。** 用固定机位和来球条件录短片，标记时间点，区分可见观察与待验证解释。只定一个提示，记录教练校准，再用相同条件复录。第一、第二周都可以重复这轮流程；系统不把自述的“20% 对拉”当作统一成功率，也不会声称已经完成真实试练。
2. **在手机训练区使用三个视图。** 今日训练包含当前任务、来源卡、实际练习时间/费用/成功口径和健身组次；录像复盘保留原片、人工观察、教练历次意见与复录关联；每周安排按实际报价、最低预约、另付场地费与分摊、往返时间、预算和可约星期比较三个候选。一天最多一次训练，因此健身候选安排在非练球日；可用星期不等于已确认具体小时或预订。
3. **预览后导入已有健身记录。** 支持具名表头的 Hevy/Strong CSV 和本项目通用 JSON v1。文件在浏览器解析，确认加入后还需保存。缺少重量/距离单位时要求选择，不把空值当成零。内容相同的重复训练跳过；修改过的训练会生成新的内容标识，应检查预览。没有训记官方 API 或未经转换的备份支持。CSV 日期仅支持文档下列格式，无时区日期由用户明确选择中国时间或 UTC。
4. **按需要使用可选影像工具。** 人工流程始终可用。选定最多六帧并逐次同意后，服务器调用 OpenAI Responses API，返回带帧时间证据的待确认建议。用户采纳后才进入复盘，再保存。本地姿态参考点击后加载模型，当前帧在 Web Worker 内计算，不上传视频；只画较清晰的人体关键点，不识别球/球拍、不生成技术分数、速度或准确的三维角度。

## 教学资料：从视频或文章到训练步骤

第四个视图「教学资料」用来收集文章、字幕、笔记和教学短片。填写来源链接并粘贴正文，或读取 TXT、Markdown、SRT、VTT 文本；可上传 MP4/MOV/WebM 原片。单独保存链接时是书签，应用不会下载视频平台内容或宣称已经读过页面。需要分析音频内容时，请先提供字幕；所选静帧不含声音。

1. 建立一份资料，手动加入步骤；每步填写短提示、练法、来源已有的次数及原句。上传原片后，在步骤填写起止秒数并循环播放，可切换播放速度。
2. 如已配置 AI，选择最多六帧并明确同意发送正文和所选画面，取得摘要与最多六个步骤草稿。每步的原句必须存在于提交正文中；帧证据映射到实际选帧时间。先预览、采纳、核对，再保存。AI 不替你确定连续动作的循环区间，需对照原片自行选取。
3. 也可将资料给外部 AI，按页面提供的 `tennis-teaching-draft` JSON 模板返回结果，粘贴或选择文件后预览导入。导入不覆盖原片，不接受外部素材路径，步骤标为待核对。
4. 为已选区间生成 GIF。浏览器最多处理 6 秒、长边 360 像素、8 帧/秒；编码在 Worker 中逐帧进行，可以取消，成品不超过 4 MB。可下载并保存到步骤中。失败时仍可循环原视频。此过程不向 AI 或其他服务发送画面。
5. 将已保存资料固定到「今日训练」，训练时逐步查看大字提示、练法和循环片段。删除资料条目不会删除共享视频或 GIF；改动原片或区间会清除旧 GIF 关联，原素材仍保留。

教学表单和待采纳结果参与未保存草稿保护；导出训练备份包含教学卡片、正文和素材索引，**不包含原片和 GIF 二进制文件**。卡片和私人视频都保存在 `training/`，不会自动提交到 GitHub 书库。旧版训练 JSON 恢复后会补为空教学列表，原有训练记录继续保留。

GIF 编码采用固定版本 [`gifenc` 1.0.3](https://github.com/mattdesl/gifenc)。浏览器编码与实际手机播放受视频编码和浏览器支持影响；建议使用 H.264 MP4。这里只整理提供的教学资料，步骤是否适合自己仍由实际练习和教练反馈校准。

## 开启与配置

书籍已改为从 GitHub 部署快照读取，不再需要 Blob 内容迁移。私人训练仍需按 README 配置管理员、`APP_URL` 与持久化运行存储：本地／自托管使用 `DATA_DIR`，Vercel 可选连接私有 Blob。运行存储只接受 `auth/` 和 `training/`，不会把记录写进 Git 书库。手机需要能访问的 HTTPS 站点。浏览器菜单可将训练页面添加到主屏幕；manifest 提供独立窗口和图标，当前版本仍需联网，没有离线缓存训练资料。

本工作副本目前尚未设置管理员。首次使用请在交互终端执行 `npm run setup-admin`，自行输入用户名和至少 12 字符的密码（不回显），再重启服务。该命令只在本机 `.env.local` 保存密码哈希，即使书库配置为 Blob，也不会将凭据上传到 Blob。

可选环境变量（只放在服务器，不能使用 `NEXT_PUBLIC_`）：

```dotenv
OPENAI_API_KEY=你的服务器密钥
TRAINING_AI_MODEL=gpt-4.1-mini
```

没有密钥时禁用 AI 按钮，其他训练功能可用。一次请求最多 6 帧、每帧 JPEG 350 KB、总 JSON 3 MB。只发送所选画面、练习项目和教练备注；不发送原视频。`store:false` 关闭响应对象存储，不表示供应商零留存；服务费用与数据处理以供应商设置为准。超时、拒答、额度不足、错误帧索引和未完成结果都会显示可恢复错误，不自动采用建议。

官方接口依据：[图像输入](https://developers.openai.com/api/docs/guides/images-vision)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。浏览器姿态引擎固定 MediaPipe Tasks Vision 0.10.32；`predev` / `prebuild` 从已安装依赖复制静态 WASM，不在构建时下载模型。

姿态权重默认从 Google 官方地址读取。若浏览器无法访问，可将同一权重放在自己的静态地址并配置 `TRAINING_POSE_MODEL_URL`（浏览器可公开读取，不能带秘密凭证；站内路径须含部署子路径）。本机也可放在 `public/training-vision/pose_landmarker_lite.task`，系统会优先使用本站文件。本工作副本已下载一份用于本地计算验证；该生成目录被 Git 忽略，云端部署需单独准备模型文件或镜像地址。

官方文件：[Pose Landmarker Lite float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)，SHA-256 为 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`。可用以下命令准备本机权重（先执行 `npm run predev` 建立目录）：

```bash
curl --fail --location https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task --output public/training-vision/pose_landmarker_lite.task
```

## 导入格式

Hevy 需要 `title,start_time,exercise_title,set_index`，可读取 `end_time,description,exercise_notes,set_type,weight_kg/weight_lbs,reps,distance_km/distance_miles,duration_seconds,rpe`。日期支持 `5 Oct 2026, 17:00`（英文月份，可含秒）和 `2026-10-05 17:00:00`。

Strong 需要 `Date,Workout Name,Exercise Name,Set Order`；可读取 `Duration/Workout Duration,Weight,Weight Unit,Reps,Distance,Distance Unit,Seconds,Notes,Workout Notes,RPE`。逗号和分号、引号转义、字段内换行、BOM/CRLF 均可解析。日期支持 `YYYY-MM-DD HH:mm[:ss]`；含糊日期如 `03/04/26` 拒绝。训练时长如 `30m` 或 `1h 20m` 与单组 `Seconds` 分别保存。

通用 JSON 示例（自定义格式，不是训记官方导出格式）：

```json
{
  "version": 1,
  "source": "generic-json",
  "workouts": [{
    "date": "2026-10-05T17:00:00+08:00",
    "title": "健身 A",
    "durationSeconds": 1800,
    "exercises": [{
      "name": "已掌握的划船动作",
      "sets": [{ "index": 1, "weightKg": 12, "reps": 8, "rpe": 7 }]
    }]
  }]
}
```

## 数据与权限

- 状态 JSON 有版本检查；旧页面保存返回冲突并保留草稿，先另存草稿再读取最新版本。每次替换已保存状态前保留历史文件。本地写入在单个 Node 进程内串行；共享本地目录的多个独立服务进程需要额外锁/数据库，当前不支持。Blob 写入使用 ETag 条件写。
- 复盘和训练表单分别提交；底部保存按钮保存个人资料、导入记录和计划等更改。退出、书架导航、读取最新资料和恢复会保护未提交输入。“另存当前草稿”额外包含未提交表单的 `uiDrafts`，不把它们伪装为完成记录；恢复预览可展开查看这些草稿，再补回对应表单。服务器恢复只处理已保存记录。
- API 和媒体授权入口每次核验管理员会话，写操作检查 `APP_URL` Origin。素材使用 UUID 固定路径，限制类型、文件头与大小，不放进公开书库媒体。可上传短 MP4/MOV/WebM；HEVC 等编码取决于浏览器，可导出 H.264 MP4。
- 本地 Range 读取退出后立即拒绝。Blob 视频授权入口签发绑定单素材的 60 秒读取链接；已签出的链接退出后最多仍有效 60 秒。链接不写入状态或导出。云端浏览器播放、跨域选帧、签名到期和上传完成回调需用实际 Blob 环境验证。
- 训练导出是记录及素材索引 JSON，**不含视频**。完整本地备份须另外复制 `DATA_DIR/training/media/`，并保留相匹配的索引。恢复保留缺失媒体引用并提示重新关联；不会修改原书或从 JSON 中导入远程素材路径。
- 状态上限为 2 MB；带索引/草稿的记录备份上限为 4 MB，普通页面和损坏文件恢复入口使用相同限制。损坏的状态文件会进入专门的恢复界面，按原始文件版本校验并保留损坏原件，不静默覆盖为空资料。
- 正文来源卡保留原书页码与链接，标记 OCR 尚未逐字校订。健身模板是可调整的起步组合，依据填写的器械选择；不能由录像直接推出某块肌肉薄弱。

## 验证

运行 `npm run check`、`npm test`、`npm run check-content`、`npm run build`。本机书库校验可显式用 `STORAGE_DRIVER=local VERCEL=0 npm run check-content`。HTTP 集成测试只针对一次性本地数据目录，配置 `TRAINING_HTTP_TEST_BASE_URL` 与测试账号后运行 `node --conditions=react-server --import tsx --test tests/training-http.test.ts`；不要对日常训练数据运行写入型测试。
