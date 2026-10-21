#!/usr/bin/env python3
"""update_manifest.py v3 — создаёт/обновляет manifest.json галереи (схема v1 или v2).

  python scripts/update_manifest.py gallery/bounty
  python scripts/update_manifest.py --all gallery --upgrade
  python scripts/update_manifest.py gallery/bounty --schema 1 --dry-run
  python scripts/update_manifest.py --all gallery --check      # только проверка по JSON Schema

Манифест без schemaVersion считается v1. v1 пишется без маркера, v2 — с "schemaVersion": 2.
"""
from __future__ import annotations
import argparse, json, re, shutil, sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

EXT = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
SCHEMA_LATEST = 2
SCHEMA_FILE = "gallery-manifest.schema.json"

# Однозначная миграция (ТЗ v4, раздел 6)
AUTO_MAP = {"hull": ["hull"], "deck": ["deck"]}
LEGACY_ONLY = {"overall", "details", "rigging"}  # требуют ручного подтверждения

# Подсказки по caption/alt (только в suggested)
HINTS = [
    (r"\bfront\b|\bbow\b", "bow-view"), (r"\bstern\b|\brear\b", "stern-view"),
    (r"\bside\b|\bstarboard\b|\bport\b", "side-view"), (r"\btop\b|\bplan\b", "top-view"),
    (r"\bclose|\bdetail", "close-up"), (r"\bcommon\b|\boverall\b|\bgeneral\b", "overall-view"),
    (r"\bhull\b", "hull"), (r"\bdeck\b", "deck"), (r"\bmast", "masts"),
    (r"\byard", "yards"), (r"\bblock", "blocks"), (r"\bratline", "ratlines"),
    (r"\bshroud", "shrouds"), (r"\bstern\b", "stern"), (r"\bfitting|\bhatch\b|\brudder\b", "fittings"),
    (r"\bstanding rigging\b", "standing-rigging"), (r"\brunning rigging\b", "running-rigging"),
    (r"\bcopper|\bcoppering\b", "coppering"),
]

def nat_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]

def slug_to_title(slug: str) -> str:
    return " ".join(p.capitalize() for p in slug.split("-"))

def orientation(w: int, h: int) -> str:
    return "landscape" if w > h else "portrait" if w < h else "square"

def infer_order(stem: str, fallback: int) -> int:
    p = stem.split("-", 1)[0]
    return int(p) if p.isdigit() else (int(stem) if stem.isdigit() else fallback)

def draft_caption(stem: str) -> str:
    s = stem
    if "-" in s and s.split("-", 1)[0].isdigit():
        s = s.split("-", 1)[1]
    return s.replace("-", " ").strip().capitalize() if not s.isdigit() else f"Photo {s}"

def rel_path(slug: str, kind: str, filename: str) -> str:
    return f"{slug}/{kind}/{filename}"

def as_list(v) -> list[str]:
    if v is None or v == "":
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]

def detect_version(cur: dict) -> int | None:
    """None — манифеста нет; нет schemaVersion → v1."""
    if not cur:
        return None
    try:
        return int(cur.get("schemaVersion", 1))
    except (TypeError, ValueError):
        raise ValueError(f"invalid schemaVersion: {cur.get('schemaVersion')!r}")

def load_taxonomy(gallery_root: Path) -> dict[str, dict]:
    for p in (gallery_root / "index" / "taxonomy.json", gallery_root / "taxonomy.json"):
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            terms = data["terms"] if isinstance(data, dict) else data
            return {t["slug"]: t for t in terms}
    return {}

def suggest(caption: str, alt: str, taxonomy: dict) -> list[str]:
    text = f"{caption} {alt}".lower()
    out = [slug for rx, slug in HINTS if re.search(rx, text)]
    out = list(dict.fromkeys(out))
    return [s for s in out if not taxonomy or s in taxonomy]

def section_v2(cur: dict, taxonomy: dict, upgrade: bool, caption: str, alt: str):
    """Возвращает (section[], legacySection|None, review, suggested[])."""
    raw = cur.get("section")
    legacy = cur.get("legacySection")
    review = bool(cur.get("review", False))
    sugg = cur.get("suggested", [])
    if isinstance(raw, list):                 # уже v2 — ничего не трогаем
        return raw, legacy, review, sugg
    if raw is None or raw == "":              # новый снимок
        return [], None, True, suggest(caption, alt, taxonomy)
    if not upgrade:                           # строка без разрешения на миграцию
        return as_list(raw), legacy, review, sugg
    if raw in AUTO_MAP:
        return AUTO_MAP[raw], raw, False, []
    return [], raw, True, suggest(caption, alt, taxonomy)

def section_v1(cur: dict) -> str:
    """v1: section — строка. Из v2 берём legacySection; иначе только однозначные hull/deck."""
    raw = cur.get("section")
    if isinstance(raw, list):
        legacy = cur.get("legacySection")
        if isinstance(legacy, str) and legacy:
            return legacy
        for s in raw:
            if s in AUTO_MAP:
                return s
        return "overall"
    return raw if raw else "overall"

