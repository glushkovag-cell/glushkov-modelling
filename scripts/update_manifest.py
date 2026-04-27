#!/usr/bin/env python3
"""
update_manifest.py
==================
Scans a model gallery folder (public/gallery/<slug>/) and writes or updates
the manifest.json used by the Astro gallery pages at build time.

Usage
-----
  # Single model
  python scripts/update_manifest.py public/gallery/le-requin

  # All models (scans every subfolder that contains low-res/ or hi-res/)
  python scripts/update_manifest.py --all public/gallery

Requirements
------------
  pip install Pillow

Folder layout expected
----------------------
  public/gallery/
    <slug>/
      low-res/   ← grid preview WebP files (~1000px wide, < 150 KB)
      hi-res/    ← viewer source WebP files (3840×2560 recommended)
      manifest.json  ← created/updated by this script

manifest.json schema
--------------------
  See manifest.sample.json for the full reference.
  Fields populated automatically: file, orientation, width, height, paths.
  Fields preserved from existing manifest:  order, section, caption, alt,
    lead, slug, title, scale, galleryTitle, buildLogUrl, breadcrumbs, meta.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow is required: pip install Pillow", file=sys.stderr)
    sys.exit(1)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}


# ── String helpers ────────────────────────────────────────────────────────────

def slug_to_title(slug: str) -> str:
    """'le-requin' → 'Le Requin'"""
    return " ".join(part.capitalize() for part in slug.split("-"))


def infer_orientation(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    if width < height:
        return "portrait"
    return "square"


def infer_order(stem: str, fallback: int) -> int:
    """'001-overall-starboard' → 1"""
    prefix = stem.split("-", 1)[0]
    return int(prefix) if prefix.isdigit() else fallback


def draft_caption(stem: str) -> str:
    """'001-overall-starboard' → 'Overall starboard'"""
    s = stem
    prefix = s.split("-", 1)[0]
    if prefix.isdigit() and "-" in s:
        s = s.split("-", 1)[1]
    return s.replace("-", " ").strip().capitalize()


# ── Entry builder ─────────────────────────────────────────────────────────────

def build_entry(
    slug: str,
    filename: str,
    low_path: Path,
    hi_path: Path | None,
    existing: dict | None,
    fallback_order: int,
) -> dict:
    """Build a single image entry, reusing any existing editorial metadata."""

    source = hi_path if (hi_path and hi_path.exists()) else low_path
    if not source.exists():
        raise FileNotFoundError(f"Neither low-res nor hi-res exists for {filename!r}")

    with Image.open(source) as img:
        width, height = img.size

    current = existing or {}
    stem = Path(filename).stem

    return {
        "file":        filename,
        "order":       current.get("order", infer_order(stem, fallback_order)),
        "section":     current.get("section", "overall"),
        "caption":     current.get("caption", draft_caption(stem)),
        "alt":         current.get("alt", f"{slug_to_title(slug)}, {draft_caption(stem).lower()}"),
        "lead":        current.get("lead", False),
        "orientation": infer_orientation(width, height),
        "width":       width,
        "height":      height,
        "paths": {
            "lowRes": f"{slug}/low-res/{filename}" if low_path.exists() else None,
            "hiRes":  f"{slug}/hi-res/{filename}"  if (hi_path and hi_path.exists()) else None,
        },
    }


# ── Manifest writer ───────────────────────────────────────────────────────────

def update_manifest(model_dir: Path, verbose: bool = True) -> None:
    slug = model_dir.name
    low_dir = model_dir / "low-res"
    hi_dir  = model_dir / "hi-res"
    manifest_path = model_dir / "manifest.json"

    # Collect all image filenames across both derivative folders
    filenames: set[str] = set()
    if low_dir.is_dir():
        filenames |= {p.name for p in low_dir.iterdir() if p.suffix.lower() in ALLOWED_EXTENSIONS}
    if hi_dir.is_dir():
        filenames |= {p.name for p in hi_dir.iterdir() if p.suffix.lower() in ALLOWED_EXTENSIONS}

    filenames = sorted(filenames)

    if not filenames:
        if verbose:
            print(f"  [skip] {slug}: no image files found in low-res/ or hi-res/")
        return

    # Load existing manifest (to preserve editorial metadata)
    current: dict = {}
    if manifest_path.exists():
        try:
            current = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"  [warn] {slug}: could not parse existing manifest — {exc}", file=sys.stderr)

    existing_map: dict[str, dict] = {
        item["file"]: item for item in current.get("images", [])
    }

    # Build image entries
    errors: list[str] = []
    images: list[dict] = []
    for index, filename in enumerate(filenames, start=1):
        low_path = low_dir / filename
        hi_path  = hi_dir / filename
        try:
            entry = build_entry(
                slug, filename, low_path,
                hi_path if hi_dir.is_dir() else None,
                existing_map.get(filename),
                index,
            )
            images.append(entry)
        except Exception as exc:
            errors.append(f"    {filename}: {exc}")

    if errors:
        print(f"  [warn] {slug}: skipped {len(errors)} file(s):", file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)

    # Sort by (order, filename)
    images.sort(key=lambda item: (item["order"], item["file"]))

    # Ensure exactly one lead image (prefer existing, else first landscape)
    has_lead = any(img["lead"] for img in images)
    if not has_lead and images:
        landscape = next((img for img in images if img["orientation"] == "landscape"), images[0])
        landscape["lead"] = True

    # Assemble manifest
    manifest = {
        "slug":         current.get("slug", slug),
        "title":        current.get("title", slug_to_title(slug)),
        "scale":        current.get("scale", "1:48"),
        "galleryTitle": current.get("galleryTitle", f"{slug_to_title(slug)} — Gallery"),
        "buildLogUrl":  current.get("buildLogUrl", f"/builds/{slug}"),
        "breadcrumbs":  current.get("breadcrumbs", [
            {"label": "Builds",           "href": "/builds"},
            {"label": slug_to_title(slug),"href": f"/builds/{slug}"},
            {"label": "Gallery",          "href": f"/builds/{slug}/gallery"},
        ]),
        "meta": current.get("meta", {
            "status":     "In progress",
            "focus":      "Overall views, rigging, deck details",
            "viewerMode": "hi-res overlay",
        }),
        "images": images,
    }

    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if verbose:
        lead_file = next((img["file"] for img in images if img["lead"]), "—")
        print(f"  [ok] {slug}: {len(images)} images, lead={lead_file} → {manifest_path}")


def update_index(gallery_root: Path, slugs: list[str]) -> None:
    """Write index/models.json with the ordered list of gallery slugs."""
    index_dir = gallery_root / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    index_path = index_dir / "models.json"
    index_path.write_text(json.dumps(slugs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [ok] index/models.json → {len(slugs)} entries")


# ── CLI entry ─────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update gallery manifest.json for one or all model folders.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "path",
        nargs="?",
        default="public/gallery/le-requin",
        help="Path to a single model folder (default: public/gallery/le-requin)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Scan all model subfolders inside the given path (treat path as gallery root)",
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress informational output",
    )
    args = parser.parse_args()

    root = Path(args.path)
    verbose = not args.quiet

    if args.all:
        gallery_root = root
        if not gallery_root.is_dir():
            print(f"Error: {gallery_root} is not a directory", file=sys.stderr)
            sys.exit(1)
        slugs = sorted(
            d.name for d in gallery_root.iterdir()
            if d.is_dir() and not d.name.startswith("_")
            and ((d / "low-res").is_dir() or (d / "hi-res").is_dir())
        )
        if verbose:
            print(f"Scanning {gallery_root} → {len(slugs)} model folder(s)\n")
        for slug in slugs:
            update_manifest(gallery_root / slug, verbose=verbose)
        print()
        update_index(gallery_root, slugs)
    else:
        model_dir = root
        if not model_dir.is_dir():
            print(f"Error: {model_dir} is not a directory", file=sys.stderr)
            sys.exit(1)
        update_manifest(model_dir, verbose=verbose)


if __name__ == "__main__":
    main()
