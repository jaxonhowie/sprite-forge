# Sprite Forge

[English README](./README.en.md)

一个小型全栈素材处理工具，包含三条独立工作流：

- `视频处理`：上传视频，自动截帧、去背景并导出精灵表。
- `多视频拼帧`：从多个视频中分别截取关键帧，合并为一套精灵表。
- `图片切图`：上传白底素材图，自动识别图块、逐块去背景并导出结果。

> 仅个人兴趣使用，请勿商用。

## 技术栈

- 前端：React 18、TypeScript、Vite、React Router、SWR、Tailwind CSS
- 后端：FastAPI、Pillow、OpenCV、rembg

## 安装

先准备：

- Node.js 18+
- Python 3.10+

安装依赖：

```bash
npm run setup
```

这会安装根目录依赖、`apps/web` 前端依赖，以及 `services/api/requirements.txt` 中的 Python 依赖。

## 开发

同时启动前后端：

```bash
npm run dev
```

单独启动前端：

```bash
npm run dev:web
```

单独启动后端：

```bash
npm run dev:api
```

默认情况下：

- Web: `http://localhost:6284`
- API: `http://localhost:8000`

## 构建

前端生产构建：

```bash
npm run build
```

这个命令等价于：

```bash
npm --prefix apps/web run build
```

构建产物位于 `apps/web/dist`。

## 使用说明

进入首页后可以选择两条入口：

### 1. 视频处理

适合把短视频或动作片段转成精灵资源。

主要功能：

- 上传 `MP4` / `WebM`
- 自动按帧数或步长截帧
- 可选水印区域处理
- 自动去背景
- 生成 spritesheet 预览
- 导出 PNG、JSON 和引擎 ZIP 包

典型流程：

1. 上传视频
2. 选择截帧方式
3. 检查帧列表
4. 设置处理参数
5. 查看结果并导出

### 2. 多视频拼帧

适合从多个动画片段中各取关键帧，合并生成一套精灵资源。

主要功能：

- 添加多个视频源，分别设置截帧数量
- 预览各视频的关键帧
- 可选去背景和统一灯光
- 合并导出精灵表

### 3. 图片切图

适合处理白底、元素彼此分离的 UI 图集或素材板。

主要功能：

- 上传 `PNG` / `JPG` / `WebP`
- 自动检测图块边界
- 按图块逐个去背景
- 预览每张透明 PNG
- 生成 spritesheet 和 metadata
- 导出包含单图、spritesheet、`manifest.json` 的 ZIP

典型流程：

1. 上传素材图
2. 确认自动识别到的图块
3. 设置精灵表列数和间距
4. 处理并下载结果

## 目录说明

- `apps/web`：前端应用
- `services/api`：FastAPI 服务
- `data`：运行时上传文件、任务结果和临时文件

## 备注

- 图片切图当前假设素材是白底或近白底，且图块之间有明显空白分隔。
- `data/` 下内容是运行时生成文件，不建议手动编辑。
