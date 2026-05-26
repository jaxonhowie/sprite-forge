# Sprite Forge

[中文说明](./README.md)

Sprite Forge is a small full-stack asset processing tool with three independent workflows:

- `Video Processing`: upload a video, extract frames, remove backgrounds, fine-tune per-frame offsets, and export a sprite sheet.
- `Multi-Video Compose`: extract keyframes from multiple videos, align them with calibration, and combine into a single sprite sheet.
- `Image Slicing`: upload a white-background asset sheet, detect isolated items automatically, remove each background, and export the results.

> For personal interest use only. Commercial use is not allowed.

## Tech Stack

- Frontend: React 18, TypeScript, Vite, React Router, SWR, Tailwind CSS
- Backend: FastAPI, Pillow, OpenCV, rembg

## Setup

Prerequisites:

- Node.js 18+
- Python 3.10+

Install dependencies:

```bash
npm run setup
```

This installs root dependencies, frontend dependencies in `apps/web`, and Python dependencies from `services/api/requirements.txt`.

## Development

Start both frontend and backend:

```bash
npm run dev
```

Start only the frontend:

```bash
npm run dev:web
```

Start only the backend:

```bash
npm run dev:api
```

Default local endpoints:

- Web: `http://localhost:6284`
- API: `http://localhost:8000`

## Build

Build the frontend for production:

```bash
npm run build
```

This is equivalent to:

```bash
npm --prefix apps/web run build
```

Build output is generated in `apps/web/dist`.

## Usage

From the home page, choose one of the three workflows.

### 1. Video Processing

Best for turning short videos or animation clips into sprite assets.

Main features:

- Upload `MP4` / `WebM`
- Extract frames by count or interval, with keyboard shortcuts (Space to mark, Arrow Left/Right to step)
- Optional watermark area cleanup
- Three background removal modes: standard (clean edges), conservative (preserves glow/aura), white (removes only pure white)
- Sprite sheet preview
- Drag-and-drop frame reordering and per-frame X/Y offset adjustment on the result page
- Frame-by-frame playback preview
- Optional lighting normalization to unify brightness and contrast
- Multi-target export: per-frame PNG ZIP, sprite sheet + JSON, Godot 4, Unity, Cocos Creator

Typical flow:

1. Upload a video
2. Choose a frame extraction mode (keyboard marking supported)
3. Review the extracted frames
4. Configure processing settings and background removal mode
5. Drag to reorder frames, fine-tune offsets, normalize lighting on the result page
6. Choose an export format and download

### 2. Multi-Video Compose

Best for combining keyframes from multiple animation clips into one sprite set.

Main features:

- Add multiple video sources with per-video frame counts
- Preview keyframes from each video
- Alignment calibration: pick a base and target video, adjust X/Y pixel offsets with an overlay preview for precise alignment
- Three background removal modes: standard, conservative (preserves glow/aura), white (removes only pure white)
- Optional lighting normalization
- Drag-and-drop reordering of the combined frame list
- Combined sprite sheet export

### 3. Image Slicing

Best for white-background UI sheets or asset boards where each item is visually separated.

Main features:

- Multi-image upload: detect items per image independently, merge all into one sprite sheet
- Adaptive threshold detection, compatible with light-colored assets and internal white gaps
- Detected segments shown as blue-bordered overlays with numbered labels for easy confirmation
- Background removal item by item
- Horizontal grid preview with drag-and-drop reordering and per-item deletion
- Click any item to zoom into a full-size preview
- Frame-by-frame playback preview
- Multi-target export: per-item PNG ZIP, animated GIF, sprite sheet + JSON, Godot 4, Unity, Cocos Creator

Typical flow:

1. Upload one or more asset images
2. Confirm detected item regions for each image (blue overlay preview)
3. Set sprite sheet columns and padding
4. Process and preview the result
5. Drag to reorder, click to zoom, choose an export format and download

## Directory Overview

- `apps/web`: frontend application
- `services/api`: FastAPI service
- `data`: runtime uploads, job outputs, and temporary files

## Notes

- Image Slicing currently assumes white or near-white backgrounds with visible spacing between items.
- The "white" background removal mode only removes pure/near-pure white areas, ideal for assets with built-in glow effects; "conservative" mode preserves semi-transparent edges and auras.
- Files under `data/` are generated at runtime and should not normally be edited manually.
