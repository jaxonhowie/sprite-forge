# Sprite Forge 项目评估报告

**评估时间**：2026-07-23  
**评估范围**：全栈代码、算法实现、功能闭环、工程化基础设施  
**评估方式**：静态代码审查 + 关键行源码核对 + `tsc --noEmit` 类型检查 + Git 历史分析

> **更新记录**：2026-08-03 新增第四条工作流「图片处理」（`ImageTools` 页面 + `/api/images/{id}/process` 端点）与 `remove_bg` `solid` 模式重写（渐变 alpha 替代连通域法），本文档已同步修订。
>
> **更新记录**：2026-08-17 复核。期间落地：Lottie（bodymovin JSON）导出格式、图片切片结果页 PNG 逐张直接下载（不再打包 ZIP）、后端 pytest 测试套件（69 个，`services/api/tests/`）。缺陷 #1~#7 已修复（#4 前端半项除外），详见 §5 复核状态与 §6 工程化表格。

---

## 1. 项目概览

| 维度 | 情况 |
|---|---|
| 总提交数 | 29 个（2026-05-06 ~ 2026-08-12） |
| 后端 | FastAPI + OpenCV + Pillow + rembg，约 3,182 行 Python |
| 前端 | React 18 + TypeScript + Vite + Tailwind + SWR，约 5,800 行 TS/TSX |
| 设计文档 | `docs/design.md` 详尽（614 行），已纳入版本控制 |
| 测试 | 后端 pytest 69 个全绿（`services/api/tests/`，2026-08 补齐）；前端测试仍缺失 |
| CI/Lint | **缺失** |

---

## 2. 功能完成度

四条核心工作流均已端到端闭环：

| 工作流 | 页面/模块链路 | 状态 |
|---|---|---|
| 视频 → Sprite Sheet | `Upload` → `Capture` → `Frames` → `Process` → `Result` | 完整，支持 WebSocket 进度 + SWR 结果轮询 |
| 图片切片 | `ImageUpload` → `ImageSegments` → `ImageResult` | 完整，纯 SWR 轮询 |
| 多视频合成 | `MultiVideoCompose` 单页 | 完整，但**无 sessionStorage 持久化**，刷新后状态丢失 |
| 图片处理 | `ImageTools` 单页 | 完整，同步请求即传即得（无后台任务） |
| 光照归一化（后置处理） | `Result` 页操作 | 可用，但失败时被静默吞噬（见缺陷 #3） |

导出系统是完成度最高的模块，支持 7 种格式：`generic` / `frames(items) zip` / `gif` / `lottie`（bodymovin JSON，2026-08-11 新增）/ `cocos plist` / `unity json` / `godot SpriteFrames.tres`。其中 Unity 导出内嵌完整 C# `AssetPostprocessor`，可自动生成 Sprite 切片与 `.anim`；GIF 导出正确处理透明通道（255 色量化 + 调色板透明 + `disposal=2`）；Lottie 导出将每帧 base64 内嵌为图资源、用 opacity hold 关键帧逐帧切换。图片切片结果页另支持 PNG 逐张直接下载（2026-08-12 起不再打包 ZIP）。

---

## 3. 后端算法深度评估

### 3.1 `media/extract.py` — 健壮性最好

- 每帧 spawn 一次 ffmpeg，双 seek 策略回退：前置 `-ss` 快速 seek 失败后转后置 `-ss` 精确解码。
- 失败时向前回退最多 6 帧时长重试并去重。
- 输出有效性校验（> 1024 字节），子进程 30 秒超时。
- cv2 解码失败回退 PIL，tmp 文件 `finally` 清理。
- **代价**：每帧一次进程启动，无批量抽帧，性能朴素但失败路径考虑周到。

### 3.2 `media/segment.py` — 精心调参的启发式

- 边缘采样（边宽 = `min(h,w)*5%`，clamp 2~24 px）。
- Lab 空间中位数估计背景色，P90 偏差自适应阈值 `28 + variance*1.6`（上限 72）。
- 闭运算 15×15 填内部缝隙 + 开运算 3×3 去噪 + 膨胀 5×5。
- `findContours` 外接矩形，面积 < 400 过滤，迭代合并间距 < 20 px 的框。
- Git 历史显示针对“浅色精灵被切碎”真实迭代过三轮（`fc4461c` → `c6e6b3d` → `edc522e`）。
- **局限**：假设背景接触图像边缘且颜色近均匀；贴边精灵会被误当背景；靠得近的独立精灵会被闭运算粘连。

### 3.3 `media/remove_bg.py` — 工程量最大

- `standard`：rembg u2net，全局懒加载 session。
- `conservative`：+ alpha matting（fg 220 / bg 8 / erode 3）+ `_protect_red_effects`（HSV 红色/橙色启发式恢复 alpha 并羽化）。
- `white` / `solid`：纯 CV 经典方法——边缘 Lab/HSV 统计 → 自适应阈值 → 主体保护掩膜 → **LAB 色距渐变 alpha**（与背景色一致的像素直接透明，被主体包围的背景色区域如发丝间隙也能去除；半透明边缘做高斯羽化 + 绿边溢出抑制）→ `solid` 模式 2026-08-03 重写为按连通域面积保护主体核心，不再依赖与图像边缘的连通性。
- **本质仍假设背景近均匀**，对截图类素材可靠，但对复杂背景受限。