def build_entry(slug, filename, low, hi, cur, fallback, ver, taxonomy, upgrade):
    src = hi if hi and hi.exists() else low
    if not src.exists():
        raise FileNotFoundError(filename)
    with Image.open(src) as im:
        w, h = im.size
    cur = cur or {}
    stem = Path(filename).stem
    caption = cur.get("caption", draft_caption(stem))
    alt = cur.get("alt", f"{slug_to_title(slug)}, {caption.lower()}")
    entry = dict(cur)                                  # сохраняем неизвестные поля
    entry.update({
        "file": filename,
        "order": cur.get("order", infer_order(stem, fallback)),
        "caption": caption, "alt": alt,
        "lead": bool(cur.get("lead", False)),
        "orientation": orientation(w, h), "width": w, "height": h,
        "paths": {
            "lowRes": rel_path(slug, "low-res", filename) if low.exists() else None,
            "hiRes": rel_path(slug, "hi-res", filename) if hi and hi.exists() else None,
        },
    })
    if ver >= 2:
        sec, legacy, review, sugg = section_v2(cur, taxonomy, upgrade, caption, alt)
        entry["section"] = sec
        if legacy is not None:
            entry["legacySection"] = legacy
        entry["review"] = review
        if sugg and review:
            entry["suggested"] = sugg
        else:
            entry.pop("suggested", None)
    else:
        entry["section"] = section_v1(cur)
        for k in ("legacySection", "review", "suggested"):
            entry.pop(k, None)
    return entry

def validate(slug, images, taxonomy, ver):
    warns = []
    leads = [i["file"] for i in images if i["lead"]]
    if len(leads) != 1:
        warns.append(f"lead images: {len(leads)} {leads}")
    orders = [i["order"] for i in images]
    if len(orders) != len(set(orders)):
        warns.append("duplicate order values")
    if ver >= 2:
        for i in images:
            sec = i["section"]
            if len(sec) != len(set(sec)):
                warns.append(f"{i['file']}: duplicate terms in section")
            if not sec and not i.get("review"):
                warns.append(f"{i['file']}: empty section requires review=true")
            if taxonomy:
                for s in sec:
                    t = taxonomy.get(s)
                    if not t:
                        warns.append(f"{i['file']}: unknown term '{s}'")
                    elif t.get("status", "active") != "active" or "gallery" not in t.get("appliesTo", ["gallery"]):
                        warns.append(f"{i['file']}: term '{s}' not allowed for gallery")
        n = sum(1 for i in images if not i["section"])
        if n:
            warns.append(f"{n} image(s) without terms (review needed)")
    return warns

def load_schema_validator(gallery_root: Path):
    """Опционально: jsonschema + gallery/gallery-manifest.schema.json."""
    p = gallery_root / SCHEMA_FILE
    if not p.exists():
        print(f"  note: {SCHEMA_FILE} not found — schema check skipped", file=sys.stderr)
        return None
    try:
        import jsonschema
    except ImportError:
        print("  note: jsonschema not installed — schema check skipped (pip install jsonschema)", file=sys.stderr)
        return None
    schema = json.loads(p.read_text(encoding="utf-8"))
    cls = jsonschema.validators.validator_for(schema)
    return cls(schema)

def schema_errors(validator, manifest: dict) -> list[str]:
    if validator is None:
        return []
    out = []
    for e in sorted(validator.iter_errors(manifest), key=lambda e: list(e.absolute_path)):
        loc = "/".join(str(x) for x in e.absolute_path) or "(root)"
        out.append(f"schema: {loc}: {e.message}")
    return out

