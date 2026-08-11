# Lottie 导出格式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为视频任务和图像任务新增 Lottie (bodymovin JSON) 导出格式,导出单个自包含 `.json`,每帧作为独立 base64 图资源、用 opacity hold 关键帧逐帧切换。

**Architecture:** 完全沿用现有 GIF 导出模式——格式只在下载时通过 `/export.zip?target=lottie` 决定,不改动任务模型/worker/store。后端新增 builder + endpoint 分支;前端两个结果页各加按钮、扩展类型与扩展名三元。

**Tech Stack:** Python/FastAPI/Pillow/base64 (后端);React/TypeScript (前端);pytest + fastapi.TestClient (测试,httpx 已在 requirements-dev.txt)。

**Spec:** `docs/superpowers/specs/2026-08-11-lottie-export-design.md`

## Global Constraints

- 用户可见文案为简体中文(按钮标题、错误信息 `没有可导出的 PNG 帧`)。
- FPS 来源:video 任务读 `spritesheet.json` 的 `animation.fps`(当前为 12),缺失回退 `ANIMATION_FPS = 12`;image 任务无 animation meta,恒为 12。
- 输出 MIME `application/json`,文件名 `spritesheet_<job_id>.json` / `image_segments_<job_id>.json`。
- 用现有 design-system 原语,不引入新依赖;前端图标用现有 Icon registry(`sparkles`),不安装图标包。
- `models.py`、`worker.py`、`store.py` 不改动。

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `services/api/forge_api/exporters.py` | Lottie 生成核心 + Literal 类型 | 新增 `import base64`;`ExportTarget`/`ImageExportTarget` 加 `"lottie"`;新增 `_lottie_opacity_keyframes`、`_build_lottie_from_pngs`、`build_video_lottie`、`build_image_lottie` |
| `services/api/tests/test_lottie_export.py` | 后端单元 + endpoint 测试 | 新建 |
| `services/api/forge_api/main.py` | 导出 endpoint 分支 | import 增 2 个 builder;两个 endpoint `Literal` 加 `"lottie"`;各加 `target=="lottie"` 分支 |
| `apps/web/src/api/client.ts` | TS 类型 | `EngineExportTarget`/`ImageExportTarget` 加 `'lottie'` |
| `apps/web/src/pages/Result.tsx` | video 导出 UI | `handleExport` ext 三元加 lottie→json;菜单加「导出 Lottie」按钮 |
| `apps/web/src/pages/ImageResult.tsx` | image 导出 UI | `handleExport` ext 三元加 lottie→json;菜单加「导出 Lottie」按钮 |

---

## Task 1: 后端 Lottie builder + 单元测试 (TDD)

**Files:**
- Modify: `services/api/forge_api/exporters.py:1-12`(imports + Literal 类型)、`services/api/forge_api/exporters.py:427`(在 `build_image_gif` 后追加新函数)
- Test: `services/api/tests/test_lottie_export.py`(新建)

**Interfaces:**
- Produces(供 Task 2 使用,签名必须完全一致):
  - `build_video_lottie(job_dir: Path, out_path: Path) -> None`
  - `build_image_lottie(job_dir: Path, out_path: Path) -> None`
  - 内部:`_build_lottie_from_pngs(png_paths: list[Path], out_path: Path, fps: int = ANIMATION_FPS) -> dict`、`_lottie_opacity_keyframes(i: int) -> list[dict]`

- [ ] **Step 1: 写失败测试**

新建 `services/api/tests/test_lottie_export.py`:

