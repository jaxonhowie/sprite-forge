# Sprite Forge — MVP 设计

> 本文件是当前**唯一**的设计文档。先做能跑通的最小版本,跑通再迭代。

---

## 1. MVP 范围

**做什么(5 步工作流)**:

```
[1] 上传 mp4
       │
       ▼
[2] 时间轴 + 手动截关键帧 (浏览器原生 <video> + canvas 预览)
       │
       ▼
[3] 关键帧列表 (缩略图栅格,可删/调序)
       │
       ▼
[4] 去背景 (rembg) + 去水印 (用户框选 mask + cv2.inpaint)
       │
       ▼
[5] 导出精灵表 (PNG + JSON,等大网格布局)
```

**不做什么**(明确砍掉,避免范围漂移):

- ❌ 自动抽帧(均匀/关键帧/动作检测)— 全靠用户手动
- ❌ SAM2 / 复杂抠图模式 — 只 rembg
- ❌ 视频去水印(逐帧时序模型)— 只 cv2.inpaint + 静态 mask
- ❌ 精修(羽化/锚点/碰撞盒/脚底对齐)
- ❌ Tight Packing — 只等大网格
- ❌ Unity / Cocos 引擎导出 — 只 PNG + JSON
- ❌ 数据库 — 纯文件系统(若未来必须用,选 MySQL)
- ❌ Docker / Kubernetes — `npm run dev` 起开发,`npm start` 起生产
- ❌ Tauri / 桌面壳 — 纯浏览器
- ❌ 鉴权 / 多租户 — 单用户/小团队内网
- ❌ 插件化、DAG、CAS、capability worker、Redis、Postgres、MinIO

---

## 2. 系统架构(单图)

```
┌──────────────────────────────────────────────────────────┐
│            Browser  (React SPA, Vite dev server)         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Upload   →   TimelineCapture   →   FrameGrid      │  │
│  │                     ↑↓                             │  │
│  │              <video> + canvas                      │  │
│  │                                                    │  │
│  │  ProcessForm (rembg ✓ / watermark box) → Result    │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────┬────────────────────────────────────┘
                      │ HTTP + WebSocket
                      │ (dev: vite proxy → :8000)
                      ▼
┌──────────────────────────────────────────────────────────┐
│            FastAPI single process (uvicorn :8000)        │
│  /api/videos      上传 + ffprobe 读元数据                │
│  /api/jobs        提交处理任务 (BackgroundTasks)         │
│  /api/jobs/{id}   查询状态 (读文件)                      │
│  /ws/jobs/{id}    进度推送                               │
│  /files/...       静态文件 (源视频 / 精灵表 / 缩略图)    │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │  worker (asyncio task,同进程)                     │   │
│  │   ffmpeg 截帧 → cv2.inpaint → rembg → Pillow pack │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  本地文件系统  (data/)                                   │
│    uploads/<video_id>/  source.mp4 + meta.json           │
│    jobs/<job_id>/       job.json + frames/* + sheet.png  │
│  无数据库。Job 状态 = job.json 文件。                    │
└──────────────────────────────────────────────────────────┘
```

**启动**(根目录):

```bash
# 一次性
npm run setup        # 装前后端依赖

# 开发模式 (vite dev + uvicorn --reload)
npm run dev

# 生产模式 (vite 构建后,uvicorn 单进程同时服务前后端)
npm run build && npm start
```

---

## 3. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | React 18 + Vite + TypeScript | 标准,生态熟 |
| UI 组件 | shadcn/ui + Tailwind | 开箱即用,样式不内耗 |
| 客户端状态 | useState / useReducer + SWR | MVP 不上 Zustand |
| 时间轴交互 | 原生 `<video>` + Canvas + 自写拖拽 | 不引第三方时间轴库 |
| 后端 | Python 3.11+ + FastAPI + uvicorn | rembg/OpenCV 全在 Python |
| 持久化 | **本地文件系统**(无 DB) | MVP 规模够用;未来必须用 DB → MySQL |
| 异步任务 | FastAPI `BackgroundTasks` + asyncio.Queue | 不上 Celery/RQ |
| 启动器 | 根 `package.json` + `concurrently` | 一条 `npm run dev` 同时起 vite + uvicorn |
| 截帧 | ffmpeg(系统装) | 标配 |
| 去背景 | `rembg`(默认 u2net 模型) | 一行调用 |
| 去水印 | `cv2.inpaint(image, mask, 3, INPAINT_TELEA)` | 静态 mask 即可 |
| 精灵表 | Pillow 等大网格拼接 | 不上装箱算法 |

