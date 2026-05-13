# Sprite Forge

[中文说明](./README.md)

Sprite Forge is a small full-stack asset processing tool with two independent workflows:

- `Video Processing`: upload a video, extract frames automatically, remove backgrounds, and export a sprite sheet.
- `Image Slicing`: upload a white-background asset sheet, detect isolated items automatically, remove each background, and export the results.

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

From the home page, choose one of the two workflows.

### 1. Video Processing

Best for turning short videos or animation clips into sprite assets.

Main features:

- Upload `MP4` / `WebM`
- Extract frames automatically by count or interval
- Optional watermark area cleanup
- Automatic background removal
- Sprite sheet preview
- Export PNG, JSON, and engine-ready ZIP packages

Typical flow:

1. Upload a video
2. Choose a frame extraction mode
3. Review the extracted frames
4. Configure processing settings
5. Preview and export the result

### 2. Image Slicing

Best for white-background UI sheets or asset boards where each item is visually separated.

Main features:

- Upload `PNG` / `JPG` / `WebP`
- Detect item boundaries automatically
- Remove the background item by item
- Preview each transparent PNG
- Generate a sprite sheet and metadata
- Export a ZIP containing individual images, the sprite sheet, and `manifest.json`

Typical flow:

1. Upload an asset image
2. Confirm the detected item regions
3. Set sprite sheet columns and padding
4. Process and download the result

## Directory Overview

- `apps/web`: frontend application
- `services/api`: FastAPI service
- `data`: runtime uploads, job outputs, and temporary files

## Notes

- Image Slicing currently assumes white or near-white backgrounds with visible spacing between items.
- Files under `data/` are generated at runtime and should not normally be edited manually.