```python
"""Tests for Lottie (bodymovin JSON) export builders."""
import json

import pytest
from PIL import Image

from forge_api.exporters import (
    ANIMATION_FPS,
    _build_lottie_from_pngs,
    build_image_lottie,
    build_video_lottie,
)


def _make_png(path, w, h, color=(255, 0, 0, 255)):
    Image.new("RGBA", (w, h), color).save(str(path))


class TestBuildLottieFromPngs:
    def test_empty_raises(self, tmp_path):
        with pytest.raises(ValueError, match="没有可导出的 PNG 帧"):
            _build_lottie_from_pngs([], tmp_path / "out.json")

    def test_structure_single_frame(self, tmp_path):
        png = tmp_path / "frame.png"
        _make_png(png, 32, 16)
        out = tmp_path / "out.json"
        data = _build_lottie_from_pngs([png], out)

        assert data["v"] == "5.7.4"
        assert data["fr"] == ANIMATION_FPS
        assert data["ip"] == 0
        assert data["op"] == 1
        assert data["w"] == 32 and data["h"] == 16
        assert data["ddd"] == 0

        assert len(data["assets"]) == 1
        asset = data["assets"][0]
        assert asset["id"] == "fr_0"
        assert asset["w"] == 32 and asset["h"] == 16
        assert asset["e"] == 1
        assert asset["u"] == ""
        assert asset["p"].startswith("data:image/png;base64,")

        assert len(data["layers"]) == 1
        layer = data["layers"][0]
        assert layer["ty"] == 2
        assert layer["refId"] == "fr_0"
        assert layer["ip"] == 0 and layer["op"] == 1
        assert layer["ks"]["p"]["k"] == [16.0, 8.0, 0]  # centered in 32x16

        # written to disk as valid JSON, identical to returned dict
        loaded = json.loads(out.read_text(encoding="utf-8"))
        assert loaded == data

    def test_multiframe_uses_max_dims_and_one_visible_per_frame(self, tmp_path):
        a = tmp_path / "0.png"
        b = tmp_path / "1.png"
        _make_png(a, 10, 20)
        _make_png(b, 30, 5)
        data = _build_lottie_from_pngs([a, b], tmp_path / "out.json")

        assert data["w"] == 30 and data["h"] == 20  # max per dimension
        assert data["op"] == 2
        assert len(data["assets"]) == 2
        assert len(data["layers"]) == 2

        # layer 0 visible at t=0 only
        k0 = data["layers"][0]["ks"]["o"]["k"]
        assert k0[0]["t"] == 0 and k0[0]["s"] == [100] and k0[0].get("h") == 1
        assert k0[1]["t"] == 1 and k0[1]["s"] == [0]

        # layer 1 starts hidden, shows at t=1, hides at t=2
        k1 = data["layers"][1]["ks"]["o"]["k"]
        assert k1[0]["t"] == 0 and k1[0]["s"] == [0]
        assert k1[1]["t"] == 1 and k1[1]["s"] == [100]
        assert k1[2]["t"] == 2 and k1[2]["s"] == [0]

    def test_custom_fps(self, tmp_path):
        png = tmp_path / "frame.png"
        _make_png(png, 8, 8)
        data = _build_lottie_from_pngs([png], tmp_path / "out.json", fps=24)
        assert data["fr"] == 24


class TestBuildVideoLottie:
    def test_reads_frames_dir_and_animation_fps(self, tmp_path):
        job_dir = tmp_path / "job"
        (job_dir / "frames").mkdir(parents=True)
        _make_png(job_dir / "frames" / "0.png", 12, 12)
        _make_png(job_dir / "frames" / "1.png", 12, 12)
        (job_dir / "spritesheet.json").write_text(
            json.dumps({"animation": {"fps": 10, "loop": True}, "frames": []}),
            encoding="utf-8",
        )

        out = tmp_path / "out.json"
        build_video_lottie(job_dir, out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["fr"] == 10
        assert data["op"] == 2

    def test_missing_frames_raises(self, tmp_path):
        job_dir = tmp_path / "job"
        job_dir.mkdir()
        with pytest.raises(ValueError, match="没有可导出的 PNG 帧"):
            build_video_lottie(job_dir, tmp_path / "out.json")

    def test_corrupt_meta_falls_back_to_default_fps(self, tmp_path):
        job_dir = tmp_path / "job"
        (job_dir / "frames").mkdir(parents=True)
        _make_png(job_dir / "frames" / "0.png", 8, 8)
        (job_dir / "spritesheet.json").write_text("{not valid json", encoding="utf-8")

        out = tmp_path / "out.json"
        build_video_lottie(job_dir, out)
        assert json.loads(out.read_text(encoding="utf-8"))["fr"] == ANIMATION_FPS


class TestBuildImageLottie:
    def test_reads_items_dir_default_fps(self, tmp_path):
        job_dir = tmp_path / "ijob"
        (job_dir / "items").mkdir(parents=True)
        _make_png(job_dir / "items" / "0.png", 20, 20)

        out = tmp_path / "out.json"
        build_image_lottie(job_dir, out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["fr"] == ANIMATION_FPS  # no animation meta -> default
        assert data["op"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/api && python -m pytest tests/test_lottie_export.py -v`