**前置依赖**(开发机):
- Node.js 18+ / npm 9+
- Python 3.11+ / pip
- ffmpeg / ffprobe(系统命令,如 `brew install ffmpeg`) 

---

## 4. 5 步工作流详解

### 4.1 步骤 1:上传 mp4

**前端**:
- 拖入区 + `<input type="file" accept="video/mp4,video/webm">`,**支持 mp4/webm**(gif 砍掉)。
- multipart 直接上传到 `/api/videos`,显示上传进度。

**后端**:
- 落到 `data/uploads/<video_id>/source.mp4`(`video_id` = uuid4)。
- `ffprobe` 读 `duration_ms` / `fps` / `width` / `height` → 写入 `data/uploads/<video_id>/meta.json`。
- 返回 `{ video_id, duration_ms, fps, width, height, url: "/files/uploads/<id>/source.mp4" }`。

**约束**:
- 单文件上限 500MB(`uvicorn` `--limit-max-requests` + 路由层校验)。
- 不做转码,直接存原始文件。浏览器播不了的格式不在 MVP 考虑。

### 4.2 步骤 2:时间轴 + 手动截关键帧

**前端**:
- `<video src={video.url} ref={videoRef}>`(隐藏控件,自画 UI)。
- **时间轴**:一条横向滚动条 + 当前时间游标。拖动游标 → `videoRef.current.currentTime = t`。
- **预览缩略图**:每次 `currentTime` 变化 → `canvas.drawImage(video, 0, 0)` → 得到 base64 PNG → 渲染到当前帧预览区。**这个缩略图只在前端缓存,不上传**。
- **快捷键**:`←/→` 帧步进(假设 30fps,步进 = `1/30`s);`Space` 标记当前帧;`Delete` 删除选中帧。
- **标记帧**:点"+"按钮或 Space → 把 `{ ts_ms, thumb_dataurl }` push 到本地 frames 数组。

**关键决策:为什么不让后端截帧用作预览?**
- 用户拖时间轴时频繁需要预览,每次打后端会卡。
- 浏览器本身能播 mp4,canvas 抓帧零成本。
- **预览用前端的快帧,最终处理用后端 ffmpeg 重抓一次保证质量** —— 这是 MVP 的关键简化。

**后端**:本步无任何调用。

### 4.3 步骤 3:关键帧列表预览

**前端**:
- 网格展示前端缓存的缩略图(120×68 缩略),每格显示 `ts_ms` 格式化为 `mm:ss.fff`。
- 操作:点击缩略图 → 跳回时间轴对应位置;长按拖拽 → 调整顺序;右键/小叉删除。
- "清空"按钮 + "继续"按钮(进入步骤 4)。

**后端**:本步无任何调用。

### 4.4 步骤 4:去背景 + 去水印

**前端**:
- 三个开关/输入:
  1. ☑ 去背景(rembg)
  2. ☐ 去水印(在某一帧上拖拽框选矩形 → `{ x, y, w, h }`)
  3. 精灵表布局参数:`cols`(默认 8)、`padding`(默认 2px)
- "开始处理"按钮 → `POST /api/jobs`,body:
  ```json
  {
    "video_id": "...",
    "timestamps_ms": [120, 480, 920],
    "remove_bg": true,
    "watermark_box": { "x": 10, "y": 10, "w": 200, "h": 60 },
    "layout": { "cols": 8, "padding": 2 }
  }
  ```
- 收到 `job_id` → 打开 WS `/ws/jobs/{job_id}`,显示进度条 + 当前阶段文字("截帧 3/12"、"去水印 5/12"、"去背景 7/12"、"打包")。

**后端**(单个 BackgroundTask):
```
for ts in timestamps_ms:
    frame = ffmpeg_extract(source.mp4, ts)        # 单帧截图
    if watermark_box:
        mask = build_mask(width, height, watermark_box)
        frame = cv2.inpaint(frame, mask, 3, INPAINT_TELEA)
    if remove_bg:
        frame = rembg.remove(frame)               # 输出 RGBA
    save(data/jobs/<job_id>/frames/{idx:04}.png)
    update_job_json(progress=idx/total, stage=...)
    push_progress_ws(...)

sheet, meta = pack_grid(frames, cols, padding)
save spritesheet.png + spritesheet.json
update_job_json(status='done', finished_at=...)
push final result
```

