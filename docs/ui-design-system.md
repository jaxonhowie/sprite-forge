# Sprite Forge UI 设计系统规范

本文件是前端 UI 改造的统一规范。所有页面必须严格遵循，保证视觉一致性。

## 1. 设计语言

精致的"工作室工具"风格：中性灰画布 + 白色/深色浮起卡片 + 单一品牌色点缀（indigo 系）。
克制、紧凑、信息密度高，是生产工具而非营销页。全部用户可见文案为简体中文。

## 2. 设计令牌（已在 tailwind.config.js 注册）

- **品牌色**：`brand-50` ~ `brand-950`（indigo 系）。主按钮 `bg-brand-600 hover:bg-brand-700`，暗色下 `dark:bg-brand-500 dark:hover:bg-brand-400`。链接/强调文字 `text-brand-600 dark:text-brand-400`。
- **中性色**：Tailwind `gray` 系列。
- **语义色**：成功 `green`、失败/ destructive `red`、警告 `amber`、信息 `blue`。去背模式等辅助强调可用 `brand`。
- **圆角**：控件（按钮/输入/小徽章）`rounded-md`；卡片/面板 `rounded-xl`；小图块/图标容器 `rounded-lg`。禁止使用更大的圆角。
- **阴影**：卡片 `shadow-sm`，悬浮态 `hover:shadow-md`，浮层菜单 `shadow-lg`。禁止浓重阴影。
- **动效**：`animate-fade-in` / `animate-fade-in-up`（已注册，用于页面与卡片进场）；交互反馈 `transition-colors`；位移/阴影用 `transition-all`，时长 150–300ms。
- **禁止**在组件中写死十六进制颜色；只能用 brand token 或 Tailwind 调色板。

## 3. 明暗双主题表面层级（硬性规定）

| 层级 | 浅色 | 深色 |
|---|---|---|
| 应用背景 | `bg-gray-50` | `bg-gray-950` |
| 卡片/面板 | `bg-white` + `border-gray-200` | `bg-gray-900` + `border-gray-800` |
| 卡片内分隔线 | `border-gray-100` | `border-gray-800` |
| 嵌套/次级表面（输入框内嵌区、缩略图底、hover） | `bg-gray-50` / `bg-gray-100` | `bg-gray-800` |
| 主文字 | `text-gray-900` | `text-gray-100` |
| 次文字 | `text-gray-500` / `text-gray-600` | `text-gray-400` |
| 弱提示文字 | `text-gray-400` | `text-gray-500` |

**每一个彩色 class 都必须有对应 `dark:` 变体。** 透明背景预览用已有的 `.transparent-preview-bg`（棋盘格，自带暗色变体）。

## 4. UI 原语组件（位于 src/components/ui/，务必先读源码再用）

- `Button`：`variant: primary|secondary|ghost|danger|dangerSoft`，`size: sm|md|lg`，`loading` 自带 spinner。**所有按钮一律用它**，禁止再手写 `bg-gray-900` 之类按钮类名。
- `Card`：`title/description/actions/children/className/bodyClassName`。页面内容区块一律包在 Card 里。
- `Badge`：`tone: gray|brand|green|red|amber|blue`，`dot` 可选圆点。任务状态映射：pending→gray、running→brand、done→green、failed→red。
- `ProgressBar`：`value`（0–1）、`tone`。替代所有手写进度条。
- `Steps`：`steps: string[]`、`current: number`（0 基）。流程页顶部的步骤指示器。
- `Input` / `inputClass`、`Select` / `selectClass`：所有表单控件统一使用。
- `EmptyState`：`icon/title/description/action`。所有空态、错误态、加载失败占位使用。
- `Icon`：`name` 见 `Icon.tsx` 的 `IconName` 联合类型，`size` 默认 18。**禁止新增图标包**；缺图标时用现有 IconName 里最贴切的，不要新写内联 SVG（除非确实没有合适的，且风格必须是 24 viewBox、stroke 1.8、round caps）。
- 加载中 spinner：`<Icon name="loader" className="animate-spin" />`。

## 5. 通用模式（class 配方）

**页面骨架**：一律用 `PageShell`（title + description + 可选 `back={{to,label}}` + 可选 `actions`）。不要再手写 `text-2xl` 标题。视频工作流页面顶部可在 PageShell 之后、内容之前放 `<Steps steps={['上传视频','截取帧','确认帧','处理设置','导出结果']} current={n} />`。

**表单标签**：`<label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">`。

**单选卡片组**（如去背模式选择）：
```tsx
<label className="cursor-pointer">
  <input type="radio" className="peer sr-only" ... />
  <div className="rounded-lg border border-gray-200 bg-white p-3 transition-colors peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:peer-checked:bg-brand-500/10 dark:hover:border-gray-600">
    ...标题(text-sm font-medium)+描述(text-xs text-gray-500)...
  </div>
</label>
```

**复选框/开关**：原生 checkbox 用 `h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800`。二元开关优先用 checkbox，不要自造滑块。

**上传拖放区**：
```tsx
<div className="rounded-xl border-2 border-dashed border-gray-300 bg-white px-6 py-12 text-center transition-colors hover:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600">
  {/* 拖拽激活时：border-brand-500 bg-brand-50/50 dark:bg-brand-500/10 */}
  {/* Icon(upload) 灰色圆形底 + 主文案 text-sm font-medium + 副文案 text-xs text-gray-500 + Button secondary 选择文件 */}
</div>
```

**下拉菜单/浮层**（如导出菜单）：触发器用 `Button secondary` + `Icon chevron-down`；面板：
```
absolute right-0 z-20 mt-2 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg animate-fade-in dark:border-gray-700 dark:bg-gray-800
```
菜单项：`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700`。点击外部关闭用 backdrop 或已有逻辑，不改行为。

**提示条**：
- 信息：`flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-300`，配 `Icon info`。
- 警告：换 amber 色系，`Icon alert-triangle`。
- 错误：换 red 色系，`Icon alert-circle`。

**缩略图网格**：`grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6`；图项 `group relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800`，透明底图加 `transparent-preview-bg`；悬浮操作按钮用 `absolute` + `opacity-0 transition-opacity group-hover:opacity-100`（触屏可及性允许时也要常驻可见的小尺寸变体，二选一，不要删功能）。

**工具条**（结果页/播放控制）：`flex flex-wrap items-center gap-2`，左侧信息（Badge/文字），右侧 `ml-auto` 操作按钮组。

**视频/媒体预览容器**：`overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-800`（视频画面用黑底），配 `aspect-video` 或固定高度。

**错误页/失败态**：`EmptyState icon="alert-circle"` + 重试/返回 `Button`。

## 6. 硬性规则

1. **只改表现层**：JSX 结构样式、class、文案润色可以改；state、hooks、事件处理逻辑、API 调用、sessionStorage 契约、路由参数、组件 props 一律不得改语义。禁止"顺手"重构逻辑。
2. 所有交互元素必须有 `transition-colors` 和可见的 focus 态（用 Button/Input 原语则自带）。
3. 文案保持简体中文，可以润色得更精炼专业，但不得改变含义、不得新增营销话术。
4. 保持现有功能一个不少：按钮、输入项、提示信息只能变好看，不能消失。
5. 触屏拖拽（Timeline 模式）等既有交互不得破坏。
6. 完成后运行 `cd apps/web && npx tsc --noEmit` 必须零错误（不要跑 vite build，由主代理统一构建）。