### 3.4 `media/pack.py` — 朴素实现

固定网格，cell = 所有帧的 `max_w × max_h`。
- 无 trim、无货架/二叉树装箱、无旋转。
- 同尺寸视频帧无浪费；图片切片尺寸差异大时空间浪费明显。

### 3.5 `media/lighting.py` — 轻量实现

Lab 的 L 通道 mean/std 匹配，目标值取全帧集中位数，scale/shift 有 clamp。
- **缺陷**：统计不按 alpha 加权，透明/背景区域参与均值计算会带偏目标；只调亮度，不处理色度迁移。

### 3.6 `media/inpaint.py` — 最小实现

`cv2.inpaint` TELEA radius 3，掩膜来自用户框。够用，无自适应。

### 3.7 `worker.py` 并发与进度

- `BackgroundTasks` + `asyncio.to_thread` 卸载重活，不阻塞事件循环。
- 进度经 JSON 文件原子写（`tmp + rename`）上报。
- WebSocket `/ws/jobs/{id}` 实为 **0.5 秒轮询文件系统**的拉模型，非事件推送。
- **无队列、无并发上限、无任务取消机制**；删除 RUNNING 任务不会停止后台线程。

---

## 4. 前端质量评估

### 4.1 类型与契约

- `tsc --noEmit` strict + `noUnusedLocals` 全绿。
- 无 `any`、无 `// @ts-ignore`、无 TODO/FIXME 注释。
- API client 覆盖后端全部 24 个 REST 端点，类型与 `models.py` 高度对齐。

### 4.2 核心组件

| 组件/Hook | 评价 |
|---|---|
| `useVideoFrame.ts` | 最深。三重渲染确认 + 50 ms 容差轮询 + duration 三路同步。缺陷：步进硬编码 30 fps，无视实际 fps；`captureFrame` 输出全分辨率 PNG dataURL，是 sessionStorage 配额炸弹的原料。 |
| `Timeline.tsx` | 中上。鼠标/触摸双通道拖拽、window 级事件监听、markers 非法值过滤。缺键盘聚焦与 hover 时间提示。 |
| `BoxSelector.tsx` | 中上。鼠标/触摸双通道绘制（window 级 touchmove/touchend，pattern 同 `Timeline`），选区可一键清除。选区仍不支持绘制后调整，误画只能重画。 |

### 4.3 状态管理

- sessionStorage 契约设计良好：结构校验 + 默认值合并 + image 侧向后兼容迁移。
- 风险：手动标记帧把全分辨率 dataURL 写进 `frameThumbs` 且无 try/catch，几张 1080p PNG 即可触发 `QuotaExceededError`。
- `Process.tsx` 与 `MultiVideoCompose.tsx` 各自内联实现 WebSocket，质量分叉：`Process.tsx:224-229` 存在陈旧闭包 bug，WS 异常断连时 UI 卡死。

### 4.4 暗色主题

完成度高。`ThemeContext` 三态 + localStorage + `matchMedia` 监听；`index.html` 内联防 FOUC；几乎所有页面都有 `dark:` 类。

---

## 5. 已确认缺陷清单

以下缺陷已逐行核对源码，属实。

> **2026-08-17 复核状态**（随测试套件补齐集中修复）：
> - ✅ #1 路径穿越：`store.py` 各入口均经 `_validate_id` 校验（`test_store_validation.py` 21 例覆盖）。
> - ✅ #2 图片切片忽略 `remove_bg` 参数：`worker.py:372-380` 已按 `params.remove_bg` / `remove_bg_mode` 分支（`test_image_job_remove_bg.py` 覆盖）。
> - ✅ #3 光照归一化静默吞噬：失败现标记 `FAILED` 并写 `error`（`test_worker_state_machine.py::TestNormalizeLightingFailure` 覆盖）。
> - 🔶 #4 前置校验卡 PENDING：后端已修复（校验失败即标记 `FAILED`，同文件 `TestProcessJobValidationFailure` 覆盖）；前端 `Result.tsx:84` 仍只轮询 `running`、不含 `pending`，这半项未闭环。
> - ✅ #5 Process 页 WS 断连陈旧闭包：已改为 `settledRef` 模式，断连可正常提示。
> - ✅ #6 死代码 `useJobProgress.ts`：已删除。
> - ✅ #7 Capture 页键盘冲突：`Capture.tsx:202-205` 已过滤输入框/可编辑元素焦点。
> - ⏸ #8~#12 轻微项本次未逐项复核；其中 #12 ffmpeg 依赖已在 README「环境要求」中声明。

### 严重

1. **路径穿越漏洞（安全）** — `services/api/forge_api/store.py:322-330`
   - `delete_job` 直接用 `JOBS_DIR / job_id` 拼接路径并 `shutil.rmtree`，未校验 `job_id`。
   - `DELETE /api/jobs/..` 可删除整个 `data/` 目录。