def update_manifest(model_dir: Path, args, taxonomy, validator) -> bool:
    """Возвращает False, если есть ошибки (для кода возврата)."""
    slug = model_dir.name
    low_dir, hi_dir = model_dir / "low-res", model_dir / "hi-res"
    mpath = model_dir / "manifest.json"

    cur: dict = {}
    if mpath.exists():
        try:
            cur = json.loads(mpath.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"  [error] {slug}: broken manifest — {e}", file=sys.stderr)
            return False
    try:
        existing_ver = detect_version(cur)
    except ValueError as e:
        print(f"  [error] {slug}: {e}", file=sys.stderr)
        return False

    if args.check:
        if not cur:
            print(f"  [skip] {slug}: no manifest")
            return True
        errs = schema_errors(validator, cur)
        warns = validate(slug, cur.get("images", []), taxonomy, existing_ver) if existing_ver else []
        print(f"  [{'FAIL' if errs else 'ok'}] {slug}: v{existing_ver}, {len(errs)} schema error(s)")
        for m in errs + warns:
            print(f"      {m}", file=sys.stderr)
        return not errs

    names = set()
    for d in (low_dir, hi_dir):
        if d.is_dir():
            names |= {p.name for p in d.iterdir() if p.suffix.lower() in EXT}
    names = sorted(names, key=nat_key)
    if not names:
        print(f"  [skip] {slug}: no images")
        return True

    if args.schema:
        ver = args.schema
    elif existing_ver is None or args.upgrade:
        ver = SCHEMA_LATEST
    else:
        ver = existing_ver
    # миграция v1-строк в v2 — при --upgrade или явном --schema 2 поверх v1
    upgrade = ver >= 2 and (args.upgrade or (args.schema == 2 and (existing_ver or 1) == 1 and bool(cur)))

    old = {i["file"]: i for i in cur.get("images", [])}
    images, errors = [], []
    for idx, fn in enumerate(names, 1):
        try:
            images.append(build_entry(slug, fn, low_dir / fn, hi_dir / fn if hi_dir.is_dir() else None,
                                      old.get(fn), idx, ver, taxonomy, upgrade))
        except Exception as e:
            errors.append(f"{fn}: {e}")
    orphans = sorted(set(old) - set(names), key=nat_key)

    images.sort(key=lambda i: (i["order"], nat_key(i["file"])))
    leads = [i for i in images if i["lead"]]
    if not leads and images:
        next((i for i in images if i["orientation"] == "landscape"), images[0])["lead"] = True
    elif len(leads) > 1:
        for extra in leads[1:]:
            extra["lead"] = False

    title = cur.get("title", slug_to_title(slug))
    manifest = {k: v for k, v in cur.items() if k != "images"}   # неизвестные поля сохраняем
    manifest.update({
        "schemaVersion": ver,
        "slug": cur.get("slug", slug),
        "title": title,
        "scale": cur.get("scale", ""),
        "galleryTitle": cur.get("galleryTitle", f"{title} — Gallery"),
        "buildLogUrl": cur.get("buildLogUrl", f"/builds/{slug}"),
        "breadcrumbs": cur.get("breadcrumbs", [
            {"label": "Builds", "href": "/builds"},
            {"label": title, "href": f"/builds/{slug}"},
            {"label": "Gallery", "href": f"/builds/{slug}/gallery"}]),
        "meta": cur.get("meta", {"status": "In progress", "focus": "", "viewerMode": "hi-res overlay"}),
        "images": images,
    })
    if ver == 1:
        manifest.pop("schemaVersion")                # v1 остаётся без маркера

    warns = validate(slug, images, taxonomy, ver)
    warns += schema_errors(validator, manifest)
    if not manifest["scale"]:
        warns.append("scale is empty — fill it in manually")
    mode = "create" if not cur else f"v{existing_ver}→v{ver}" if existing_ver != ver else f"update v{ver}"
    print(f"  [{'dry' if args.dry_run else 'ok'}] {slug}: {len(images)} images, {mode}")
    for w in warns:
        print(f"      warn: {w}", file=sys.stderr)
    for e in errors:
        print(f"      skipped {e}", file=sys.stderr)
    for o in orphans:
        print(f"      orphan (no file on disk, dropped): {o}", file=sys.stderr)
    if args.dry_run:
        return not errors

    if mpath.exists() and not args.no_backup:
        shutil.copy2(mpath, mpath.with_suffix(".json.bak"))
    tmp = mpath.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(mpath)
    return not errors

def update_index(root: Path, slugs: list[str], dry: bool) -> None:
    if dry:
        return
    d = root / "index"
    d.mkdir(parents=True, exist_ok=True)
    (d / "models.json").write_text(json.dumps(slugs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [ok] index/models.json → {len(slugs)} entries")

def main() -> None:
    ap = argparse.ArgumentParser(description="Create/update gallery manifest.json (schema v1 or v2).")
    ap.add_argument("path", nargs="?", default="gallery")
    ap.add_argument("--all", action="store_true", help="path is the gallery root; process all models")
    ap.add_argument("--schema", type=int, choices=(1, 2), help="force output schema version")
    ap.add_argument("--upgrade", action="store_true", help="convert v1 → v2 (auto-migrate hull/deck)")
    ap.add_argument("--check", action="store_true", help="only validate existing manifests against the JSON Schema")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-backup", action="store_true")
    args = ap.parse_args()

    root = Path(args.path)
    if not root.is_dir():
        sys.exit(f"Error: {root} is not a directory")
    gallery_root = root if args.all else root.parent
    taxonomy = load_taxonomy(gallery_root)
    if not taxonomy:
        print("  note: taxonomy.json not found — term validation skipped", file=sys.stderr)
    validator = load_schema_validator(gallery_root)

    ok = True
    if args.all:
        slugs = sorted(d.name for d in root.iterdir() if d.is_dir() and not d.name.startswith(("_", "index"))
                       and ((d / "low-res").is_dir() or (d / "hi-res").is_dir()))
        print(f"Scanning {root} → {len(slugs)} model(s)")
        for s in slugs:
            ok &= update_manifest(root / s, args, taxonomy, validator)
        if not args.check:
            update_index(root, slugs, args.dry_run)
    else:
        ok = update_manifest(root, args, taxonomy, validator)
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
