# Sprite Forge — 扩展设计文档

> 本文件是项目的**唯一设计文档**。
> 记录当前已实现的完整功能，并规划后续扩展方向。

---

## 1. 项目定位

Sprite Forge 是一个面向游戏开发者的精灵图（Spritesheet）生成工具，支持从视频和图片源中提取帧/图块，经去背景、去水印等处理后，打包为多种游戏引擎格式的精灵图。

**四条独立工作流**：

| 工作流 | 输入 | 核心能力 |
|---|---|---|
| **视频处理** | 单个 MP4/WebM | 手动/自动截帧 → 去水印 → 去背 → 打包 |
| **提取要素** | 多张白底精灵图 | 自动检测分割 → 裁切 → 去背 → 打包 |
| **多视频合成** | 多个视频源 | 各自截帧 → 跨视频对齐 → 去背 → 合成打包 |
| **图片处理** | 单张 PNG/JPG/WebP | 一键去背景（四种模式）/ 框选去水印，即传即得 |

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────┐
│            Browser  (React SPA, Vite dev server)         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Upload → Capture → Frames → Process → Result      │  │
│  │  ImageUpload → ImageSegments → ImageResult          │  │
│  │  MultiVideoCompose (多视频拼帧)                     │  │
│  │  ImageTools (图片处理)                              │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────┬────────────────────────────────────┘
                      │ HTTP + WebSocket
                      │ (dev: vite proxy → :8000)
                      ▼