**关键决策**:
- **静态 mask 应用到所有帧**:MVP 假设水印位置全程不变,这对绝大多数视频水印成立。视频去水印(逐帧 ProPainter/STTN)留给 v2。
- **去水印先于去背景**:水印在背景上,先 inpaint 再抠主体,顺序错了会把水印蒙到主体 alpha 边缘。
- **失败处理**:任一帧失败 → 整个 job 标 FAILED,WS 推错误,**不做单帧重试**(MVP)。

### 4.5 步骤 5:导出精灵表

**spritesheet.png**:RGBA 等大网格。每帧尺寸 = max(所有处理后帧的 bbox)。
**spritesheet.json**:
```json
{
  "image": "spritesheet.png",
  "frame_size": { "w": 256, "h": 256 },
  "padding": 2,
  "cols": 8,
  "rows": 2,
  "frames": [
    { "index": 0, "ts_ms": 120,  "x": 0,   "y": 0, "w": 256, "h": 256 },
    { "index": 1, "ts_ms": 480,  "x": 258, "y": 0, "w": 256, "h": 256 }
  ]
}
```

**前端**:
- 显示 spritesheet.png 预览(可缩放查看)。
- 两个下载按钮:
  - "下载 PNG"→ `/files/jobs/<job_id>/spritesheet.png`
  - "下载 ZIP"→ `/api/jobs/<job_id>/export.zip`(含 png + json)

---

## 5. 文件系统布局(无数据库)

```
data/
  uploads/
    <video_id>/
      source.mp4
      meta.json                # 视频元数据
  jobs/
    <job_id>/
      job.json                 # job 状态 + 参数 + 进度 (单一事实源)
      frames/
        0001.png               # 处理后的关键帧 (rembg/inpaint 之后)
        0002.png
        ...
      spritesheet.png
      spritesheet.json
```

**`meta.json`**(`data/uploads/<video_id>/meta.json`):
```json
{
  "id": "v_8f3a...",
  "filename": "demo.mp4",
  "duration_ms": 30000,
  "fps": 30.0,
  "width": 1920,
  "height": 1080,
  "created_at": "2026-05-06T12:34:56Z"
}
```

**`job.json`**(`data/jobs/<job_id>/job.json`):
```json
{
  "id": "j_a91c...",
  "video_id": "v_8f3a...",
  "status": "running",            // pending | running | done | failed
  "progress": 0.42,
  "stage": "rembg",               // extract | inpaint | rembg | pack
  "params": {
    "timestamps_ms": [120, 480, 920],
    "remove_bg": true,
    "watermark_box": { "x": 10, "y": 10, "w": 200, "h": 60 },
    "layout": { "cols": 8, "padding": 2 }
  },
  "error": null,
  "created_at": "2026-05-06T12:35:10Z",
  "finished_at": null
}
```

**约定**:
- `job.json` 是 job 状态的**单一事实源**。WS 推送的进度也来自这里(内存缓存 + 周期性落盘)。
- 列出所有 job = 扫 `data/jobs/` 子目录,逐个读 job.json(MVP 规模 N < 1000 性能没问题)。
- 写入用 **临时文件 + rename** 模式(`job.json.tmp` → `job.json`),保证读取时永远是完整 JSON。
- 同一 job 只有一个 worker 写,**无并发冲突**。

**未来引入 MySQL 的触发条件**(MVP 不做):
- 单机 job 数破 10 万,扫目录变慢
- 需要跨 job 的复杂查询(如"过去 7 天失败的 job")
- 多用户场景,需要按 user_id 索引

满足任一条件再迁。迁移路径:把 `meta.json` / `job.json` 字段一一映射到 `videos` / `jobs` 表,文件路径列存即可,文件系统层不变。

---

