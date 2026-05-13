import json
import plistlib
import zipfile
from pathlib import Path
from typing import Literal

from PIL import Image


ExportTarget = Literal["generic", "cocos", "unity", "godot"]

ANIMATION_FPS = 12


def _read_meta(job_dir: Path) -> dict:
    with open(job_dir / "spritesheet.json", "r", encoding="utf-8") as f:
        return json.load(f)


def _frame_name(frame: dict) -> str:
    index = int(frame.get("index", 0))
    return frame.get("name") or f"sprite_{index:04d}.png"


def _sheet_size(job_dir: Path) -> tuple[int, int]:
    with Image.open(job_dir / "spritesheet.png") as image:
        return image.size


def _write_readme(archive: zipfile.ZipFile, folder: str, target_name: str) -> None:
    archive.writestr(
        f"{folder}/README.md",
        "\n".join(
            [
                f"# Sprite Forge {target_name} 导出包",
                "",
                "包含处理后的精灵表、切片元数据和 12 FPS 循环动画辅助信息。",
                "导入引擎时请保持本目录内文件的相对位置不变。",
                "",
            ]
        ),
    )


def _build_animation_meta(meta: dict) -> dict:
    return {
        "name": "sprite_forge_animation",
        "fps": ANIMATION_FPS,
        "loop": True,
        "image": "spritesheet.png",
        "frames": [
            {
                "name": _frame_name(frame),
                "index": int(frame.get("index", 0)),
                "ts_ms": int(frame.get("ts_ms", 0)),
            }
            for frame in meta["frames"]
        ],
    }


def _build_cocos_plist(meta: dict, sheet_size: tuple[int, int]) -> dict:
    frames = {}
    for frame in meta["frames"]:
        name = _frame_name(frame)
        x = int(frame["x"])
        y = int(frame["y"])
        w = int(frame["w"])
        h = int(frame["h"])
        frames[name] = {
            "aliases": [],
            "spriteOffset": "{0,0}",
            "spriteSize": f"{{{w},{h}}}",
            "spriteSourceSize": f"{{{w},{h}}}",
            "textureRect": f"{{{{{x},{y}}},{{{w},{h}}}}}",
            "textureRotated": False,
        }

    return {
        "frames": frames,
        "metadata": {
            "format": 3,
            "pixelFormat": "RGBA8888",
            "premultiplyAlpha": False,
            "realTextureFileName": "spritesheet.png",
            "size": f"{{{sheet_size[0]},{sheet_size[1]}}}",
            "smartupdate": "",
            "textureFileName": "spritesheet.png",
        },
    }


def _build_unity_meta(meta: dict, sheet_size: tuple[int, int]) -> dict:
    return {
        "name": "sprite_forge",
        "image": "spritesheet.png",
        "sheet": {"w": sheet_size[0], "h": sheet_size[1]},
        "fps": ANIMATION_FPS,
        "loop": True,
        "frames": [
            {
                "name": _frame_name(frame).removesuffix(".png"),
                "index": int(frame.get("index", 0)),
                "ts_ms": int(frame.get("ts_ms", 0)),
                "x": int(frame["x"]),
                "y": sheet_size[1] - int(frame["y"]) - int(frame["h"]),
                "w": int(frame["w"]),
                "h": int(frame["h"]),
            }
            for frame in meta["frames"]
        ],
    }


UNITY_IMPORTER = r"""using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

[Serializable]
public class SpriteForgeFrame
{
    public string name;
    public int x;
    public int y;
    public int w;
    public int h;
}

[Serializable]
public class SpriteForgeMeta
{
    public string image;
    public int fps = 12;
    public bool loop = true;
    public SpriteForgeFrame[] frames;
}

public class SpriteForgeImporter : AssetPostprocessor
{
    private void OnPreprocessTexture()
    {
        var texturePath = assetPath.Replace("\\", "/");
        if (!texturePath.EndsWith("spritesheet.png", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var jsonPath = Path.ChangeExtension(texturePath, ".spriteforge.json");
        if (!File.Exists(jsonPath))
        {
            return;
        }

        var meta = JsonUtility.FromJson<SpriteForgeMeta>(File.ReadAllText(jsonPath));
        if (meta == null || meta.frames == null || meta.frames.Length == 0)
        {
            return;
        }

        var importer = (TextureImporter)assetImporter;
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.alphaIsTransparency = true;
        importer.mipmapEnabled = false;
        importer.filterMode = FilterMode.Point;

        var sprites = new List<SpriteMetaData>();
        foreach (var frame in meta.frames)
        {
            sprites.Add(new SpriteMetaData
            {
                name = frame.name,
                rect = new Rect(frame.x, frame.y, frame.w, frame.h),
                alignment = (int)SpriteAlignment.Center,
                pivot = new Vector2(0.5f, 0.5f),
            });
        }
        importer.spritesheet = sprites.ToArray();
    }

    private void OnPostprocessTexture(Texture2D texture)
    {
        var texturePath = assetPath.Replace("\\", "/");
        if (!texturePath.EndsWith("spritesheet.png", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var jsonPath = Path.ChangeExtension(texturePath, ".spriteforge.json");
        if (!File.Exists(jsonPath))
        {
            return;
        }

        var clipPath = Path.Combine(Path.GetDirectoryName(texturePath), "sprite_forge_animation.anim").Replace("\\", "/");
        if (File.Exists(clipPath))
        {
            return;
        }

        var meta = JsonUtility.FromJson<SpriteForgeMeta>(File.ReadAllText(jsonPath));
        if (meta == null || meta.frames == null || meta.frames.Length == 0)
        {
            return;
        }

        var sprites = AssetDatabase.LoadAllAssetRepresentationsAtPath(texturePath);
        var keyedSprites = new Dictionary<string, Sprite>();
        foreach (var spriteObject in sprites)
        {
            if (spriteObject is Sprite sprite)
            {
                keyedSprites[sprite.name] = sprite;
            }
        }

        var bindings = new ObjectReferenceKeyframe[meta.frames.Length];
        for (var i = 0; i < meta.frames.Length; i++)
        {
            keyedSprites.TryGetValue(meta.frames[i].name, out var sprite);
            bindings[i] = new ObjectReferenceKeyframe
            {
                time = i / Mathf.Max(1f, meta.fps),
                value = sprite,
            };
        }

        var clip = new AnimationClip { frameRate = Mathf.Max(1, meta.fps) };
        var curveBinding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
        AnimationUtility.SetObjectReferenceCurve(clip, curveBinding, bindings);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = meta.loop;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.SaveAssets();
    }
}
"""