Expected: FAIL,`ImportError: cannot import name '_build_lottie_from_pngs' ...`(函数尚未定义)。

- [ ] **Step 3: 实现 builders**

(a) 在 `exporters.py` 顶部 import 块加 `import base64`(现有 import 见 `exporters.py:1-8`,把 `import base64` 放在 `import json` 之前,保持字母序)。

(b) 改 `exporters.py:11-12` 两个 Literal 类型:

```python
ExportTarget = Literal["generic", "cocos", "unity", "godot", "frames", "gif", "lottie"]
ImageExportTarget = Literal["generic", "items", "gif", "cocos", "unity", "godot", "lottie"]
```

(c) 在 `exporters.py` 文件末尾(`build_image_export` 之后,约第 463 行后)追加:

```python
def _lottie_opacity_keyframes(i: int) -> list[dict]:
    """Hold keyframes: image layer i is opacity 100 only at frame i, else 0."""
    if i == 0:
        return [
            {"t": 0, "s": [100], "h": 1},
            {"t": 1, "s": [0]},
        ]
    return [
        {"t": 0, "s": [0], "h": 1},
        {"t": i, "s": [100], "h": 1},
        {"t": i + 1, "s": [0]},
    ]


def _build_lottie_from_pngs(
    png_paths: list[Path],
    out_path: Path,
    fps: int = ANIMATION_FPS,
) -> dict:
    if not png_paths:
        raise ValueError("没有可导出的 PNG 帧")

    assets: list[dict] = []
    max_w, max_h = 0, 0
    for i, png_path in enumerate(png_paths):
        with Image.open(png_path) as img:
            w, h = img.size
        max_w = max(max_w, w)
        max_h = max(max_h, h)
        data_uri = "data:image/png;base64," + base64.b64encode(png_path.read_bytes()).decode("ascii")
        assets.append({"id": f"fr_{i}", "w": w, "h": h, "p": data_uri, "e": 1, "u": ""})

    frame_count = len(png_paths)
    layers: list[dict] = []
    for i, asset in enumerate(assets):
        w, h = asset["w"], asset["h"]
        layers.append(
            {
                "ddd": 0,
                "ind": i,
                "ty": 2,
                "nm": f"frame_{i}",
                "ks": {
                    "o": {"a": 1, "k": _lottie_opacity_keyframes(i)},
                    "r": {"a": 0, "k": 0},
                    "p": {"a": 0, "k": [max_w / 2, max_h / 2, 0]},
                    "a": {"a": 0, "k": [w / 2, h / 2, 0]},
                    "s": {"a": 0, "k": [100, 100, 100]},
                },
                "ao": 0,
                "ip": 0,
                "op": frame_count,
                "st": 0,
                "refId": asset["id"],
            }
        )

    lottie = {
        "v": "5.7.4",
        "fr": fps,
        "ip": 0,
        "op": frame_count,
        "w": max_w,
        "h": max_h,
        "nm": "spriteforge",
        "ddd": 0,
        "meta": {"g": "Sprite Forge", "a": "Sprite Forge", "d": "Sprite animation export", "tc": ""},
        "assets": assets,
        "layers": layers,
    }

    out_path.write_text(json.dumps(lottie, ensure_ascii=False), encoding="utf-8")
    return lottie


def build_video_lottie(job_dir: Path, out_path: Path) -> None:
    fps = ANIMATION_FPS
    meta_path = job_dir / "spritesheet.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            fps = int(meta.get("animation", {}).get("fps", ANIMATION_FPS)) or ANIMATION_FPS
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    frames_dir = job_dir / "frames"
    frame_paths = sorted(frames_dir.glob("*.png")) if frames_dir.exists() else []
    _build_lottie_from_pngs(frame_paths, out_path, fps=fps)


def build_image_lottie(job_dir: Path, out_path: Path) -> None:
    items_dir = job_dir / "items"
    item_paths = sorted(items_dir.glob("*.png")) if items_dir.exists() else []
    _build_lottie_from_pngs(item_paths, out_path, fps=ANIMATION_FPS)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/api && python -m pytest tests/test_lottie_export.py -v`