## 6. API 契约

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/api/videos` | 上传 mp4,返回 `{ video_id, duration_ms, fps, width, height, url }` |
| `GET`  | `/api/videos/{id}` | 查询视频元数据(读 `meta.json`) |
| `POST` | `/api/jobs` | 提交处理任务,写 `job.json`,返回 `{ job_id, status: "pending" }` |
| `GET`  | `/api/jobs/{id}` | 查询任务状态(读 `job.json`)+ 结果 url(若 done) |
| `GET`  | `/api/jobs/{id}/export.zip` | 下载 ZIP(spritesheet.png + .json) |
| `GET`  | `/files/{path}` | 静态文件(视频源 / 帧 / 精灵表),由 FastAPI `StaticFiles` 挂载 |
| `DELETE` | `/api/jobs/{id}` | 取消(running 时)/清理产物目录 |
| `WS`   | `/ws/jobs/{id}` | 推送 `{ stage, progress, message }` 事件 |

**错误码**:`400`(参数错)、`404`(资源不存在)、`413`(文件过大)、`500`(后端崩溃)。MVP 不做精细错误码。

**生产模式**(`npm start`):FastAPI 用 `StaticFiles` 把 `apps/web/dist` 挂到根路径 `/`,前后端同进程同端口,无需反代。

---

## 7. 仓库结构

```
sprite-forge/
  package.json                    # 根:concurrently + 启动脚本
  apps/
    web/                          # React SPA
      package.json
      vite.config.ts              # 含 dev proxy:/api → :8000, /ws → :8000, /files → :8000
      src/
        api/                      # fetch 客户端
        pages/
          Upload.tsx              # 步骤 1
          Capture.tsx             # 步骤 2 (timeline + canvas)
          Frames.tsx              # 步骤 3 (frame grid)
          Process.tsx             # 步骤 4 (rembg / watermark form)
          Result.tsx              # 步骤 5 (download)
        components/
          Timeline.tsx
          FrameThumb.tsx
          BoxSelector.tsx         # 拖拽选水印矩形
        hooks/
          useVideoFrame.ts        # canvas 抓帧
          useJobProgress.ts       # WS 订阅
  services/
    api/                          # FastAPI
      requirements.txt
      forge_api/
        main.py                   # FastAPI app + 路由 + StaticFiles 挂载
        models.py                 # Pydantic
        store.py                  # 文件系统读写 (meta.json / job.json)
        worker.py                 # BackgroundTask 实现
        media/
          extract.py              # ffmpeg 截帧
          inpaint.py              # cv2.inpaint
          remove_bg.py            # rembg 封装
          pack.py                 # Pillow 等大网格
  data/                           # 运行时数据 (gitignore)
  docs/
    mvp.md                        # 本文件