def _build_godot_tres(meta: dict) -> str:
    lines = ['[gd_resource type="SpriteFrames" format=3]\n']
    lines.append('[ext_resource type="Texture2D" path="res://spritesheet.png" id="1"]\n')

    atlas_ids = []
    for i, frame in enumerate(meta["frames"]):
        x = int(frame["x"])
        y = int(frame["y"])
        w = int(frame["w"])
        h = int(frame["h"])
        atlas_id = f"AtlasTexture_{i + 1}"
        atlas_ids.append(atlas_id)
        lines.append(f'\n[sub_resource type="AtlasTexture" id="{atlas_id}"]')
        lines.append(f'atlas = ExtResource("1")')
        lines.append(f"region = Rect2({x}, {y}, {w}, {h})")

    lines.append('\n[resource]')
    lines.append("animations = [{")

    frames_entries = []
    for atlas_id in atlas_ids:
        frames_entries.append(
            f'{{\n"duration": 1.0,\n"texture": SubResource("{atlas_id}")\n}}'
        )
    frames_str = ", ".join(frames_entries)

    lines.append(f'"frames": [{frames_str}],')
    lines.append('"loop": true,')
    lines.append(f'"name": &"{meta.get("name", "default")}",')
    lines.append(f'"speed": {float(meta.get("fps", ANIMATION_FPS)):.1f}')
    lines.append("}]")

    return "\n".join(lines) + "\n"


def build_engine_export(job_id: str, job_dir: Path, zip_path: Path, target: ExportTarget) -> None:
    meta = _read_meta(job_dir)
    sheet_size = _sheet_size(job_dir)
    zip_path.unlink(missing_ok=True)

    if target == "generic":
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in job_dir.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(job_dir))
        return

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        if target == "cocos":
            archive.write(job_dir / "spritesheet.png", "cocos/spritesheet.png")
            archive.writestr(
                "cocos/spritesheet.plist",
                plistlib.dumps(_build_cocos_plist(meta, sheet_size)).decode("utf-8"),
            )
            archive.writestr(
                "cocos/animation.json",
                json.dumps(_build_animation_meta(meta), ensure_ascii=False, indent=2),
            )
            _write_readme(archive, "cocos", "Cocos Creator")
            return

        if target == "unity":
            archive.write(job_dir / "spritesheet.png", "unity/spritesheet.png")
            archive.writestr(
                "unity/spritesheet.spriteforge.json",
                json.dumps(_build_unity_meta(meta, sheet_size), ensure_ascii=False, indent=2),
            )
            archive.writestr("unity/Editor/SpriteForgeImporter.cs", UNITY_IMPORTER)
            _write_readme(archive, "unity", "Unity3D")
            return

        if target == "godot":
            archive.write(job_dir / "spritesheet.png", "godot/spritesheet.png")
            archive.writestr("godot/spritesheet.json", (job_dir / "spritesheet.json").read_text(encoding="utf-8"))
            archive.writestr("godot/sprite_frames.tres", _build_godot_tres(meta))
            _write_readme(archive, "godot", "Godot 4")
            return

    raise ValueError(f"不支持的导出目标: {target}")


def build_image_export(job_id: str, job_dir: Path, zip_path: Path) -> None:
    zip_path.unlink(missing_ok=True)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        root = f"image_segments_{job_id}"
        _write_readme(archive, root, "图片切图")

        for filename in ("spritesheet.png", "spritesheet.json", "manifest.json"):
            source_path = job_dir / filename
            if source_path.exists():
                archive.write(source_path, f"{root}/{filename}")

        items_dir = job_dir / "items"
        if items_dir.exists():
            for item_path in sorted(items_dir.glob("*.png")):
                archive.write(item_path, f"{root}/items/{item_path.name}")