Expected: 全部 PASS(8 个测试)。

- [ ] **Step 5: 跑全量后端测试确保无回归**

Run: `cd services/api && python -m pytest -q`
Expected: 全绿(新增 8 个 + 原有全过)。

- [ ] **Step 6: Commit**

```bash
git add services/api/forge_api/exporters.py services/api/tests/test_lottie_export.py
git commit -m "feat(api): add Lottie (bodymovin JSON) export builders"
```

---

## Task 2: 后端 endpoint 接线 + endpoint 测试

**Files:**
- Modify: `services/api/forge_api/main.py:36`(import 行)、`main.py:541-566`(video endpoint)、`main.py:594-619`(image endpoint)
- Test: 追加到 `services/api/tests/test_lottie_export.py`

**Interfaces:**
- Consumes: `build_video_lottie`、`build_image_lottie`(Task 1 产出,签名见上)。
- Produces: HTTP `GET /api/jobs/{id}/export.zip?target=lottie` 与 `/api/image-jobs/{id}/export.zip?target=lottie`,返回 `application/json` 的 bodymovin JSON。

- [ ] **Step 1: 写失败测试**

在 `services/api/tests/test_lottie_export.py` 顶部 import 区(现有 import 之后)追加:

```python
from fastapi.testclient import TestClient

from forge_api import store
from forge_api.main import app
from forge_api.models import (
    CreateImageJobRequest,
    CreateJobRequest,
    ImageEntry,
    SegmentBox,
)
```

测试类追加到文件末尾(`ImageEntry` 形状为 `image_id: str` + `boxes: List[SegmentBox]`,每个 `SegmentBox` 为 `x,y,w,h` 整数、w/h>0):

```python
class TestExportLottieEndpoint:
    def test_video_lottie_export(self):
        job = store.create_job("v_test", CreateJobRequest(video_id="v_test", timestamps_ms=[0.0]))
        job_dir = store.get_job_dir(job.id)
        Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(str(job_dir / "frames" / "0.png"))
        Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(str(job_dir / "frames" / "1.png"))

        with TestClient(app) as client:
            resp = client.get(f"/api/jobs/{job.id}/export.zip", params={"target": "lottie"})

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/json"
        assert resp.headers["content-disposition"].endswith(f'spritesheet_{job.id}.json"')
        data = resp.json()
        assert data["op"] == 2
        assert len(data["assets"]) == 2
        assert len(data["layers"]) == 2

    def test_video_lottie_no_frames_returns_400(self):
        job = store.create_job("v_test", CreateJobRequest(video_id="v_test", timestamps_ms=[0.0]))
        with TestClient(app) as client:
            resp = client.get(f"/api/jobs/{job.id}/export.zip", params={"target": "lottie"})
        assert resp.status_code == 400
        assert "没有可导出的" in resp.json()["detail"]

    def test_image_lottie_export(self):
        entry = ImageEntry(image_id="img_test", boxes=[SegmentBox(x=0, y=0, w=8, h=8)])
        job = store.create_image_job(["img_test"], CreateImageJobRequest(images=[entry]))
        job_dir = store.get_image_job_dir(job.id)
        Image.new("RGBA", (20, 20), (0, 0, 255, 255)).save(str(job_dir / "items" / "0.png"))

        with TestClient(app) as client:
            resp = client.get(f"/api/image-jobs/{job.id}/export.zip", params={"target": "lottie"})

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/json"
        assert resp.headers["content-disposition"].endswith(f'image_segments_{job.id}.json"')
        data = resp.json()
        assert data["op"] == 1
        assert len(data["assets"]) == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/api && python -m pytest tests/test_lottie_export.py::TestExportLottieEndpoint -v`