```

---

## 8. 启动方式(npm scripts)

**根 `package.json`** 草图:

```json
{
  "name": "sprite-forge",
  "private": true,
  "scripts": {
    "setup": "npm install && npm --prefix apps/web install && pip install -r services/api/requirements.txt",
    "dev": "concurrently -n web,api -c blue,green \"npm run dev:web\" \"npm run dev:api\"",
    "dev:web": "npm --prefix apps/web run dev",
    "dev:api": "uvicorn forge_api.main:app --reload --port 8000 --app-dir services/api",
    "build": "npm --prefix apps/web run build",
    "start": "uvicorn forge_api.main:app --port 8000 --app-dir services/api"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

**开发流程**:
1. 一次性:`npm run setup`(装 npm 依赖 + pip 依赖)
2. 启动:`npm run dev`
   - vite dev 在 `:5173`,通过 vite proxy 把 `/api` `/ws` `/files` 转发到 `:8000`
   - uvicorn 在 `:8000`,`--reload` 监听 Python 文件变化
3. 浏览器打开 `http://localhost:5173`

**生产流程**:
1. `npm run build` → `apps/web/dist` 产出静态文件
2. `npm start` → uvicorn 单进程,`StaticFiles` 挂载 `apps/web/dist` 到 `/`,API 在 `/api` `/ws` `/files`
3. 浏览器打开 `http://localhost:8000`

**`apps/web/vite.config.ts`** 关键配置:

```ts
export default defineConfig({
  server: {
    proxy: {
      '/api':   'http://localhost:8000',
      '/files': 'http://localhost:8000',
      '/ws':    { target: 'ws://localhost:8000', ws: true },
    },
  },
});
```

**前置依赖检查**:
- `node --version` ≥ 18
- `python --version` ≥ 3.11
- `ffmpeg -version` 能跑

如其一缺失,`npm run setup` 失败时给出明确报错(在 setup 脚本里加预检)。

---

## 9. 模型协作分工(MVP 精简版)

| 任务 | 模型 |
|---|---|
| 本文件维护、API 契约、`job.json` schema、worker 编排逻辑、WS 协议、code review | **Sonnet 4.6** |
| `media/extract.py` / `inpaint.py` / `remove_bg.py` / `pack.py`(每个独立小模块) | **MiMo-v2.5-Pro** |
| `Timeline.tsx` / `BoxSelector.tsx` / `useVideoFrame.ts`(交互密集) | **Sonnet 4.6** |
| `Upload.tsx` / `Frames.tsx` / `Result.tsx` / `FrameThumb.tsx`(标准件) | **Haiku 4.5** |
| 根 `package.json` / `vite.config.ts` / `requirements.txt` / 中文 README | **MiMo-v2.5** |
| 单测(`media/*` 与 API 路由) | **Haiku 4.5** |

**单源原则**:本文件、API 契约、`job.json` schema、`vite.config.ts` proxy 由 Sonnet 4.6 主笔。
**先契约后实现**:跨模块接口(API、`job.json` 结构、WS 事件 schema)Sonnet 4.6 先定下,其他模型才据此并行实现。

> MiMo-v2.5 / MiMo-v2.5-Pro 能力剖面为合理推测,有偏差请纠正,本表会刷新。

---

## 10. 验证(MVP 跑通的 5 个场景)

把这套设计当回路图,跑通下面 5 个场景才算 MVP 成立:

1. **正向流程**:`npm run setup && npm run dev` → 浏览器上传 30 秒 mp4 → 拖时间轴标 12 个关键帧 → 勾选去背景 + 框选水印 → 提交 → 30 秒内拿到精灵表 PNG + JSON。
2. **预览速度**:拖动时间轴时,Canvas 缩略图响应延迟 < 100ms(60fps 视频)。
3. **进度反馈**:处理 12 帧的 job,WS 至少推 12 次以上事件,前端进度条平滑。
4. **失败可见**:故意上传一个损坏的 mp4 → API 返回 400 或 job 标 FAILED 并把 ffmpeg stderr 透出到 UI。
5. **生产模式可用**:`npm run build && npm start` → 单端口 `:8000` 同时服务前端和 API → 完整跑通一次正向流程。

---

## 11. MVP → v2 的衔接锚点

为后续演进留的"换装位"(MVP 阶段不实现,但行为先定):

| MVP 简化 | v2 替换路径 |
|---|---|
| 文件系统 + `job.json` | 引入 MySQL,`store.py` 内部切到 SQLAlchemy,API 不变 |
| `BackgroundTasks` + asyncio.Queue | 抽出 `queue` 抽象,可切到 RQ/Celery + Redis |
| `cv2.inpaint` 静态 mask | 接入 ProPainter / STTN 视频去水印模型 |
| 等大网格 | 引入 MaxRects/Skyline 装箱 |
| 仅 PNG+JSON 导出 | 加 Unity (.anim/.meta) / Cocos (.plist/.atlas) handler |
| 内置 rembg 直调 | 抽出 stage handler 协议,rembg 变成可插拔 |
| 单进程 worker | 拆出独立 worker 进程,通过 queue 解耦 |
| 单用户无鉴权 | 加 API Key / JWT 中间件 |
| 浏览器单页 | 同代码可由 Tauri 包装为桌面版 |

**演进原则**:每次只替换一个模块,前端契约不动。MVP 写得越"老实"(不过度抽象),后续替换越容易。

---

## 12. 显式遗留(MVP 不做但要标记)

- **断点恢复**:重启 uvicorn 丢正在跑的 job(BackgroundTasks 不持久化)。
- **并发控制**:MVP 假设单用户;并发提交多个 job 时 BackgroundTasks 会串行跑,不限流。
- **大文件流式上传**:500MB 以下走 multipart,以上不支持(后续上 tus 协议)。
- **跨浏览器**:仅测 Chrome/Edge/Safari;Firefox 的 video canvas drawImage 在某些 codec 下慢,MVP 不优化。
- **移动端**:不做。
- **国际化**:UI 文案先中文;后续上 i18n。
- **环境前置**:开发机必须装 Node 18+ / Python 3.11+ / ffmpeg。setup 脚本做预检并给出明确报错。