2. **图片切片忽略 `remove_bg` 参数（功能 bug）** — `services/api/forge_api/worker.py:378`
   - `process_image_job` 无条件调用 `remove_background(item, "solid")`，完全忽略 `CreateImageJobRequest.remove_bg`。

3. **光照归一化失败静默吞噬（状态误导）** — `services/api/forge_api/worker.py:702-710`
   - `except Exception` 内把状态标回 `DONE` 且不写 `error`，客户端看到成功但实际未生效。

4. **任务前置校验失败永久卡 PENDING + 前端 pending 不轮询** — `services/api/forge_api/worker.py:219-236, 323-337` / `apps/web/src/pages/Result.tsx:84`
   - 校验 raise 在 try 块外，后台只 print，任务状态永久 pending。
   - 前端 SWR `refreshInterval` 只轮询 `running`，不含 `pending`，页面永远卡在 0%。

### 中等

5. **Process 页 WS 断连无提示** — `apps/web/src/pages/Process.tsx:224-229`
   - `onclose` 捕获点击时的 `isProcessing=false` 闭包，WS 异常断连永不触发提示。

6. **前端死代码** — `apps/web/src/hooks/useJobProgress.ts`
   - 整个文件 108 行无人 import，且其引用的 `/ws/image-jobs/{id}` 端点在后端不存在。

7. **Capture 页全局键盘监听冲突** — `apps/web/src/pages/Capture.tsx:168-184`
   - 未过滤 `e.target`，在“截取帧数/步长”输入框内按 ←/→ 会误触视频步进。

### 轻微

8. `worker.py:658`：`job.result.get("meta_frames", [])` 永远为空，该分支是死代码。
9. `Capture.tsx:41,127-128`：自动截帧依赖 mount 快照的 `seededMeta`，空 sessionStorage 直接访问 `/capture/:id` 时按钮永久禁用。
10. `Frames.tsx:298`：`key={frame.ts_ms}`，手动标记不去重，重复时间点导致 React key 冲突 + 拖拽排序错乱。
11. 导出 zip/GIF 在 async handler 内同步构建，大文件会阻塞事件循环（`main.py:501,524,554,572`）。
12. ffmpeg/ffprobe 是未声明的系统级依赖，requirements.txt 与 README 均未提及。

---

## 6. 工程化评估

| 维度 | 状态 | 备注 |
|---|---|---|
| 测试 | 🟡 部分补齐 | 后端 69 个 pytest 全绿（2026-08）；前端测试仍缺失 |
| CI/CD | ❌ 缺失 | 无 `.github/workflows` |
| Lint/格式化 | ❌ 缺失 | 无 ESLint/Prettier/ruff/black |
| Docker | ❌ 缺失 | 无 Dockerfile / docker-compose |
| 脚本 | ❌ 空目录 | `scripts/` 未跟踪任何文件 |
| 类型检查 | ✅ 通过 | `tsc --noEmit` 全绿 |
| 构建 | ✅ 可用 | `npm --prefix apps/web run build` 是仅有的质量门 |

`docs/design.md` 对自身工程化缺口完全自知，已将测试/CI 列入 Phase 1 计划；截至 2026-08-17，后端测试与 design.md 入版本控制已落地，CI/lint/Docker 仍未落地。

---

## 7. 总结与修复优先级

### 7.1 总体结论

- **算法层面**：分割与去背是核心竞争力，经过真实迭代打磨；抽帧容错链超出同类小项目水准；pack 与 lighting 是有意为之的轻量实现。
- **代码层面**：前后端类型契约严谨，四条工作流真实闭环。
- **工程层面**：文档驱动、功能扎实；验证基础设施从零补上了后端测试（69 个 pytest），CI/lint/Docker 仍为零。
- **风险层面**（2026-08-17 复核）：路径穿越、remove_bg 参数失效、光照静默吞噬、校验失败卡死均已修复并有测试兜底；剩余最值得注意的是前端 `Result.tsx` 不轮询 `pending` 状态。

### 7.2 修复优先级

> 2026-08-17 复核：1、3、4 已完成（含测试）；2 的后端半项已完成，前端轮询 `pending` 未做；5 的 WS 闭包已修复，sessionStorage 配额降级未做；6 仅后端测试与 design.md 入库完成。

1. **安全**：修复 `store.py` 中 `job_id` / `video_id` / `image_id` 的路径穿越漏洞。✅
2. **体验**：修复 worker 前置校验失败不更新任务状态的问题；前端 SWR 增加对 `pending` 状态的轮询。🔶（后端 ✅／前端 ⏳）
3. **功能**：修复图片切片忽略 `remove_bg` 参数的 bug。✅
4. **可靠性**：修复光照归一化失败静默吞噬，改为 `status=FAILED` + `error` 字段。✅
5. **健壮性**：修复 `Process.tsx` WS 断连陈旧闭包 ✅；给 sessionStorage 写入加 try/catch 与配额降级 ⏳。
6. **工程债**：补测试（后端 ✅／前端 ⏳）、补 CI ⏳、补 lint ⏳、`docs/design.md` 纳入版本控制 ✅。
