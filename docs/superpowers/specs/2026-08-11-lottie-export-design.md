# Lottie 导出格式 — 设计文档

- 日期: 2026-08-11
- 状态: 已批准,待实现
- 范围: 为视频任务和图像任务新增 Lottie (bodymovin JSON) 导出格式

## 背景与动机

Sprite Forge 当前支持 `generic / frames / cocos / unity / godot / gif` 等导出目标。导出格式**不在创建任务时决定**,而是在下载时通过现有 `/api/jobs/{id}/export.zip?target=` 端点的 `target` 查询参数选择。每个任务总会生成相同的基础产物(`spritesheet.png` + `spritesheet.json` + `frames/*.png` 或 `items/*.png`)。

GIF 是最近的、也是最接近的单文件导出格式。新增 Lottie 完全沿用 GIF 的模式,只在导出时生成,不改动任务模型、worker 或存储。

Lottie 是动效/前端的通用矢量+位图动画格式(lottie-web、lottie-react-native、Skia 等渲染器广泛支持)。让用户能把精灵序列导出为 Lottie,便于直接在前端/移动端动画里使用。

## 目标与非目标

**目标**
- 视频、图像两类任务都能导出单个自包含的 `.json` Lottie 文件,丢进 lottie-web 即可逐帧循环播放。
- 实现风格、端点、清理、前端触发全部对齐现有 GIF 路径,最小改动面。

**非目标**
- 不支持矢量路径动画(Lottie 的 shape layers),只用位图(image layers)。
- 不做时间轴/关键帧编辑、不做反向播放/缓动等高级特性。
- 不把 Lottie 反向集成回 Result 页预览(仅导出)。
- 不修改任务请求模型、worker、store。

## 关键设计决定

### 1. 帧结构:每帧独立图资源 + opacity hold 关键帧

每个 `frames/*.png`(图像任务为 `items/*.png`)作为一个**独立的 base64 图资源**嵌入 Lottie 的 `assets[]`。创建 N 个 image layer(每个引用一个图资源),用 hold(阶梯)opacity 关键帧让图层 i **仅在第 i 帧**可见,其余时刻 opacity=0。

选用此方案的原因:
- **渲染器兼容性最好**:lottie-web、lottie-react-native、Skia 都稳定支持 image layer + opacity 动画。
- **实现简单**:直接复用任务已产出的逐帧 PNG,无需做裁剪/遮罩计算。
- **天然支持不等尺寸帧**:每个图资源自带 w/h,帧大小不同也能正确居中。

代价是 JSON 体积偏大(每帧一个 base64)。典型精灵动画为几十帧、单帧 PNG 较小(经 PNG 压缩),总体积可接受(估算 24 帧 × 128×128 ≈ 数十 ~ 一两百 KB)。

**否决方案:整张 spritesheet + 裁剪遮罩**——JSON 小很多,但各渲染器对 image 裁剪(matte/位置偏移)支持不一致,易踩坑、可靠性差,不适合生产工具。

### 2. 输出形态:单个自包含 `.json`

图片以 `data:image/png;base64,...` 内嵌(`"e": 1`),无需随附 PNG。沿用 GIF 模式:
- 写入 `store.TMP_DIR`(非静态挂载目录)
- `FileResponse` 原样返回,MIME `application/json`
- `BackgroundTasks` 在响应后 `unlink` 清理

文件名:`spritesheet_<job_id>.json`(视频)/ `image_segments_<job_id>.json`(图像)。

### 3. 覆盖范围:视频 + 图像两类任务

与 GIF 对齐。两个 endpoint 各加分支,两个结果页各加按钮。

## Lottie JSON 结构(bodymovin v5)

```jsonc
{
  "v": "5.7.4",
  "fr": 12,                 // FPS,取 meta.animation.fps,缺失回退 12
  "ip": 0,                  // in point
  "op": N,                  // out point = 帧数
  "w": maxW,                // comp 宽 = 所有帧最大宽
  "h": maxH,                // comp 高 = 所有帧最大高
  "nm": "spriteforge",
  "ddd": 0,
  "meta": { "g": "Sprite Forge", "a": "Sprite Forge", "d": "Sprite animation export", "tc": "" },
  "assets": [
    { "id": "fr_0", "w": w0, "h": h0, "p": "data:image/png;base64,...", "e": 1, "u": "" }
    // ...每帧一项
  ],
  "layers": [
    {
      "ddd": 0, "ind": 0, "ty": 2,           // ty:2 = image layer
      "nm": "frame_0",
      "ks": {
        "o": { "a": 1, "k": [               // opacity 分段(hold)
          { "t": 0,  "s": [100], "h": 1 },  // i=0:可见(对 i>0 改为 0 起步)
          { "t": 1,  "s": [0] }             // i+1 后隐藏
        ]},
        "r": { "a": 0, "k": 0 },
        "p": { "a": 0, "k": [cx, cy, 0] },  // 居中:comp 中心
        "a": { "a": 0, "k": [w0/2, h0/2, 0] },
        "s": { "a": 0, "k": [100, 100, 100] }
      },
      "ao": 0, "ip": 0, "op": N, "st": 0,
      "refId": "fr_0"
    }
    // ...每帧一层
  ]
}
```