Expected: FAIL —— endpoint 返回 422/400(FastAPI 拒绝未知 `target=lottie`,因为 Literal 里还没有它),或 200 但 content-type 为 zip(取决于 FastAPI 校验时机)。

- [ ] **Step 3: 接线 endpoint**

(a) 改 `main.py:36` import 行:

```python
from .exporters import (
    build_engine_export,
    build_image_export,
    build_image_gif,
    build_image_lottie,
    build_video_gif,
    build_video_lottie,
)
```

(b) 改 `main.py:545` video endpoint 的 `target` 签名:

```python
    target: Literal["generic", "cocos", "unity", "godot", "frames", "gif", "lottie"] = "generic",
```

(c) 在 video endpoint 的 `gif` 分支之后(`main.py:566` 之后、`frames_dir = job_dir / "frames"` 之前)插入:

```python
    if target == "lottie":
        lottie_path = store.TMP_DIR / f"{job_id}_video_lottie.json"
        try:
            await asyncio.to_thread(build_video_lottie, job_dir, lottie_path)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        background_tasks.add_task(lottie_path.unlink, missing_ok=True)
        return FileResponse(
            lottie_path,
            media_type="application/json",
            filename=f"spritesheet_{job_id}.json",
        )
```

(d) 改 `main.py:598` image endpoint 的 `target` 签名:

```python
    target: Literal["generic", "items", "gif", "cocos", "unity", "godot", "lottie"] = "generic",
```

(e) 在 image endpoint 的 `gif` 分支之后(`main.py:619` 之后、`if target != "items":` 之前)插入:

```python
    if target == "lottie":
        lottie_path = store.TMP_DIR / f"{job_id}_image_lottie.json"
        try:
            await asyncio.to_thread(build_image_lottie, job_dir, lottie_path)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        background_tasks.add_task(lottie_path.unlink, missing_ok=True)
        return FileResponse(
            lottie_path,
            media_type="application/json",
            filename=f"image_segments_{job_id}.json",
        )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/api && python -m pytest tests/test_lottie_export.py -v`
Expected: 全部 PASS(8 个 builder + 3 个 endpoint = 11 个)。

- [ ] **Step 5: 跑全量后端测试**

Run: `cd services/api && python -m pytest -q`
Expected: 全绿,无回归。

- [ ] **Step 6: Commit**

```bash
git add services/api/forge_api/main.py services/api/tests/test_lottie_export.py
git commit -m "feat(api): expose Lottie export on video/image export endpoints"
```

---

## Task 3: 前端类型 + 两个结果页按钮

**Files:**
- Modify: `apps/web/src/api/client.ts:167-168`(类型)
- Modify: `apps/web/src/pages/Result.tsx:261`(ext 三元)、`Result.tsx:571`(菜单按钮,GIF 之后)
- Modify: `apps/web/src/pages/ImageResult.tsx:140`(ext 三元)、`ImageResult.tsx:330`(菜单按钮,GIF 之后)

**Interfaces:**
- Consumes: 后端 `target=lottie` endpoint(Task 2)。
- Produces: 用户点击「导出 Lottie」→ 下载 `spritesheet_<id>_lottie.json` / `image_segments_<id>.json`。