┌──────────────────────────────────────────────────────────┐
│            FastAPI single process (uvicorn :8000)        │
│  /api/videos              视频 CRUD + 截帧               │
│  /api/images              图片 CRUD + 分割检测            │
│  /api/images/{id}/process 图片去背/去水印                 │
│  /api/jobs                视频处理任务                    │
│  /api/image-jobs          图片切片任务                    │
│  /api/frame-assembly-jobs 多视频合成任务                  │
│  /api/runtime/clear       清理运行时数据                  │
│  /ws/jobs/{id}            视频任务进度推送                │
│  /files/...               静态文件                       │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │  worker (asyncio BackgroundTasks, 同进程)          │   │
│  │   ffmpeg 截帧 → cv2.inpaint → rembg → Pillow pack │   │
│  │   图片裁切 → rembg → Pillow pack                   │   │
│  │   多视频截帧 → rembg → 偏移对齐 → pack             │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  本地文件系统  (data/)                                   │
│    uploads/<video_id>/   source.mp4 + meta.json + thumbs │
│    images/<image_id>/    source.png + meta.json          │
│    jobs/<job_id>/        job.json + frames/* + sheet.png │
│    image_jobs/<job_id>/  job.json + items/* + sheet.png  │
│    tmp/                  临时文件(启动时清理)             │
└──────────────────────────────────────────────────────────┘
```

### 2.1 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | React 18 + Vite + TypeScript | 标准生态 |
| 样式 | Tailwind CSS 3.4 | 原子化 CSS，开发效率高 |
| 客户端状态 | useState + SessionStorage + SWR | 轻量，不上全局状态管理 |
| 时间轴交互 | 原生 `<video>` + Canvas + 自写 Timeline 组件 | 不引第三方库 |
| 后端 | Python 3.11+ + FastAPI + uvicorn | rembg/OpenCV/ffmpeg 全在 Python |
| 持久化 | **本地文件系统**（无 DB） | 当前规模够用 |
| 异步任务 | FastAPI `BackgroundTasks` + asyncio | 不上 Celery/RQ |
| 启动器 | 根 `package.json` + `concurrently` | 一条命令同时起前后端 |
| 截帧 | ffmpeg / ffprobe（系统命令） | 标配 |
| 去背景 | `rembg`（u2net）+ OpenCV 白底/纯色模式 | 四种模式覆盖主流场景 |
| 去水印 | `cv2.inpaint`（TELEA 算法） | 静态 mask，快速有效 |
| 精灵表 | Pillow 等大网格拼接 | 简单可靠 |
| 光照归一化 | OpenCV LAB 色彩空间分析 | 中值亮度估计 + 逐帧校正 |

**前置依赖**：Node.js 18+ / Python 3.11+ / ffmpeg（系统安装）

### 2.2 启动方式

```bash
# 一次性安装
npm run setup        # 装前后端 + pip 依赖

# 开发模式 (vite :6284 + uvicorn :8000 --reload)
npm run dev

# 生产模式 (vite 构建后, uvicorn 单进程同时服务前后端)
npm run build && npm start
```

---

## 3. 四条工作流详解

### 3.1 视频处理工作流（6 步）

```
[1] 上传 mp4/webm
       │
       ▼
[2] 时间轴 + 截帧（手动标记 / 自动按帧数或步长）
       │
       ▼
[3] 帧列表预览（缩略图栅格，可删/拖拽调序）
       │
       ▼
[4] 处理设置（去背模式 + 水印框选 + 布局参数）
       │
       ▼
[5] 后台处理（extract → inpaint → rembg → pack）
       │
       ▼
[6] 结果页（精灵图预览 + 逐帧偏移 + 光照归一化 + 导出）
```

**步骤 1 — 上传**
- 前端：拖拽区 + file input，支持 mp4/webm，显示上传进度条
- 后端：流式写入 `data/uploads/<video_id>/source.mp4`，ffprobe 提取元数据写入 `meta.json`
- 约束：单文件 500MB 上限，不做转码

**步骤 2 — 截帧**
- 手动模式：Space 键标记当前帧，←/→ 帧步进（1/30s）
- 自动模式：按帧数（如 12 帧均匀分布）或按步长（如每 500ms）自动生成时间戳
- 前端 Canvas 抓帧用于预览，后端 ffmpeg 重抓保证质量

**步骤 3 — 帧列表**
- 栅格展示缩略图，显示时间戳（MM:SS.mmm）
- 拖拽排序、点击跳转、单帧/清空删除

**步骤 4 — 处理设置**
- 去背景：关闭 / standard / conservative / white
- 去水印：在帧上框选矩形区域（归一化坐标 0-1）
- 布局：列数（1-32，默认 4）、内边距（0-20px，默认 2）

**步骤 5 — 后台处理**
- Worker 流水线：extract → inpaint → rembg → pack
- WebSocket 实时推送进度（stage + progress 0-1）

**步骤 6 — 结果页**
- 精灵图网格预览
- 逐帧 X/Y 偏移微调（±nudge 按钮 + 手动输入）
- 拖拽排序帧顺序
- 光照归一化后处理
- 逐帧动画播放（160ms/帧）
- 多格式导出（见第 7 节）

### 3.2 提取要素工作流（4 步）

```
[1] 上传多张白底精灵图
       │
       ▼
[2] 自动检测分割（蓝色边界叠加层）
       │
       ▼
[3] 后台处理（crop → rembg → pack）
       │
       ▼
[4] 结果页（排序 + 播放 + 导出）
```

**步骤 1 — 上传**
- 支持多文件同时上传（PNG/JPG/WebP）
- 展示已上传图片网格，可单独删除

**步骤 2 — 分割检测**
- 后端自适应阈值 + 形态学操作 + 轮廓检测 + 边界合并
- 前端叠加蓝色边界框预览，Tab 切换多张图片
- 配置列数和内边距

**步骤 3 — 后台处理**
- 裁切各分割区域 → 白底去背 → 等大网格打包

**步骤 4 — 结果页**
- 与视频结果页功能一致：排序、删除、播放、导出

### 3.3 多视频合成工作流（5 步）

```
[1] 上传多个视频
       │
       ▼
[2] 各视频分别截帧
       │
       ▼
[3] 跨视频对齐校准（X/Y 偏移 + 实时叠加预览）
       │
       ▼
[4] 后台处理（extract → rembg → offset → pack）
       │
       ▼
[5] 结果页（排序 + 播放 + 导出）
```

**对齐校准**：选择基准视频和目标视频，调整 X/Y 偏移，`mix-blend-multiply` 实时叠加预览对齐效果。偏移量写入 `FrameSource`，后端打包时应用。

### 3.4 图片处理工作流（3 步）

```
[1] 上传一张或多张图片（PNG/JPG/WebP）
       │
       ▼
[2] 逐张选择处理方式（去背景 / 框选去水印）
       │
       ▼
[3] 处理并对比原图，一键下载 PNG
```

**处理方式**
- 去背景：四种模式——`standard`（rembg 主体分割）/ `conservative`（保留光效）/ `white`（仅纯白底）/ `solid`（任意纯色底）
- 去水印：`BoxSelector` 框选水印区域（归一化坐标），后端 `cv2.inpaint`（TELEA）修复

**实现说明**
- 单请求同步处理（`POST /api/images/{id}/process`，`asyncio.to_thread` 卸载重活），无后台任务/进度条，即传即得
- 结果以 `data/images/<image_id>/<operation>-<timestamp>.png` 落盘，经 `/files/images/...` 返回 URL

---

## 4. API 契约

### 4.1 端点列表

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/api/videos` | 上传视频，流式写入，返回 `{ video_id, duration_ms, fps, width, height, url }` |
| `GET` | `/api/videos/{id}` | 查询视频元数据 |
| `GET` | `/api/videos/{id}/source` | 返回原始视频文件流 |
| `DELETE` | `/api/videos/{id}` | 删除视频及关联 job |
| `POST` | `/api/videos/{id}/frames` | 按时间戳列表截帧，返回缩略图 URL 列表 |
| `POST` | `/api/images` | 上传图片，返回 `{ image_id, width, height, url }` |
| `GET` | `/api/images/{id}` | 查询图片元数据 |
| `GET` | `/api/images/{id}/source` | 返回原始图片文件流 |
| `DELETE` | `/api/images/{id}` | 删除图片及关联 image-job |
| `POST` | `/api/images/{id}/segments:detect` | 自动检测图块边界，返回 `{ segments: [{index, box}] }` |
| `POST` | `/api/images/{id}/process` | 图片去背景/去水印（同步），返回 `{ result_url, width, height }` |
| `POST` | `/api/jobs` | 提交视频处理任务，返回 `{ job_id, status }` |
| `GET` | `/api/jobs/{id}` | 查询任务状态、进度、结果 URL |
| `DELETE` | `/api/jobs/{id}` | 删除任务及产物 |
| `POST` | `/api/jobs/{id}/normalize-lighting` | 光照归一化后处理 |
| `POST` | `/api/jobs/{id}/frames:repack` | 重排帧顺序 + 应用逐帧偏移，重新打包 |
| `GET` | `/api/jobs/{id}/export.zip` | 导出 ZIP，query param `?target=` 选择格式 |
| `POST` | `/api/image-jobs` | 提交图片切片任务 |
| `GET` | `/api/image-jobs/{id}` | 查询图片任务状态 |
| `POST` | `/api/image-jobs/{id}/items:repack` | 重排图块顺序，重新打包 |
| `GET` | `/api/image-jobs/{id}/export.zip` | 导出图片任务 ZIP |
| `POST` | `/api/frame-assembly-jobs` | 提交多视频合成任务 |
| `POST` | `/api/runtime/clear` | 清理所有运行时数据（uploads/jobs/tmp） |

### 4.2 WebSocket 协议

**`/ws/jobs/{job_id}`** — 视频/合成任务进度推送

服务端每 0.5s 轮询 job 状态，发送 JSON 事件：

```json
{
  "stage": "rembg",       // extract | inpaint | rembg | pack | done
  "progress": 0.65,       // 0.0 ~ 1.0
  "status": "running",    // pending | running | done | failed
  "error": null           // 失败时为错误信息字符串
}
```

> **已知差距**：图片任务（image-jobs）缺少对应的 WebSocket 端点 `/ws/image-jobs/{id}`，前端目前通过 SWR 轮询（1s 间隔）获取状态。见扩展路线图 Phase 1。

### 4.3 错误码

| 状态码 | 含义 |
|---|---|
| `400` | 参数校验失败 |
| `404` | 资源不存在 |
| `413` | 文件超出 500MB 限制 |
| `500` | 服务端未处理异常 |

---

## 5. 数据模型

### 5.1 Pydantic 模型概览

**请求模型**：
- `CreateJobRequest` — video_id, timestamps_ms, remove_bg, remove_bg_mode, watermark_box?, layout
- `CreateImageJobRequest` — images (ImageEntry[]), remove_bg, layout
- `CreateFrameAssemblyJobRequest` — frames (FrameSource[]), remove_bg, remove_bg_mode, layout
- `RepackJobFramesRequest` — frame_names (string[]), frame_offsets ({name: {x, y}})
- `RepackImageJobItemsRequest` — item_names (string[])

**枚举**：
- `JobStatus` — `pending` | `running` | `done` | `failed`
- `RemoveBgMode` — `standard` | `conservative` | `white` | `solid`

**核心数据结构**：
- `WatermarkBox` — 归一化坐标 `{x, y, w, h}`，范围 0-1
- `Layout` — `{cols: 1-32, padding: 0-20}`
- `FrameSource` — `{video_id, ts_ms, x_offset, y_offset}`
- `SegmentBox` — `{x, y, w, h}`，整数像素坐标
- `ImageEntry` — `{image_id, boxes: SegmentBox[]}`

### 5.2 文件系统布局

```
data/
  uploads/
    <video_id>/          # 8字符 UUID 前缀
      source.mp4
      meta.json          # id, filename, duration_ms, fps, width, height, created_at
      thumbs/            # 帧预览缩略图
  images/
    <image_id>/
      source.png
      meta.json          # id, filename, width, height, created_at
  jobs/
    <job_id>/            # j_ 前缀
      job.json           # 状态单一事实源
      frames/
        0001.png         # 处理后的帧
        0002.png
        ...
      spritesheet.png
      spritesheet.json
  image_jobs/
    <job_id>/            # ij_ 前缀
      job.json
      items/
        0001.png         # 切割后的图块
        ...
      spritesheet.png
      spritesheet.json
      manifest.json
  tmp/                   # 临时文件，启动时清理
```

### 5.3 关键 JSON Schema

**`meta.json`**（视频）：
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

**`job.json`**：
```json
{
  "id": "j_a91c...",
  "video_id": "v_8f3a...",
  "status": "done",
  "progress": 1.0,
  "stage": "pack",
  "params": {
    "timestamps_ms": [120, 480, 920],
    "remove_bg": true,
    "remove_bg_mode": "standard",
    "watermark_box": { "x": 0.05, "y": 0.05, "w": 0.2, "h": 0.08 },
    "layout": { "cols": 4, "padding": 2 }
  },
  "result": {
    "spritesheet_url": "/files/jobs/j_a91c.../spritesheet.png?v=2",
    "frame_count": 3
  },
  "error": null,
  "created_at": "2026-05-06T12:35:10Z",
  "finished_at": "2026-05-06T12:35:42Z"
}
```

**`spritesheet.json`**：
```json
{
  "image": "spritesheet.png",
  "frame_size": { "w": 256, "h": 256 },
  "padding": 2,
  "cols": 4,
  "rows": 1,
  "frames": [
    { "index": 0, "x": 0,   "y": 0, "w": 256, "h": 256 },
    { "index": 1, "x": 258, "y": 0, "w": 256, "h": 256 }
  ]
}
```

**约定**：
- `job.json` 是状态的**单一事实源**，WS 推送也读自这里
- 写入用**临时文件 + rename**（`job.json.tmp` → `job.json`），保证原子性
- 同一 job 只有一个 worker 写，无并发冲突

---

## 6. 媒体处理模块

所有模块位于 `services/api/forge_api/media/`。

### 6.1 extract.py — 视频截帧

- `get_video_info(path)` — ffprobe 读取 duration/fps/dimensions
- `extract_frame(path, ts_ms, width?, height?)` — ffmpeg 单帧截图，两种 seek 策略回退
- `extract_frame_with_retry(path, ts_ms)` — 最多尝试 6 个偏移量，保证取到有效帧
- `save_frame_preview(path, frame, max_width=320)` — 缩放保存预览图

### 6.2 inpaint.py — 去水印

- `build_mask(width, height, watermark_box)` — 从归一化坐标生成二值 mask
- `inpaint_frame(frame, mask)` — `cv2.inpaint(frame, mask, 3, INPAINT_TELEA)`

### 6.3 remove_bg.py — 去背景（四种模式）

| 模型 | 原理 | 适用场景 |
|---|---|---|
| `standard` | rembg u2net 模型 | 通用，背景较均匀 |
| `conservative` | rembg + alpha matting + 红色效果保护 | 需要保留光效/发光/红色特效 |
| `white` | 纯 OpenCV：边缘采样 → LAB 距离 → 形态学 → 连通域分析 | 白底精灵图 |
| `solid` | 纯 OpenCV：边缘 Lab 统计 → 主体核心掩码（连通域面积保护）→ 色距渐变 alpha + 高斯羽化 + 绿边抑制 | 任意纯色背景，被主体包围的背景色（发丝间隙）也能去除 |

`white` 模式关键参数：
- `BG_DELTA_THRESHOLD = 30` — LAB 色差阈值
- `MIN_CONTOUR_AREA = 50` — 最小轮廓面积
- `SATURATION_THRESHOLD = 40` — 饱和度阈值（排除非白色高亮区域）

### 6.4 pack.py — 精灵图打包

- `pack_grid(frames, cols, padding)` — 等大网格排列，cell 尺寸 = 所有帧最大 bbox
- 返回 `(PIL.Image, dict_metadata)`

### 6.5 segment.py — 图片分割检测

- `detect_segments(image_path)` — 自适应阈值 → 形态学操作（close/open/dilate）→ 轮廓检测 → 边界合并（20px 间距阈值）→ 排序
- 返回 `SegmentBox[]`

### 6.6 lighting.py — 光照归一化

- `estimate_target_lighting(frames)` — 在 LAB 色彩空间计算所有帧 L 通道的中值均值和标准差
- `normalize_frame_lighting(frame, target_mean, target_std)` — 逐帧校正，scale 限制 0.85-1.25，shift 限制 ±24

---

## 7. 导出系统

支持 6 种导出目标，通过 `?target=` 参数选择：

| 目标 | 产出文件 | 说明 |
|---|---|---|
| `generic` | spritesheet.png + spritesheet.json + 全部帧 PNG | 默认，通用格式 |
| `frames` | 仅帧 PNG 文件 | 只要单帧素材 |
| `gif` | animated.gif | 透明 GIF，160ms/帧（~6.25fps），256 色调色板 |
| `cocos` | spritesheet.png + .plist + animation.json | Cocos Creator plistlib 格式 3 |
| `unity` | spritesheet.png + .spriteforge.json + Editor/SpriteForgeImporter.cs | 完整 C# AssetPostprocessor，自动配置切片 + AnimationClip |
| `godot` | spritesheet.png + .json + sprite_frames.tres | Godot 4 SpriteFrames 资源 + AtlasTexture 子资源 |

**Unity 导入器**（`SpriteForgeImporter.cs`）：
- 自动识别 `.spriteforge.json` 文件
- 配置 TextureImporter 的 sprite 模式、pivot、每单位像素数
- 按 spritesheet 元数据切片
- 从帧列表创建 `AnimationClip`（12fps）

---

## 8. 前端架构

### 8.1 路由表

| 路径 | 页面 | 工作流 |
|---|---|---|
| `/` | Home | 入口，四条工作流选择卡片 |
| `/video` | Upload | 视频上传 |
| `/capture/:videoId` | Capture | 时间轴截帧 |
| `/frames/:videoId` | Frames | 帧列表预览/排序 |
| `/process/:videoId` | Process | 处理设置 |
| `/result/:jobId` | Result | 视频结果页 |
| `/image` | ImageUpload | 多图上传 |
| `/image/segments` | ImageSegments | 分割检测确认 |
| `/image/result/:jobId` | ImageResult | 图片结果页 |
| `/image-tools` | ImageTools | 图片处理（去背景/去水印） |
| `/multi-video` | MultiVideoCompose | 多视频合成 |

### 8.2 状态管理

- **SessionStorage** — 工作流状态持久化（`WorkflowState` / `ImageWorkflowState`），跨页面导航时保留进度
- **SWR** — 结果页数据轮询（job 运行中 1s 间隔，完成后停止）
- **useState/useReducer** — 页面内局部状态

### 8.3 关键组件

| 组件 | 职责 |
|---|---|
| `Header` | 导航栏，切换工作流时清理状态 |
| `Footer` | 版权信息 |
| `Layout` | Header + Outlet + Footer 布局容器 |
| `PageShell` | 页面骨架（标题/描述/返回/操作区），所有页面统一入口 |
| `ThemeToggle` | 明/暗主题切换（localStorage + matchMedia） |
| `ui/*` | 设计系统原语：Button/Card/Badge/Input/Select/Steps/ProgressBar/EmptyState/Icon |
| `Timeline` | 可拖拽时间轴，支持帧标记点、触摸 |
| `BoxSelector` | 图片上绘制矩形选区（鼠标/触摸），返回归一化坐标 |

### 8.4 关键 Hooks

| Hook | 职责 |
|---|---|
| `useVideoFrame` | 视频播放/暂停/帧步进/Canvas 抓帧 |
| `useSortableList` | 可拖拽排序列表（HTML5 DnD） |
| `useJobProgress` | WebSocket 进度 hook（当前无页面引用，页面各自内联 WS；其 `/ws/image-jobs/{id}` 分支对应端点未实现） |

### 8.5 工具函数

| 模块 | 功能 |
|---|---|
| `format.ts` | 时间格式化（MM:SS.mmm / MM:SS） |
| `timestamps.ts` | 帧时间戳生成（按数量/按步长，上限 120 帧） |
| `workflowState.ts` | 视频工作流 SessionStorage 状态管理 |
| `imageWorkflowState.ts` | 图片工作流 SessionStorage 状态管理 |
| `stageLabels.ts` | 阶段中文标签映射 |

---

## 9. 已知局限与显式遗留

| 问题 | 说明 | 计划 |
|---|---|---|
| **断点恢复** | 重启 uvicorn 丢正在跑的 job（BackgroundTasks 不持久化） | Phase 3 任务队列解决 |
| **并发控制** | 单用户假设，多 job 并发时串行执行 | Phase 3 独立 worker |
| **图片任务 WebSocket** | 缺少 `/ws/image-jobs/{id}` 端点，前端依赖轮询 | Phase 1 补齐 |
| **跨浏览器** | 仅测 Chrome/Edge/Safari，Firefox video canvas 可能有性能问题 | 待测试 |
| **移动端** | 不支持 | 当前非目标 |
| **国际化** | UI 文案中文，无 i18n | Phase 3 |
| **零测试覆盖** | 无任何自动化测试 | Phase 1 补齐 |
| **无容器化** | 无 Docker / CI/CD | Phase 1 补齐 |

---

## 10. 扩展路线图

### Phase 1：工程质量补齐

**测试策略**
- `media/*` 模块单元测试（pytest）：extract 的 ffmpeg 调用 mock、remove_bg 各模式的输入输出、pack 的网格计算、segment 的边界检测
- API 集成测试（httpx + pytest-asyncio）：上传 → 创建 job → 轮询完成 → 验证产物
- 前端关键路径 smoke test（Playwright）：视频工作流端到端

**Docker 化**
- `Dockerfile`：Python 3.11 + ffmpeg + Node.js 构建前端 + uvicorn 启动
- `docker-compose.yml`：单服务（后续可加 MySQL / Redis）
- `.dockerignore`：排除 `data/`、`node_modules/`、`.git/`

**CI/CD**
- GitHub Actions workflow：lint → test → build
- 前端：`tsc --noEmit` + `vite build`
- 后端：`pytest` + `ruff check`

**图片任务 WebSocket**
- 在 `main.py` 新增 `/ws/image-jobs/{job_id}` 端点
- 复用现有 WS 轮询逻辑

### Phase 2：功能增强

**Tight Packing**
- 引入 MaxRects 或 Skyline 装箱算法
- 替换当前等大网格，减少精灵图空白区域
- `pack.py` 内部替换，API 和前端 layout 参数保持兼容

**视频去水印（高级）**
- 接入 ProPainter / STTN 等时序视频修复模型
- 替代当前静态 mask + cv2.inpaint
- 作为可选模式，与现有模式并存

**精修功能**
- 羽化边缘（alpha feathering）
- 锚点标记（sprite origin/pivot）
- 碰撞盒标注
- 脚底对齐（foot alignment）

**批量处理**
- 多 job 队列管理
- 模板保存/复用（固定的 layout + 去背 + 水印配置）

### Phase 3：平台化

**数据库迁移**
- 引入 MySQL，`store.py` 内部切到 SQLAlchemy
- 触发条件：job 数破 10 万 / 需要跨 job 复杂查询 / 多用户
- 迁移路径：`meta.json` / `job.json` 字段一一映射到表，文件路径列存

**鉴权 / 多租户**
- API Key 或 JWT 中间件
- `user_id` 字段关联 job

**独立 Worker 进程**
- 抽出 queue 抽象（Redis + RQ / Celery）
- 支持断点恢复和并发控制
- Worker 进程可独立扩缩

**国际化（i18n）**
- 前端文案提取到 locale 文件
- 支持中/英文切换

---

## 11. 模型协作分工

| 任务 | 模型 |
|---|---|
| 设计文档维护、API 契约、job.json schema、worker 编排、WS 协议、code review | **Sonnet 4.6** |
| `media/extract.py` / `inpaint.py` / `remove_bg.py` / `pack.py` / `segment.py` / `lighting.py` | **MiMo-v2.5-Pro** |
| `Timeline.tsx` / `BoxSelector.tsx` / `useVideoFrame.ts`（交互密集） | **Sonnet 4.6** |
| `Upload.tsx` / `Frames.tsx` / `Result.tsx` / `ImageUpload.tsx`（标准件） | **Haiku 4.5** |
| 根 `package.json` / `vite.config.ts` / `requirements.txt` / 中文 README | **MiMo-v2.5** |
| 单测（`media/*` 与 API 路由） | **Haiku 4.5** |
| Dockerfile / CI 配置 | **MiMo-v2.5** |

**单源原则**：本文件、API 契约、`job.json` schema、`vite.config.ts` proxy 由 Sonnet 4.6 主笔。
**先契约后实现**：跨模块接口 Sonnet 4.6 先定下，其他模型据此并行实现。

---

## 12. 验证清单

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | 视频正向流程 | 上传 30s mp4 → 标 12 帧 → 去背+去水印 → 30s 内拿到精灵图 |
| 2 | 预览速度 | 时间轴拖动 Canvas 缩略图 < 100ms 响应 |
| 3 | 进度反馈 | 12 帧 job，WS 推送 ≥ 12 次，进度条平滑 |
| 4 | 失败可见 | 损坏 mp4 → 400 或 job FAILED + ffmpeg stderr 透出 |
| 5 | 生产模式 | `npm run build && npm start` → :8000 单端口完整可用 |
| 6 | 图片切片流程 | 上传白底精灵图 → 自动检测 → 去背打包 → 导出 |
| 7 | 多视频合成 | 2 个视频各自截帧 → 对齐校准 → 合成打包 → 导出 |
| 8 | GIF 导出 | 导出透明 GIF，帧率正确（~6.25fps），可播放 |
| 9 | 引擎导出 | Cocos plist / Unity C# importer / Godot tres 格式正确可导入 |
| 10 | 光照归一化 | 处理前后帧亮度一致性明显改善 |