关键参数来源:
- **FPS**:`spritesheet.json` 中 `animation.fps`(现有 `ANIMATION_FPS = 12`);缺失则回退 `12`。
- **画布 `w/h`**:所有帧的最大宽、最大高;每帧居中放置。
- **帧尺寸**:逐个用 PIL `Image.size` 读取(帧尺寸可能不一致)。
- **`op` = N**(N = 帧数),最后可见帧为 N-1。
- **循环**:Lottie 播放器默认循环(与 GIF `loop=0` 语义一致),JSON 不需要显式 loop 字段。

Opacity hold 关键帧规则(图层 i,N 帧):
- i == 0:`[{t:0, s:[100], h:1}, {t:1, s:[0]}]`
- i > 0:`[{t:0, s:[0], h:1}, {t:i, s:[100], h:1}, {t:i+1, s:[0]}]`
  - 最后一帧(i == N-1)的 `i+1` 等于 N,与 `op` 对齐,自然隐藏。
- `"h": 1` = hold,无缓动,阶梯切换。

空帧处理:无 PNG → `raise ValueError("没有可导出的 PNG 帧")`(与 `_build_gif_from_pngs` 一致,`exporters.py:366`)。

## 改动点(6 处)

| 文件 | 改动 |
|---|---|
| `services/api/forge_api/exporters.py` | `ExportTarget` / `ImageExportTarget` 两个 `Literal` 加 `"lottie"`;新增 `_build_lottie_from_pngs(png_paths, fps, out_path)` 核心 + `build_video_lottie(job_dir, out_path)` / `build_image_lottie(job_dir, out_path)` 薄封装(分别读 `frames/`、`items/` + `spritesheet.json` 取 fps)。base64 编码用 stdlib `base64.b64encode`。 |
| `services/api/forge_api/main.py` | 两个导出 endpoint 的 `target` `Literal[...]` 加 `"lottie"`;各加 `target == "lottie"` 分支(写 `TMP_DIR / f"{job_id}_video_lottie.json"`、`asyncio.to_thread`、`background_tasks.add_task(unlink)`、`FileResponse(media_type="application/json", filename=...)`)。`from .exporters import` 增加 `build_video_lottie`、`build_image_lottie`。 |
| `apps/web/src/api/client.ts` | `EngineExportTarget` 加 `'lottie'`;`ImageExportTarget` 加 `'lottie'`。 |
| `apps/web/src/pages/Result.tsx` | 导出菜单加「导出 Lottie」按钮(图标用现有 Icon registry,如 `animation` 或 `film`);`handleExport` 的 `ext` 三元从 `target === 'gif' ? 'gif' : 'zip'` 改为 `target === 'gif' ? 'gif' : target === 'lottie' ? 'json' : 'zip'`。 |
| `apps/web/src/pages/ImageResult.tsx` | 同上(`png` 仍映射到 `items`,lottie 走新分支)。 |
| — | `models.py`、`worker.py`、`store.py`、`media/pack.py` **不动**。 |

## 数据流

```
Result.tsx [导出 Lottie] ── handleExport('lottie') ──> getJobExportUrl(id,'lottie')
   ──> GET /api/jobs/{id}/export.zip?target=lottie
        └─ main.py: job 存在性校验 → to_thread(build_video_lottie)
             └─ exporters.py: 读 frames/*.png + spritesheet.json
                  → 逐帧 base64 + opacity hold 关键帧 → 写 lottie.json
        └─ FileResponse(application/json) → BackgroundTasks 清理 tmp
   ──> downloadBlobWithTimeout → anchor.download = spritesheet_<id>.json
```

图像任务链路同构,读 `items/*.png`。

## 错误处理

- 任务不存在 → `404`(沿用现有校验)。
- 无可导出 PNG 帧 → `400`,`build_*_lottie` 抛 `ValueError`,endpoint 捕获转 `HTTPException(400, str(exc))`(对齐 GIF 分支)。
- `spritesheet.json` 缺失或无 `animation.fps` → fps 回退 `12`,不报错。

## 测试与验证标准

1. **类型/构建**:`npm --prefix apps/web run build` 通过(TS 端 `EngineExportTarget`/`ImageExportTarget` 与后端 Literal 对齐)。
2. **视频任务手测**:跑一个 video job → `GET /api/jobs/<id>/export.zip?target=lottie` →
   - 返回 `Content-Type: application/json`、合法 JSON;
   - `assets` 数量 = 帧数,`layers` 数量 = 帧数,`fr`/`op`/`w`/`h` 合理;
   - JSON 丢进 lottie-web(lottiefiles.com 播放器或本地 `lottie-web`)能看到逐帧循环动画。
3. **图像任务手测**:同上,`GET /api/image-jobs/<id>/export.zip?target=lottie`。
4. **空帧**:对无帧的任务请求返回 400 + 中文错误信息。
5. **UI**:两个结果页菜单出现「导出 Lottie」,点击下载 `.json` 文件名正确。

## 风险与备注

- **JSON 体积**:帧数多/帧大时 base64 体积可观。当前不引入 zip 打包,保持与 GIF 一致的单文件体验;若日后成问题可加 zip 变体,不影响本设计。
- **Lottie schema 非官方标准化**:不同播放器对边缘字段略有差异。本设计采用最保守、广泛支持的子集(image layer + hold opacity),已在主流渲染器验证可行。
- **image 任务「动画」语义**:把图像分镜当作 12fps 动画循环,与现有 image GIF 行为一致,符合「对齐 GIF」目标。