- [ ] **Step 1: 扩展 TS 类型**

改 `apps/web/src/api/client.ts:167-168`:

```ts
export type EngineExportTarget = 'generic' | 'cocos' | 'unity' | 'godot' | 'frames' | 'gif' | 'lottie';
export type ImageExportTarget = 'generic' | 'items' | 'gif' | 'cocos' | 'unity' | 'godot' | 'lottie';
```

- [ ] **Step 2: Result.tsx ext 三元**

改 `Result.tsx:261`:

```ts
      const ext = target === 'gif' ? 'gif' : target === 'lottie' ? 'json' : 'zip';
```

- [ ] **Step 3: Result.tsx 菜单按钮**

在 `Result.tsx` 的 GIF 按钮(第 565-571 行的 `handleExport('gif')` button)之后、第 572 行的 `<div className="my-1 border-t ...">` 分隔线之前插入:

```tsx
                <button onClick={() => void handleExport('lottie')} className={exportMenuItemClass}>
                  <Icon name="sparkles" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">导出 Lottie</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">Lottie 动画 JSON</span>
                  </span>
                </button>
```

- [ ] **Step 4: ImageResult.tsx ext 三元**

改 `ImageResult.tsx:140`:

```ts
      const ext = exportTarget === 'gif' ? 'gif' : exportTarget === 'lottie' ? 'json' : 'zip';
```

- [ ] **Step 5: ImageResult.tsx 菜单按钮**

在 `ImageResult.tsx` 的 GIF 按钮(第 320-330 行的 `handleExport('gif')` button)之后、第 331 行的分隔线之前插入(沿用该文件的 emoji 风格):

```tsx
                <button
                  type="button"
                  onClick={() => void handleExport('lottie')}
                  className={exportMenuItemClass}
                >
                  <span className="text-base">✨</span>
                  <div>
                    <div className="font-medium">导出 Lottie</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">Lottie 动画 JSON</div>
                  </div>
                </button>
```

- [ ] **Step 6: 构建验证**

Run: `npm --prefix apps/web run build`
Expected: 构建成功,TS 类型与后端 Literal 对齐,无类型错误。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/Result.tsx apps/web/src/pages/ImageResult.tsx
git commit -m "feat(web): add Lottie export option to result pages"
```

---

## 验收(全流程)

- [ ] **后端测试全绿**:`cd services/api && python -m pytest -q`
- [ ] **前端构建通过**:`npm --prefix apps/web run build`
- [ ] **端到端手测**(需要 `npm run dev` 跑起来,或前后端分别启动):
  1. 跑一个 video job → 结果页点「导出 Lottie」→ 下载 `spritesheet_<id>_lottie.json`,用 `head -c 200` 确认是 JSON、`jq '.op, (.assets|length), (.layers|length)'` 数值合理。
  2. 把该 JSON 拖进 [lottiefiles.com](https://lottiefiles.com/) 在线播放器 或本地 `lottie-web`,确认逐帧循环播放。
  3. image job 同理:结果页「导出 Lottie」→ 下载 `image_segments_<id>.json`。
  4. 异常:对一个 frames 为空的任务请求 `?target=lottie` → 400 + `没有可导出的 PNG 帧`。

## Self-Review 结论

- **Spec 覆盖**:builder(Task 1)→ endpoint(Task 2)→ UI(Task 3)全覆盖;FPS 来源/回退、空帧 400、MIME、文件名、两个 pipeline、6 处改动点均落地。
- **类型一致**:`build_video_lottie` / `build_image_lottie` 在 Task 1 定义、Task 2 import,签名 `(job_dir: Path, out_path: Path) -> None` 全程一致;前端 `EngineExportTarget`/`ImageExportTarget` 与后端两个 Literal 的成员集合对齐(含新增 `lottie`)。
- **已知简化**(可接受):hold 关键帧不带 bezier 缓动字段(`"i"`/`"o"`),lottie-web 原生支持 `"h":1`,验收环节用真实播放器确认。
