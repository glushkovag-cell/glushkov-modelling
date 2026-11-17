#!/usr/bin/env python3
"""Reproducible no-load calibration of the rope-diameter model.

Model (no tension load, strands always 3):

    u = ln(x / 300), v = ln(n)
    D = exp(c0 + c1*u + c2*v + c3*u^2)

where x is the dTex of the purchased thread, n is the number of threads per
strand and D is the finished rope diameter in mm.

The script rebuilds every artefact under ``data/rope-calibration/no-load/``:

1. reads ``normalized.csv`` (authoritative for row identity, excelRow) and
   cross-checks it against sheet "Общая таблица" of ``threads_merged.xlsx``;
2. takes the 143 type-P measurements (130 old + 13 new, new = rows 175-187);
3. removes Excel rows 179, 180 and 181 (UNI-C 20D 22.22 dTex) from the working
   sample only - the source files are never modified;
4. averages 10 groups of identical thread + dTex + n (identity: barcode if
   present, else the exact series, else the manufacturer field), with the
   <= 15 % within-group spread rule and the documented explicit exception for
   Skala 360 n=2; every aggregated row carries weight 1;
5. excludes Excel rows 95 and 133 as pre-existing exceptions, leaving the
   128-row training set (121 old + 7 new);
6. fits the four coefficients by minimising the sum of squared RELATIVE
   errors, then evaluates training / LOFO (22 families) / subset metrics and
   the old-only -> new-7 transfer metric;
7. writes coefficients.json, results.json, cleaned_130.csv, training_128.csv,
   averaging-log.csv, README.md and SHA256SUMS.json, and prints a comparison
   table against the published ground truth.

Usage:
    python3 data/rope-calibration/calibrate_no_load.py            # rebuild
    python3 data/rope-calibration/calibrate_no_load.py --check    # verify only

``--check`` writes nothing and exits non-zero when the fit drifts from the
published coefficients by more than 1e-6 (relative) or when a metric drifts
from its published value by more than 0.02 percentage points (0.02 % relative
for the millimetre metrics).

Runtime is a few seconds; only numpy and scipy are required (the xlsx
cross-check uses a small standard-library reader, openpyxl is not needed).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import platform
import re
import sys
import time
import zipfile
from decimal import Decimal
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import scipy
from scipy.optimize import least_squares

HERE = Path(__file__).resolve().parent
XLSX_PATH = HERE / "threads_merged.xlsx"
NORMALIZED_PATH = HERE / "normalized.csv"
OUT_DIR = HERE / "no-load"
SHEET = "Общая таблица"

# ---------------------------------------------------------------------------
# Published ground truth (must be reproduced, never hard-coded into the fit).
# ---------------------------------------------------------------------------
SPEC_COEFFICIENTS: dict[str, float] = {
    "c0": -0.8841755979848913,
    "c1": 0.6318544934210768,
    "c2": 0.5435747556354212,
    "c3": -0.061470048768181726,
}
COEFFICIENT_NAMES = ("c0", "c1", "c2", "c3")
COEFFICIENT_RTOL = 1e-6
METRIC_PP_TOL = 0.02          # percentage points, for every *Percent metric
METRIC_MM_RTOL = 2e-4         # 0.02 % relative, for millimetre metrics

EXPECTED_METRICS: tuple[tuple[str, float, str], ...] = (
    ("training.all.rmspePercent", 8.87, "pp"),
    ("lofo.all.rmspePercent", 10.20, "pp"),
    ("lofo.all.mapePercent", 6.53, "pp"),
    ("lofo.all.maeMm", 0.03596, "mm"),
    ("lofo.all.rmseMm", 0.04496, "mm"),
    ("lofo.new.rmspePercent", 30.66, "pp"),
    ("lofo.new.mapePercent", 23.61, "pp"),
    ("lofo.old.rmspePercent", 7.46, "pp"),
    ("lofo.old.mapePercent", 5.55, "pp"),
    ("oldOnlyToNew.rmspePercent", 58.64, "pp"),
)

# Published fixture facts for the final sample.
FIXTURE_PREDICTION_DTEX = 22.22
FIXTURE_PREDICTION_N = 1
FIXTURE_PREDICTION_MM = 0.05259208341950491
FIXTURE_UNI_C_MEASURED = {1: 0.050, 2: 0.086}

# SHA-256 values documented in data/rope-calibration/README.md.  The two input
# files must never change; the script fails loudly if they do.
DOCUMENTED_INPUT_SHA256 = {
    "threads_merged.xlsx": "4924e12a2046b9fb034cee444b285fb22da43904ce6e923564ecdd24ebb056eb",
    "normalized.csv": "4b015f8991f4fc816dd4618fdd635715f6ae4bb056ecd132751b0c488b0dc0db",
}

# ---------------------------------------------------------------------------
# Sample rules.
# ---------------------------------------------------------------------------
DATA_ROWS = 186
USABLE_TOTAL = 143
USABLE_OLD = 130
USABLE_NEW = 13
FIRST_NEW_ROW = 175
REMOVED_ROWS = (179, 180, 181)
AFTER_REMOVAL = 140
SPREAD_LIMIT = 0.15
AVERAGING_GROUPS = 10
WORKING_ROWS = 130
WORKING_OLD = 123
WORKING_NEW = 7
TRAINING_EXCLUDED_ROWS = (95, 133)
TRAINING_ROWS = 128
TRAINING_OLD = 121
TRAINING_NEW = 7
FAMILY_COUNT = 22

REMOVED_REASON = (
    "UNI-C 20D 22.22 dTex: removed from the working sample by the sample rule "
    "(179/180 are the unsplit pair, 181 is the 0.048 mm outlier); the record "
    "is kept in threads_merged.xlsx and normalized.csv"
)
EXCLUDED_REASONS = {
    95: "Skala 240 5x3, measured 0.825 mm: pre-existing training exception",
    133: "Tera 30 2x3, measured 1.000 mm: pre-existing training exception",
}

# Groups that must be averaged, with the published mean diameter in mm.
# Keys are (identityKind, identity, dtex, n).
EXPECTED_MEANS: dict[tuple[str, str, float, int], float] = {
    ("series", "Skala 360", 80.0, 1): 0.1850,
    ("series", "Skala 360", 80.0, 2): 0.2800,
    ("series", "Skala 360", 80.0, 3): 0.3775,
    ("series", "Skala 240", 120.0, 1): 0.2200,
    ("series", "Skala 240", 120.0, 2): 0.3625,
    ("series", "Skala 240", 120.0, 3): 0.4650,
    ("barcode", "4606080151661", 315.0, 3): 0.7625,
    ("manufacturer", "TMC 16/0 W", 40.0, 1): 0.0760,
    ("manufacturer", "UNI-T 8/0 W", 80.0, 1): 0.1095,
    ("manufacturer", "UNI-T 8/0 W", 80.0, 2): 0.1680,
}

# Averaging groups that exceed SPREAD_LIMIT but are averaged by explicit user
# decision.  The decision and the spread are both recorded in the log.
EXPLICIT_AVERAGE_GROUPS = {
    ("series", "Skala 360", 80.0, 2): (
        "averaged by explicit user decision (within-group spread 15.4 % exceeds "
        "the 15 % limit)"
    ),
}

def cleaned_csv_row(row: dict) -> dict:
    return {
        "rowId": row["rowId"],
        "excelRows": row["excelRows"],
        "identityKind": row["identityKind"],
        "identity": row["identity"],
        "manufacturer": row["manufacturer"],
        "series": row["series"],
        "identifier": row["identifier"],
        "dtex": row["dtex"],
        "threadsPerStrand": row["n"],
        "diameterMm": row["diameterMm"],
        "family": row["family"],
        "isNew": row["isNew"],
        "aggregated": row["aggregated"],
        "sourceRowCount": row["sourceCount"],
        "weight": row["weight"],
        "loadGrams": row["loadGrams"],
        "source": row["source"],
        "position": row["position"],
    }


def training_csv_row(row: dict) -> dict:
    out = cleaned_csv_row(row)
    out["inTraining"] = row["inTraining"]
    out["exclusionReason"] = row["exclusionReason"]
    return out


CSV_COLUMNS = [
    ("manufacturer", 0),
    ("series", 1),
    ("identifier", 2),
    ("dtex", 3),
    ("threadDiameterMm", 4),
    ("ropeType", 5),
    ("construction", 6),
    ("diameterMm", 7),
    ("loadGrams", 8),
    ("source", 11),
    ("position", 12),
]

CLEANED_FIELDS = [
    "rowId", "excelRows", "identityKind", "identity", "manufacturer", "series",
    "identifier", "dtex", "threadsPerStrand", "diameterMm", "family", "isNew",
    "aggregated", "sourceRowCount", "weight", "loadGrams", "source", "position",
]
TRAINING_FIELDS = [
    "rowId", "excelRows", "identityKind", "identity", "manufacturer", "series",
    "identifier", "dtex", "threadsPerStrand", "diameterMm", "family", "isNew",
    "aggregated", "sourceRowCount", "weight", "inTraining", "exclusionReason",
]
AVERAGING_FIELDS = [
    "groupId", "identityKind", "identity", "dtex", "threadsPerStrand",
    "sourceExcelRows", "rawDiametersMm", "meanDiameterMm", "minDiameterMm",
    "maxDiameterMm", "spreadRelative", "spreadPercent", "spreadLimit",
    "qualifiesBySpread", "decision", "weight", "family", "isNew", "note",
]


class CalibrationError(RuntimeError):
    """Raised when a sample rule or a published number is not reproduced."""


# ---------------------------------------------------------------------------
# Generic helpers.
# ---------------------------------------------------------------------------
def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def num_text(value: float | int | None) -> str:
    """Shortest round-trip text: 80.0 -> '80', 0.3775 -> '0.3775'."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, int):
        return str(value)
    value = float(value)
    if value.is_integer():
        return str(int(value))
    return repr(value)


def csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (list, tuple)):
        return ";".join(csv_cell(v) for v in value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return num_text(value)
    return str(value)


def render_csv(fieldnames: Sequence[str], rows: Sequence[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({name: csv_cell(row.get(name)) for name in fieldnames})
    return buffer.getvalue()


def render_json(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def dig(document: Any, dotted: str) -> Any:
    node = document
    for part in dotted.split("."):
        node = node[part]
    return node


def family_of(manufacturer: str, series: str, dtex: float) -> str:
    """Thread family used for LOFO; one family = all constructions/repeats."""
    name = (series or manufacturer or "").strip()
    low = name.lower()
    if low == "n100" or (low == "poliestere" and dtex == 300):
        return "Gutermann Sew-all 300"
    if low == "40/2" and (manufacturer or "").strip() == "Gamma":
        return "Gamma 40/2"
    if low.startswith("extra strong m7"):
        return "Gutermann Extra Strong 750"
    if low == "poliestere" and dtex == 1000:
        return "Gutermann Top Stitch 1000"
    return name


# ---------------------------------------------------------------------------
# Input reading.
# ---------------------------------------------------------------------------
def read_normalized(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        raw = list(reader)
    rows = []
    for record in raw:
        dtex = record["dtex"]
        n = record["threadsPerStrand"]
        diameter = record["diameterMm"]
        load = record["loadGrams"]
        rows.append({
            "excelRow": int(record["excelRow"]),
            "manufacturer": record["manufacturer"],
            "series": record["series"],
            "identifier": record["identifier"],
            "dtex": float(dtex) if dtex else None,
            "threadDiameterMm": float(record["threadDiameterMm"]) if record["threadDiameterMm"] else None,
            "ropeType": record["ropeType"],
            "ropeTypeNormalized": record["ropeTypeNormalized"],
            "ropeTypeInferred": record["ropeTypeInferred"] == "True",
            "construction": record["construction"],
            "n": int(float(n)) if n else None,
            "diameterMm": float(diameter) if diameter else None,
            "loadGrams": float(load) if load else None,
            "source": record["source"],
            "position": record["position"],
            "isNew": record["isNew"] == "True",
            "usableCsv": record["usable"] == "True",
            "excludedCsv": record["excluded"] == "True",
            "inCalibrationCsv": record["inCalibration"] == "True",
            "familyCsv": record["family"],
        })
    return rows


def _column_index(ref: str) -> int:
    match = re.match(r"([A-Z]+)", ref or "")
    if not match:
        raise CalibrationError(f"Unparsable cell reference {ref!r}")
    index = 0
    for char in match.group(1):
        index = index * 26 + (ord(char) - 64)
    return index - 1


def read_xlsx_sheet(path: Path, sheet_name: str) -> dict[int, dict[int, Any]]:
    """Minimal stdlib .xlsx reader: enough for a flat numeric/text sheet."""
    main = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = {
            rel.get("Id"): rel.get("Target")
            for rel in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        }
        targets = {
            sheet.get("name"): rels[sheet.get(rel_ns + "id")]
            for sheet in workbook.find(main + "sheets")
        }
        if sheet_name not in targets:
            raise CalibrationError(f"Sheet {sheet_name!r} not found in {path.name}")
        target = targets[sheet_name]
        sheet_path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")

        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall(main + "si"):
                shared.append("".join(node.text or "" for node in item.iter(main + "t")))

        sheet = ET.fromstring(archive.read(sheet_path))
        table: dict[int, dict[int, Any]] = {}
        for row in sheet.iter(main + "row"):
            row_index = int(row.get("r"))
            cells: dict[int, Any] = {}
            for cell in row:
                ref = cell.get("r")
                if not ref:
                    continue
                column = _column_index(ref)
                cell_type = cell.get("t")
                value_node = cell.find(main + "v")
                if cell_type == "s":
                    value = shared[int(value_node.text)] if value_node is not None else ""
                elif cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.iter(main + "t"))
                elif cell_type == "str":
                    value = value_node.text if value_node is not None else ""
                elif cell_type == "b":
                    value = value_node is not None and value_node.text == "1"
                elif value_node is not None and value_node.text is not None:
                    try:
                        value = float(value_node.text)
                    except ValueError:
                        value = value_node.text
                else:
                    value = None
                cells[column] = value
            table[row_index] = cells
    return table


def xlsx_value_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, float):
        return num_text(value)
    return str(value)


def cross_check_xlsx(rows: list[dict], sheet: dict[int, dict[int, Any]]) -> dict:
    mismatches = []
    for row in rows:
        cells = sheet.get(row["excelRow"], {})
        for name, column in CSV_COLUMNS:
            expected = row[name]
            actual = cells.get(column)
            expected_text = csv_cell(expected)
            actual_text = xlsx_value_text(actual)
            if expected_text != actual_text:
                mismatches.append({
                    "excelRow": row["excelRow"],
                    "column": name,
                    "csv": expected_text,
                    "xlsx": actual_text,
                })
    return {
        "status": "match" if not mismatches else "mismatch",
        "sheet": SHEET,
        "comparedColumns": [name for name, _ in CSV_COLUMNS],
        "rowsCompared": len(rows),
        "mismatchCount": len(mismatches),
        "mismatches": mismatches,
    }


# ---------------------------------------------------------------------------
# Sample construction.
# ---------------------------------------------------------------------------
def identity_of(row: dict) -> tuple[str, str]:
    identifier = (row["identifier"] or "").strip()
    if identifier:
        return "barcode", identifier
    series = (row["series"] or "").strip()
    if series:
        return "series", series
    manufacturer = (row["manufacturer"] or "").strip()
    if manufacturer:
        return "manufacturer", manufacturer
    raise CalibrationError(f"Row {row['excelRow']} has no identity field")


def usable_by_rule(row: dict) -> bool:
    return (
        row["ropeTypeNormalized"] == "P"
        and row["n"] is not None
        and row["dtex"] is not None
        and row["diameterMm"] is not None
        and row["loadGrams"] is not None
    )


def _first(members: list[dict], field: str) -> str:
    for member in members:
        value = (member[field] or "").strip()
        if value:
            return value
    return ""


def select_sample(rows: list[dict]) -> dict:
    usable = [row for row in rows if usable_by_rule(row)]

    csv_mismatch = [row["excelRow"] for row in usable if not row["usableCsv"]]
    if csv_mismatch:
        raise CalibrationError(f"usable rule disagrees with normalized.csv on rows {csv_mismatch}")

    old_count = sum(not row["isNew"] for row in usable)
    new_count = sum(row["isNew"] for row in usable)
    if (len(usable), old_count, new_count) != (USABLE_TOTAL, USABLE_OLD, USABLE_NEW):
        raise CalibrationError(
            f"type-P sample is {len(usable)} ({old_count} old + {new_count} new), "
            f"expected {USABLE_TOTAL} ({USABLE_OLD} old + {USABLE_NEW} new)"
        )
    if max(row["excelRow"] for row in rows) - 1 != DATA_ROWS:
        raise CalibrationError("normalized.csv does not hold 186 data rows")

    removed = [
        {
            "excelRow": row["excelRow"],
            "manufacturer": row["manufacturer"],
            "series": row["series"],
            "dtex": row["dtex"],
            "threadsPerStrand": row["n"],
            "diameterMm": row["diameterMm"],
            "reason": REMOVED_REASON,
        }
        for row in usable if row["excelRow"] in REMOVED_ROWS
    ]
    if len(removed) != len(REMOVED_ROWS):
        raise CalibrationError(f"expected {len(REMOVED_ROWS)} removed rows, found {len(removed)}")

    kept = [row for row in usable if row["excelRow"] not in REMOVED_ROWS]
    if len(kept) != AFTER_REMOVAL:
        raise CalibrationError(f"{len(kept)} rows after removal, expected {AFTER_REMOVAL}")

    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for row in sorted(kept, key=lambda item: item["excelRow"]):
        kind, identity = identity_of(row)
        key = (kind, identity, float(row["dtex"]), int(row["n"]))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    cleaned: list[dict] = []
    averaging_log: list[dict] = []
    for key in order:
        kind, identity, dtex, n = key
        members = groups[key]
        diameters = [member["diameterMm"] for member in members]
        # Exact decimal mean of the reported measurements, rounded once to
        # float64: avoids the 1-ulp artefacts of binary summation
        # (0.172 + 0.164 -> 0.168, not 0.16799999999999998).
        mean_diameter = float(
            sum((Decimal(repr(float(value))) for value in diameters), Decimal(0))
            / Decimal(len(diameters))
        )
        families = {member["familyCsv"] for member in members}
        recomputed = {
            family_of(member["manufacturer"], member["series"], member["dtex"])
            for member in members
        }
        if recomputed != families:
            raise CalibrationError(
                f"family rule mismatch for rows {[m['excelRow'] for m in members]}: "
                f"{sorted(recomputed)} != {sorted(families)}"
            )
        if len({member["isNew"] for member in members}) != 1:
            raise CalibrationError(f"mixed old/new rows in group {key}")

        spread = 0.0
        if len(members) > 1:
            spread = (max(diameters) - min(diameters)) / min(diameters)

        exception = EXPLICIT_AVERAGE_GROUPS.get(key)
        qualifies = len(members) == 1 or spread <= SPREAD_LIMIT
        merge = qualifies or exception is not None

        if not merge:
            # A group that fails the spread rule is not averaged: the raw
            # measurements stay separate, each with weight 1.
            for member in members:
                cleaned.append(_cleaned_row(
                    member, [member], kind, identity, member["diameterMm"],
                    aggregated=False, member=member,
                ))
            averaging_log.append(_log_entry(
                len(averaging_log) + 1, key, members, diameters, mean_diameter,
                spread, False, "not-averaged-spread",
                "within-group spread exceeds the 15 % limit; raw rows kept separate",
            ))
            continue

        representative = members[0]
        merged = _cleaned_row(
            representative, members, kind, identity, mean_diameter,
            aggregated=len(members) > 1,
        )
        cleaned.append(merged)
        if len(members) > 1:
            decision = "averaged" if spread <= SPREAD_LIMIT else "averaged-by-explicit-decision"
            note = "" if spread <= SPREAD_LIMIT else exception
            averaging_log.append(_log_entry(
                len(averaging_log) + 1, key, members, diameters, mean_diameter,
                spread, True, decision, note,
            ))

    merged_log = [entry for entry in averaging_log if entry["decision"] != "not-averaged-spread"]
    if len(merged_log) != AVERAGING_GROUPS:
        raise CalibrationError(
            f"{len(merged_log)} averaged groups, expected {AVERAGING_GROUPS}"
        )
    if len(cleaned) != WORKING_ROWS:
        raise CalibrationError(f"{len(cleaned)} working rows, expected {WORKING_ROWS}")
    cleaned_old = sum(not row["isNew"] for row in cleaned)
    cleaned_new = sum(row["isNew"] for row in cleaned)
    if (cleaned_old, cleaned_new) != (WORKING_OLD, WORKING_NEW):
        raise CalibrationError(
            f"working rows are {cleaned_old} old + {cleaned_new} new, "
            f"expected {WORKING_OLD} old + {WORKING_NEW} new"
        )

    for entry in averaging_log:
        key = (entry["identityKind"], entry["identity"], float(entry["dtex"]), int(entry["threadsPerStrand"]))
        if key in EXPECTED_MEANS:
            if abs(entry["meanDiameterMm"] - EXPECTED_MEANS[key]) > 1e-12:
                raise CalibrationError(
                    f"mean for {key} is {entry['meanDiameterMm']!r}, "
                    f"expected {EXPECTED_MEANS[key]!r}"
                )
    merged_keys = {
        (entry["identityKind"], entry["identity"], float(entry["dtex"]), int(entry["threadsPerStrand"]))
        for entry in merged_log
    }
    if merged_keys != set(EXPECTED_MEANS):
        raise CalibrationError(
            "averaged-group set differs from the published groups: "
            f"extra={sorted(merged_keys - set(EXPECTED_MEANS))}, "
            f"missing={sorted(set(EXPECTED_MEANS) - merged_keys)}"
        )

    cleaned.sort(key=lambda row: row["excelRows"][0])
    for index, row in enumerate(cleaned, start=1):
        row["rowId"] = index

    print_excluded = []
    for row in kept:
        if row["excelRow"] not in TRAINING_EXCLUDED_ROWS:
            continue
        kind, identity = identity_of(row)
        print_excluded.append({
            "excelRow": row["excelRow"],
            "identityKind": kind,
            "identity": identity,
            "dtex": row["dtex"],
            "threadsPerStrand": row["n"],
            "diameterMm": row["diameterMm"],
            "family": row["familyCsv"],
            "reason": EXCLUDED_REASONS[row["excelRow"]],
        })
    if len(print_excluded) != len(TRAINING_EXCLUDED_ROWS):
        raise CalibrationError("training exclusion rows 95/133 not found")

    return {
        "usable": usable,
        "cleaned": cleaned,
        "averagingLog": averaging_log,
        "mergedLog": merged_log,
        "removed": removed,
        "exclusions": print_excluded,
    }


def _cleaned_row(representative: dict, members: list[dict], kind: str,
                 identity: str, diameter: float, *, aggregated: bool,
                 member: dict | None = None) -> dict:
    base = member if member is not None else representative
    return {
        "rowId": 0,
        "excelRows": [item["excelRow"] for item in members],
        "identityKind": kind,
        "identity": identity,
        "manufacturer": _first(members, "manufacturer"),
        "series": _first(members, "series"),
        "identifier": _first(members, "identifier"),
        "dtex": float(base["dtex"]),
        "n": int(base["n"]),
        "diameterMm": float(diameter),
        "family": base["familyCsv"],
        "isNew": bool(base["isNew"]),
        "aggregated": aggregated,
        "sourceCount": len(members),
        "weight": 1,
        "loadGrams": base["loadGrams"],
        "source": base["source"],
        "position": base["position"],
    }


def _log_entry(group_id: int, key: tuple, members: list[dict], diameters: list[float],
               mean: float, spread: float, qualifies: bool, decision: str,
               note: str) -> dict:
    kind, identity, dtex, n = key
    return {
        "groupId": group_id,
        "identityKind": kind,
        "identity": identity,
        "dtex": dtex,
        "threadsPerStrand": n,
        "sourceExcelRows": [member["excelRow"] for member in members],
        "rawDiametersMm": [float(value) for value in diameters],
        "meanDiameterMm": float(mean),
        "minDiameterMm": float(min(diameters)),
        "maxDiameterMm": float(max(diameters)),
        "spreadRelative": float(spread),
        "spreadPercent": float(spread * 100.0),
        "spreadLimit": SPREAD_LIMIT,
        "qualifiesBySpread": bool(qualifies),
        "decision": decision,
        "weight": 1,
        "family": members[0]["familyCsv"],
        "isNew": bool(members[0]["isNew"]),
        "note": note,
    }


def split_training(cleaned: list[dict]) -> tuple[list[dict], list[dict]]:
    training: list[dict] = []
    excluded: list[dict] = []
    for row in cleaned:
        row = dict(row)
        row["inTraining"] = not any(
            excel_row in TRAINING_EXCLUDED_ROWS for excel_row in row["excelRows"]
        )
        row["exclusionReason"] = "" if row["inTraining"] else ", ".join(
            EXCLUDED_REASONS[excel_row]
            for excel_row in row["excelRows"] if excel_row in TRAINING_EXCLUDED_ROWS
        )
        (training if row["inTraining"] else excluded).append(row)
    if (len(training), len(excluded)) != (TRAINING_ROWS, len(TRAINING_EXCLUDED_ROWS)):
        raise CalibrationError(
            f"training split is {len(training)}+{len(excluded)}, "
            f"expected {TRAINING_ROWS}+{len(TRAINING_EXCLUDED_ROWS)}"
        )
    old = sum(not row["isNew"] for row in training)
    if (old, len(training) - old) != (TRAINING_OLD, TRAINING_NEW):
        raise CalibrationError(
            f"training cohorts are {old} old + {len(training) - old} new, "
            f"expected {TRAINING_OLD} old + {TRAINING_NEW} new"
        )
    families = {row["family"] for row in training}
    if len(families) != FAMILY_COUNT:
        raise CalibrationError(f"{len(families)} families, expected {FAMILY_COUNT}")
    return training, excluded


# ---------------------------------------------------------------------------
# Model, fit and metrics.
# ---------------------------------------------------------------------------
def predict(coefficients: np.ndarray, dtex: np.ndarray, n: np.ndarray) -> np.ndarray:
    u = np.log(np.asarray(dtex, dtype=float) / 300.0)
    v = np.log(np.asarray(n, dtype=float))
    c0, c1, c2, c3 = coefficients
    return np.exp(c0 + c1 * u + c2 * v + c3 * u * u)


STARTS = (
    (-0.5, 0.60, 0.50, 0.00),
    (-0.9, 0.55, 0.50, -0.06),
    (0.0, 0.70, 0.40, -0.10),
)


def arrays(rows: Sequence[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    dtex = np.array([row["dtex"] for row in rows], dtype=float)
    n = np.array([row["n"] for row in rows], dtype=float)
    diameter = np.array([row["diameterMm"] for row in rows], dtype=float)
    return dtex, n, diameter


def fit_coefficients(rows: Sequence[dict]) -> tuple[np.ndarray, dict]:
    dtex, n, diameter = arrays(rows)

    def residuals(coefficients: np.ndarray) -> np.ndarray:
        return (predict(coefficients, dtex, n) - diameter) / diameter

    best = None
    for start in STARTS:
        result = least_squares(
            residuals,
            np.array(start, dtype=float),
            method="lm",
            xtol=1e-15,
            ftol=1e-15,
            gtol=1e-15,
            max_nfev=20000,
        )
        if not np.isfinite(result.cost):
            continue
        if best is None or result.cost < best.cost:
            best = result
    if best is None:
        raise CalibrationError("the least-squares fit did not converge")
    if best.optimality is not None and best.optimality > 1e-3:
        raise CalibrationError(f"the least-squares fit has optimality {best.optimality:.3e}")
    diagnostics = {
        "rows": len(rows),
        "starts": len(STARTS),
        "nfev": int(best.nfev),
        "optimality": float(best.optimality) if best.optimality is not None else None,
        "sumSquaredRelativeErrors": float(2.0 * best.cost),
    }
    return best.x.copy(), diagnostics


def metrics(predicted: np.ndarray, actual: np.ndarray) -> dict:
    predicted = np.asarray(predicted, dtype=float)
    actual = np.asarray(actual, dtype=float)
    if predicted.size == 0:
        return {
            "count": 0, "rmspePercent": 0.0, "mapePercent": 0.0,
            "maeMm": 0.0, "rmseMm": 0.0, "biasPercent": 0.0, "biasMm": 0.0,
        }
    relative = (predicted - actual) / actual
    error = predicted - actual
    return {
        "count": int(actual.size),
        "rmspePercent": float(math.sqrt(float(np.mean(relative ** 2))) * 100.0),
        "mapePercent": float(np.mean(np.abs(relative)) * 100.0),
        "maeMm": float(np.mean(np.abs(error))),
        "rmseMm": float(math.sqrt(float(np.mean(error ** 2)))),
        "biasPercent": float(np.mean(relative) * 100.0),
        "biasMm": float(np.mean(error)),
    }


def evaluate(coefficients: np.ndarray, rows: Sequence[dict]) -> dict:
    dtex, n, diameter = arrays(rows)
    return metrics(predict(coefficients, dtex, n), diameter)


def subset_metrics(predicted: np.ndarray, rows: Sequence[dict]) -> dict:
    actual = np.array([row["diameterMm"] for row in rows], dtype=float)
    is_new = np.array([row["isNew"] for row in rows], dtype=bool)
    return {
        "all": metrics(predicted, actual),
        "old": metrics(predicted[~is_new], actual[~is_new]),
        "new": metrics(predicted[is_new], actual[is_new]),
    }


def lofo(training: Sequence[dict]) -> tuple[np.ndarray, list[dict]]:
    families = sorted({row["family"] for row in training})
    predicted = np.zeros(len(training), dtype=float)
    folds = []
    for family in families:
        train_rows = [row for row in training if row["family"] != family]
        held_rows = [row for row in training if row["family"] == family]
        indices = [index for index, row in enumerate(training) if row["family"] == family]
        coefficients, _ = fit_coefficients(train_rows)
        held_predicted = predict(
            coefficients,
            np.array([row["dtex"] for row in held_rows], dtype=float),
            np.array([row["n"] for row in held_rows], dtype=float),
        )
        predicted[indices] = held_predicted
        folds.append({
            "family": family,
            "trainingRows": len(train_rows),
            "heldOutRows": len(held_rows),
            "coefficients": {
                name: float(value) for name, value in zip(COEFFICIENT_NAMES, coefficients)
            },
            "heldOut": evaluate(coefficients, held_rows),
        })
    return predicted, folds


# ---------------------------------------------------------------------------
# Ground-truth comparison.
# ---------------------------------------------------------------------------
def compare_ground_truth(coefficients: np.ndarray, metric_block: dict) -> tuple[list[dict], list[str]]:
    table = []
    problems = []
    for index, name in enumerate(COEFFICIENT_NAMES):
        reproduced = float(coefficients[index])
        expected = SPEC_COEFFICIENTS[name]
        delta = reproduced - expected
        relative = abs(delta) / abs(expected)
        ok = relative <= COEFFICIENT_RTOL
        table.append({
            "kind": "coefficient", "name": name, "reproduced": reproduced,
            "expected": expected, "delta": delta, "relative": relative,
            "tolerance": COEFFICIENT_RTOL, "ok": ok,
        })
        if not ok:
            problems.append(
                f"coefficient {name}: reproduced {reproduced!r}, expected {expected!r}, "
                f"relative deviation {relative:.3e} > {COEFFICIENT_RTOL:g}"
            )
    for path, expected, unit in EXPECTED_METRICS:
        reproduced = float(dig(metric_block, path))
        delta = reproduced - expected
        tolerance = METRIC_PP_TOL if unit == "pp" else METRIC_MM_RTOL * abs(expected)
        ok = abs(delta) <= tolerance
        table.append({
            "kind": "metric", "name": path, "reproduced": reproduced,
            "expected": expected, "delta": delta, "unit": unit,
            "tolerance": tolerance, "ok": ok,
        })
        if not ok:
            problems.append(
                f"metric {path}: reproduced {reproduced!r}, expected {expected!r}, "
                f"delta {delta:+.6g} exceeds tolerance {tolerance:.6g}"
            )
    return table, problems


def print_comparison(table: list[dict]) -> None:
    print()
    print("Coefficients")
    print(f"  {'name':4s} {'reproduced':>22s} {'published':>22s} {'rel.dev':>11s} {'tol':>8s}  status")
    for entry in table:
        if entry["kind"] != "coefficient":
            continue
        print(
            f"  {entry['name']:4s} {entry['reproduced']:>22.16f} {entry['expected']:>22.16f} "
            f"{entry['relative']:>11.3e} {entry['tolerance']:>8.0e}  {'ok' if entry['ok'] else 'FAIL'}"
        )
    print()
    print("Metrics")
    print(f"  {'metric':34s} {'reproduced':>12s} {'published':>11s} {'delta':>11s} {'tol':>10s}  status")
    for entry in table:
        if entry["kind"] != "metric":
            continue
        delta_text = f"{entry['delta']:+.6f}" if entry["unit"] == "pp" else f"{entry['delta']:+.7f}"
        print(
            f"  {entry['name']:34s} {entry['reproduced']:>12.6f} {entry['expected']:>11.5f} "
            f"{delta_text:>11s} {entry['tolerance']:>10.6f}  {'ok' if entry['ok'] else 'FAIL'}"
        )


# ---------------------------------------------------------------------------
# Artefact rendering.
# ---------------------------------------------------------------------------
def build() -> dict:
    rows = read_normalized(NORMALIZED_PATH)
    if len(rows) != DATA_ROWS:
        raise CalibrationError(f"normalized.csv holds {len(rows)} rows, expected {DATA_ROWS}")
    excel_rows = [row["excelRow"] for row in rows]
    if excel_rows != list(range(2, 2 + DATA_ROWS)):
        raise CalibrationError("normalized.csv excelRow column is not 2..187")

    sheet = read_xlsx_sheet(XLSX_PATH, SHEET)
    cross_check = cross_check_xlsx(rows, sheet)

    sample = select_sample(rows)
    cleaned = sample["cleaned"]
    training, excluded = split_training(cleaned)

    coefficients, fit_diagnostics = fit_coefficients(training)

    training_predicted = predict(
        coefficients,
        np.array([row["dtex"] for row in training], dtype=float),
        np.array([row["n"] for row in training], dtype=float),
    )
    training_metrics = subset_metrics(training_predicted, training)
    lofo_predicted, folds = lofo(training)
    lofo_metrics = subset_metrics(lofo_predicted, training)

    old_rows = [row for row in training if not row["isNew"]]
    new_rows = [row for row in training if row["isNew"]]
    old_coefficients, old_diagnostics = fit_coefficients(old_rows)
    old_to_new = evaluate(old_coefficients, new_rows)

    metric_block = {
        "training": training_metrics,
        "lofo": lofo_metrics,
        "oldOnlyToNew": old_to_new,
    }

    # Fixture facts.
    uni_c = {
        row["n"]: row for row in cleaned
        if row["identity"] == "UNI-C 20D" and row["dtex"] == FIXTURE_PREDICTION_DTEX
    }
    fixture = {
        "measuredUniC": {
            str(n): {
                "excelRows": uni_c[n]["excelRows"],
                "measuredMm": uni_c[n]["diameterMm"],
                "publishedMm": FIXTURE_UNI_C_MEASURED[n],
                "matches": abs(uni_c[n]["diameterMm"] - FIXTURE_UNI_C_MEASURED[n]) < 1e-12,
            }
            for n in (1, 2)
        },
        "prediction": {
            "dtex": FIXTURE_PREDICTION_DTEX,
            "n": FIXTURE_PREDICTION_N,
            "publishedMm": FIXTURE_PREDICTION_MM,
            "fittedMm": float(predict(
                coefficients, np.array([FIXTURE_PREDICTION_DTEX]), np.array([FIXTURE_PREDICTION_N])
            )[0]),
            "specMm": float(predict(
                np.array([SPEC_COEFFICIENTS[name] for name in COEFFICIENT_NAMES]),
                np.array([FIXTURE_PREDICTION_DTEX]), np.array([FIXTURE_PREDICTION_N]),
            )[0]),
        },
    }
    fixture["prediction"]["fittedRelativeDeviation"] = abs(
        fixture["prediction"]["fittedMm"] - FIXTURE_PREDICTION_MM
    ) / FIXTURE_PREDICTION_MM
    fixture["prediction"]["specMatches"] = (
        abs(fixture["prediction"]["specMm"] - FIXTURE_PREDICTION_MM) < 1e-15
    )
    for cohort in ("measuredUniC",):
        for key, entry in fixture[cohort].items():
            if not entry["matches"]:
                raise CalibrationError(
                    f"UNI-C measured fixture for n={key} is {entry['measuredMm']!r}, "
                    f"published {entry['publishedMm']!r}"
                )
    if not fixture["prediction"]["specMatches"]:
        raise CalibrationError("the published 22.22 dTex n=1 prediction is not reproduced")

    # Per-row residuals for the chosen model.
    residuals = []
    for index, row in enumerate(training):
        residuals.append({
            "rowId": row["rowId"],
            "excelRows": row["excelRows"],
            "identity": row["identity"],
            "dtex": row["dtex"],
            "threadsPerStrand": row["n"],
            "measuredMm": row["diameterMm"],
            "family": row["family"],
            "isNew": row["isNew"],
            "trainingPredictedMm": float(training_predicted[index]),
            "trainingErrorMm": float(training_predicted[index] - row["diameterMm"]),
            "trainingRelErrorPercent": float(
                (training_predicted[index] - row["diameterMm"]) / row["diameterMm"] * 100.0
            ),
            "lofoPredictedMm": float(lofo_predicted[index]),
            "lofoErrorMm": float(lofo_predicted[index] - row["diameterMm"]),
            "lofoRelErrorPercent": float(
                (lofo_predicted[index] - row["diameterMm"]) / row["diameterMm"] * 100.0
            ),
        })

    table, problems = compare_ground_truth(coefficients, metric_block)

    families = []
    for name in sorted({row["family"] for row in training}):
        members = [row for row in training if row["family"] == name]
        families.append({
            "family": name,
            "members": len(members),
            "oldMembers": sum(not row["isNew"] for row in members),
            "newMembers": sum(row["isNew"] for row in members),
        })
    if len(families) != FAMILY_COUNT:
        raise CalibrationError(f"{len(families)} families, expected {FAMILY_COUNT}")

    source_sha = {
        "threads_merged.xlsx": sha256_file(XLSX_PATH),
        "normalized.csv": sha256_file(NORMALIZED_PATH),
    }
    documented_match = {
        name: source_sha[name] == value for name, value in DOCUMENTED_INPUT_SHA256.items()
    }
    if not all(documented_match.values()):
        raise CalibrationError(
            "source SHA-256 does not match data/rope-calibration/README.md: "
            + ", ".join(f"{name}={source_sha[name]}" for name, ok in documented_match.items() if not ok)
        )

    coefficients_document = {
        "schema": 1,
        "model": "rope-diameter-no-load",
        "formula": "D = exp(c0 + c1*u + c2*v + c3*u^2), u = ln(x/300), v = ln(n)",
        "variables": {
            "D": "finished rope diameter, mm",
            "x": "purchased thread linear density, dTex",
            "n": "threads per strand (strands are always 3)",
            "u": "ln(x / 300)",
            "v": "ln(n)",
        },
        "objective": (
            "minimise sum((D_calc - D_measured) / D_measured)^2 over the 128 "
            "training rows; every aggregated row has weight 1; no load term and "
            "no load weight"
        ),
        "fitted": {name: float(value) for name, value in zip(COEFFICIENT_NAMES, coefficients)},
        "spec": dict(SPEC_COEFFICIENTS),
        "maxRelativeDeviationFromSpec": float(
            max(abs(float(coefficients[index]) - SPEC_COEFFICIENTS[name]) / abs(SPEC_COEFFICIENTS[name])
                for index, name in enumerate(COEFFICIENT_NAMES))
        ),
        "support": {
            "threadsPerStrand": {"min": 1, "max": 5, "values": [1, 2, 3, 4, 5]},
            "customDtexRange": {"min": 22.22, "max": 6000},
            "measuredDtexRange": {"min": 22.22, "max": 3000},
            "diameterTolerance": 0.10,
        },
        "versions": {
            "model": "1.0.0",
            "calibration": "1.0.0",
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
        },
        "sample": {
            "aggregatedRows": WORKING_ROWS,
            "trainingRows": TRAINING_ROWS,
            "families": FAMILY_COUNT,
        },
        "source": {
            "file": "threads_merged.xlsx",
            "sheet": SHEET,
            "sha256": source_sha["threads_merged.xlsx"],
            "normalizedCsvSha256": source_sha["normalized.csv"],
        },
    }

    results_document = {
        "schema": 1,
        "model": "rope-diameter-no-load",
        "source": {
            "file": "threads_merged.xlsx",
            "sheet": SHEET,
            "sha256": source_sha["threads_merged.xlsx"],
            "normalizedCsv": "normalized.csv",
            "normalizedCsvSha256": source_sha["normalized.csv"],
            "documentedSha256": dict(DOCUMENTED_INPUT_SHA256),
            "documentedSha256Match": documented_match,
        },
        "xlsxCrossCheck": cross_check,
        "sample": {
            "dataRows": DATA_ROWS,
            "typePMeasurements": len(sample["usable"]),
            "typePOld": USABLE_OLD,
            "typePNew": USABLE_NEW,
            "newRows": [FIRST_NEW_ROW, 2 + DATA_ROWS - 1],
            "removedRows": sample["removed"],
            "afterRemoval": AFTER_REMOVAL,
            "averagingGroups": len(sample["mergedLog"]),
            "aggregatedRows": len(cleaned),
            "aggregatedOld": sum(not row["isNew"] for row in cleaned),
            "aggregatedNew": sum(row["isNew"] for row in cleaned),
            "trainingRows": len(training),
            "trainingOld": sum(not row["isNew"] for row in training),
            "trainingNew": sum(row["isNew"] for row in training),
            "excludedRows": sample["exclusions"],
            "families": len(families),
        },
        "averaging": {
            "spreadLimit": SPREAD_LIMIT,
            "groups": sample["mergedLog"],
        },
        "families": families,
        "coefficients": {
            "fitted": {name: float(value) for name, value in zip(COEFFICIENT_NAMES, coefficients)},
            "spec": dict(SPEC_COEFFICIENTS),
            "fit": fit_diagnostics,
            "oldOnlyFit": {
                "coefficients": {
                    name: float(value) for name, value in zip(COEFFICIENT_NAMES, old_coefficients)
                },
                **old_diagnostics,
            },
        },
        "metrics": metric_block,
        "lofoFolds": folds,
        "fixtureFacts": fixture,
        "residuals": residuals,
        "validation": {
            "ok": not problems,
            "tolerances": {
                "coefficientsRelative": COEFFICIENT_RTOL,
                "percentagePoints": METRIC_PP_TOL,
                "millimetresRelative": METRIC_MM_RTOL,
            },
            "comparison": table,
        },
    }

    files: dict[str, str] = {}
    files["cleaned_130.csv"] = render_csv(
        CLEANED_FIELDS, [cleaned_csv_row(row) for row in cleaned]
    )
    files["training_128.csv"] = render_csv(
        TRAINING_FIELDS, [training_csv_row(row) for row in training + excluded]
    )
    files["averaging-log.csv"] = render_csv(AVERAGING_FIELDS, sample["mergedLog"])
    files["coefficients.json"] = render_json(coefficients_document)
    files["results.json"] = render_json(results_document)
    files["README.md"] = render_readme(
        coefficients, table, metric_block, sample, families, fixture, source_sha,
        fit_diagnostics, len(cleaned), len(training), problems,
    )

    hashes = {name: sha256_bytes(text.encode("utf-8")) for name, text in files.items()}
    hashes["../threads_merged.xlsx"] = source_sha["threads_merged.xlsx"]
    hashes["../normalized.csv"] = source_sha["normalized.csv"]

    sums_document = {
        "schema": 1,
        "algorithm": "sha256",
        "generatedBy": "data/rope-calibration/calibrate_no_load.py",
        "pathsRelativeTo": "data/rope-calibration",
        "files": {
            "threads_merged.xlsx": source_sha["threads_merged.xlsx"],
            "normalized.csv": source_sha["normalized.csv"],
            "no-load/cleaned_130.csv": hashes["cleaned_130.csv"],
            "no-load/training_128.csv": hashes["training_128.csv"],
            "no-load/averaging-log.csv": hashes["averaging-log.csv"],
            "no-load/coefficients.json": hashes["coefficients.json"],
            "no-load/results.json": hashes["results.json"],
        },
        "note": (
            "threads_merged.xlsx and normalized.csv are inputs and must match "
            "data/rope-calibration/README.md exactly. The no-load/* JSON hashes "
            "include toolchain versions and full-precision floats, so they can "
            "differ across numpy/scipy/BLAS builds; calibrate_no_load.py --check "
            "compares coefficients and metrics with explicit tolerances instead."
        ),
    }
    files["SHA256SUMS.json"] = render_json(sums_document)

    return {
        "files": files,
        "table": table,
        "problems": problems,
        "cleaned": cleaned,
        "training": training,
        "excluded": excluded,
        "sample": sample,
        "families": families,
        "coefficients": coefficients,
        "metrics": metric_block,
        "fixture": fixture,
        "hashes": hashes,
        "sourceSha": source_sha,
        "crossCheck": cross_check,
        "sums": sums_document,
        "fitDiagnostics": fit_diagnostics,
    }


# ---------------------------------------------------------------------------
# README.
# ---------------------------------------------------------------------------
def render_readme(coefficients: np.ndarray, table: list[dict], metric_block: dict,
                  sample: dict, families: list[dict], fixture: dict,
                  source_sha: dict, fit_diagnostics: dict, cleaned_count: int,
                  training_count: int, problems: list[str]) -> str:
    lines: list[str] = []
    add = lines.append

    add("# No-load rope-diameter calibration")
    add("")
    add("Reproducible, tension-free calibration of the rope-diameter model used by the")
    add("rope calculator. Everything in this directory is generated by")
    add("`data/rope-calibration/calibrate_no_load.py`; the superseded load-aware")
    add("calibration in `data/rope-calibration/legacy-load/` is archived history")
    add("and is not used by the current model.")
    add("")
    add("## Model")
    add("")
    add("`x` is the dTex of the purchased thread, `n` the number of threads per strand")
    add("(strands are always 3), `D` the finished rope diameter in mm.")
    add("")
    add("```")
    add("u = ln(x / 300)")
    add("v = ln(n)")
    add("D = exp(c0 + c1*u + c2*v + c3*u^2)")
    add("```")
    add("")
    add("Objective: minimise `sum(((D_calc - D_measured) / D_measured)^2)` over the")
    add("training rows. Every aggregated row has weight 1. There is no load term,")
    add("no load weight and no recommended-load substitution.")
    add("")
    add("| coefficient | fitted | published | relative deviation |")
    add("| --- | --- | --- | --- |")
    for index, name in enumerate(COEFFICIENT_NAMES):
        entry = table[index]
        add(f"| `{name}` | {entry['reproduced']:.8f} | {entry['expected']:.8f} | {entry['relative']:.2e} |")
    add("")
    add("Fitted coefficients at full float precision (`coefficients.json` is")
    add("authoritative):")
    add("")
    add("```")
    for index, name in enumerate(COEFFICIENT_NAMES):
        add(f"{name} = {float(coefficients[index])!r}")
    add("```")
    add("")
    add("Maximum relative deviation from the published coefficients:")
    add(f"`{max(entry['relative'] for entry in table if entry['kind'] == 'coefficient'):.2e}`")
    add(f"(tolerance `{COEFFICIENT_RTOL:g}`).")
    add("")
    add("## Run")
    add("")
    add("```bash")
    add("python3 data/rope-calibration/calibrate_no_load.py           # rebuild no-load/*")
    add("python3 data/rope-calibration/calibrate_no_load.py --check   # verify, write nothing")
    add("```")
    add("")
    add("Requirements: Python 3.10+, `numpy`, `scipy`; no network access. The xlsx")
    add("cross-check uses a small standard-library reader, so `openpyxl` is not needed.")
    add("")
    add("## Sample rules")
    add("")
    add("1. Start from the 143 type-P measurements in `normalized.csv` (130 old + 13")
    add("   new; new rows are Excel rows 175-187).")
    add("2. Remove Excel rows 179, 180 and 181 (UNI-C 20D 22.22 dTex) from the working")
    add("   sample only. Rows 182 (n=2, 0.086 mm) and 183 (n=1, 0.050 mm) stay in.")
    add("   The source records are never deleted or modified.")
    add("3. Average identical thread + dTex + n. Identity is the barcode when present,")
    add("   otherwise the exact series, otherwise the manufacturer; different barcodes")
    add("   are never merged. A group is averaged only when `(Dmax - Dmin) / Dmin <= 15 %`.")
    add("   Skala 360 n=2 is averaged by explicit user decision even though its spread")
    add("   is 15.4 %; `averaging-log.csv` records both the spread and the decision.")
    add("   Each aggregated row has weight 1 and the raw values stay in the log.")
    add("4. Exclude Excel rows 95 (Skala 240 5x3, 0.825 mm) and 133 (Tera 30 2x3,")
    add("   1.000 mm) as pre-existing training exceptions. They stay in")
    add("   `cleaned_130.csv` and are marked in `training_128.csv`.")
    add("5. Objective and weights are those of the model section above.")
    add("6. LOFO over 22 thread families: the whole family (all constructions and")
    add("   repeats) is removed from training, the coefficients are refitted on each")
    add("   split, and metrics are row-weighted. N100 and poliestere 300 share one")
    add("   family; M702 and M782 share one family. Family grouping (LOFO) and")
    add("   duplicate grouping (averaging) are independent procedures.")
    add("7. Metrics: `RMSPE = sqrt(mean(rel^2))`, `MAPE = mean(|rel|)`, MAE and RMSE in")
    add("   mm, bias as the mean relative error and the mean signed error.")
    add("")
    add("## Reproduced numbers")
    add("")
    add("| metric | reproduced | published | delta | tolerance | status |")
    add("| --- | --- | --- | --- | --- | --- |")
    for entry in table:
        if entry["kind"] != "metric":
            continue
        if entry["unit"] == "pp":
            reproduced = f"{entry['reproduced']:.4f}"
            delta = f"{entry['delta']:+.4f}"
            tolerance = f"{entry['tolerance']:.4f} pp"
        else:
            reproduced = f"{entry['reproduced']:.6f}"
            delta = f"{entry['delta']:+.6f}"
            tolerance = f"{entry['tolerance']:.2e} mm"
        add(
            f"| `{entry['name']}` | {reproduced} | {entry['expected']:.5f} | "
            f"{delta} | {tolerance} | {'ok' if entry['ok'] else 'FAIL'} |"
        )
    add("")
    add("Full-precision metric values are in `results.json` under `metrics`.")
    add("")
    add("Correctness gate: coefficients within `1e-6` relative and metrics within")
    add("`0.02` percentage points (`0.02 %` relative for millimetre metrics). A run")
    add("that misses the gate prints the exact deltas and exits non-zero without")
    add("writing anything.")
    add("")
    add("## Fixture facts")
    add("")
    add("| fact | value | holds |")
    add("| --- | --- | --- |")
    add(f"| UNI-C 20D 22.22 dTex, n=1 | measured {fixture['measuredUniC']['1']['measuredMm']:.4f} mm (row "
        f"{', '.join(str(r) for r in fixture['measuredUniC']['1']['excelRows'])}) | "
        f"{'yes' if fixture['measuredUniC']['1']['matches'] else 'no'} |")
    add(f"| UNI-C 20D 22.22 dTex, n=2 | measured {fixture['measuredUniC']['2']['measuredMm']:.4f} mm (row "
        f"{', '.join(str(r) for r in fixture['measuredUniC']['2']['excelRows'])}) | "
        f"{'yes' if fixture['measuredUniC']['2']['matches'] else 'no'} |")
    add(f"| model prediction at 22.22 dTex, n=1 | {fixture['prediction']['fittedMm']:.16f} mm fitted; "
        f"{fixture['prediction']['specMm']:.16f} mm from the published coefficients | "
        f"{'yes' if fixture['prediction']['fittedRelativeDeviation'] <= COEFFICIENT_RTOL else 'no'} |")
    add("")
    add("## Files")
    add("")
    add("| file | contents |")
    add("| --- | --- |")
    add("| `coefficients.json` | fitted and published coefficients, formula, objective, "
        "support ranges (n = 1..5, custom dTex 22.22-6000, measured 22.22-3000, "
        "diameter tolerance 0.10), versions, source hashes |")
    add(f"| `results.json` | counts, the {len(sample['mergedLog'])} averaging groups, removed rows, "
        f"exclusion rows 95/133, the {len(families)} families, all metrics, "
        "per-fold coefficients, per-row residuals |")
    add(f"| `cleaned_130.csv` | the {cleaned_count} aggregated working rows: source excelRows, "
        "thread identity, dtex, n, mean diameter, family, old/new flag, weight |")
    add(f"| `training_128.csv` | the {training_count} training rows first, then the two excluded "
        "working rows (95 and 133) marked `inTraining=False` |")
    add("| `averaging-log.csv` | every averaged group: source excelRows, raw diameters, "
        "mean, min, max and relative spread |")
    add("| `SHA256SUMS.json` | SHA-256 of the two inputs and the five data artefacts |")
    add("")
    add("## Determinism and `--check`")
    add("")
    add("The fit uses deterministic multi-start Levenberg-Marquardt with relative")
    add(f"residuals (sum of squares `{fit_diagnostics['sumSquaredRelativeErrors']:.12f}`, "
        f"optimality `{fit_diagnostics['optimality']:.2e}`).")
    add("`--check` writes nothing and fails when:")
    add("")
    add("- a fitted coefficient differs from the published value by more than `1e-6`")
    add("  relative, or a metric exceeds its tolerance;")
    add("- a regenerated CSV differs from the committed one byte-for-byte;")
    add("- a JSON artefact differs structurally or a number differs beyond tolerance;")
    add("- `threads_merged.xlsx` or `normalized.csv` no longer match their documented")
    add("  SHA-256 (these inputs must never change);")
    add("- the on-disk files no longer match `SHA256SUMS.json`.")
    add("")
    add("The `versions.python/numpy/scipy` fields make the JSON hashes machine")
    add("dependent, so on a different BLAS/scipy build `--check` ignores those fields")
    add("and compares coefficients and metrics with the explicit tolerances above.")
    add("")
    add("## Source hashes")
    add("")
    add("| file | SHA-256 | matches `data/rope-calibration/README.md` |")
    add("| --- | --- | --- |")
    for name, value in source_sha.items():
        matches = DOCUMENTED_INPUT_SHA256[name] == value
        add(f"| `{name}` | `{value}` | {'yes' if matches else 'no'} |")
    add("")
    add("## Interpretation notes")
    add("")
    add("- `training_128.csv` lists all 130 working rows: the first 128 are the")
    add("  training set, and rows 95 and 133 are appended with `inTraining=False` so")
    add("  the exclusions are visible without deleting the records.")
    add("- The three UNI-C rows are removed before grouping and averaging. Averaging")
    add("  first would give the same result: neither UNI-C group would pass the 15 %")
    add("  spread rule (78 % and 100 % spreads), so no UNI-C row is averaged.")
    add("- `diameterTolerance: 0.10` in `coefficients.json` is the calculator's")
    add("  relative diameter tolerance (10 %), not a fitting parameter.")
    add("- The load column in the source is retained for provenance only. The model")
    add("  is no-load, so load is not a regressor and not a weight. For an averaged")
    add("  row, `loadGrams`, `source` and `position` in `cleaned_130.csv` come from")
    add("  the first source row and are provenance metadata, not part of the mean.")
    add("- The residual surface is very flat, so the last eight or so digits of the")
    add("  coefficients depend on the optimiser; the published values are recovered")
    add("  to about `1e-8` relative, well inside the `1e-6` requirement. Seeding the")
    add("  optimiser with the published values is deliberately not done.")
    add("- The 22 families are the LOFO grouping; the averaging groups in")
    add("  `averaging-log.csv` are a separate duplicate-grouping procedure.")
    add("")
    if problems:
        add("## FAILED")
        add("")
        for problem in problems:
            add(f"- {problem}")
        add("")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Comparison with committed artefacts.
# ---------------------------------------------------------------------------
def _json_number_tolerance(path: str, a: float, b: float) -> float:
    leaf = path.rsplit(".", 1)[-1]
    low = leaf.lower()
    if "optimality" in low:
        return 1e-3
    if "relative" in low:
        return 1e-6
    if leaf in COEFFICIENT_NAMES or "coefficients" in path:
        return COEFFICIENT_RTOL * max(abs(a), abs(b))
    if leaf.endswith("Percent"):
        return METRIC_PP_TOL
    if leaf.endswith("Mm"):
        return METRIC_MM_RTOL * max(abs(a), abs(b))
    return 1e-6 * max(abs(a), abs(b), 1e-300)


def compare_documents(committed: Any, rebuilt: Any, path: str = "",
                      problems: list[str] | None = None) -> list[str]:
    if problems is None:
        problems = []
    if isinstance(committed, dict) and isinstance(rebuilt, dict):
        if set(committed) != set(rebuilt):
            missing = sorted(set(rebuilt) - set(committed))
            extra = sorted(set(committed) - set(rebuilt))
            problems.append(f"{path or '<root>'}: key mismatch missing={missing} extra={extra}")
            return problems
        for key in rebuilt:
            compare_documents(committed[key], rebuilt[key], f"{path}.{key}" if path else key, problems)
        return problems
    if isinstance(committed, list) and isinstance(rebuilt, list):
        if len(committed) != len(rebuilt):
            problems.append(f"{path}: length {len(committed)} != {len(rebuilt)}")
            return problems
        for index, (left, right) in enumerate(zip(committed, rebuilt)):
            compare_documents(left, right, f"{path}[{index}]", problems)
        return problems
    if isinstance(committed, bool) or isinstance(rebuilt, bool):
        if committed != rebuilt:
            problems.append(f"{path}: {committed!r} != {rebuilt!r}")
        return problems
    if isinstance(committed, (int, float)) and isinstance(rebuilt, (int, float)):
        if isinstance(committed, float) or isinstance(rebuilt, float):
            tolerance = _json_number_tolerance(path, float(committed), float(rebuilt))
            if abs(float(committed) - float(rebuilt)) > tolerance:
                problems.append(
                    f"{path}: {committed!r} != {rebuilt!r} (tolerance {tolerance:.3g})"
                )
        elif committed != rebuilt:
            problems.append(f"{path}: {committed!r} != {rebuilt!r}")
        return problems
    if committed != rebuilt:
        problems.append(f"{path}: {committed!r} != {rebuilt!r}")
    return problems


IGNORED_TOOLCHAIN_KEYS = ("versions.python", "versions.numpy", "versions.scipy")


def check_committed(built: dict) -> list[str]:
    problems: list[str] = []

    # 1. Source hashes must match the documented values.
    for name, documented in DOCUMENTED_INPUT_SHA256.items():
        actual = built["sourceSha"][name]
        if actual != documented:
            problems.append(f"{name}: SHA-256 {actual} != documented {documented}")

    # 2. On-disk artefacts must match SHA256SUMS.json.
    sums_path = OUT_DIR / "SHA256SUMS.json"
    if not sums_path.exists():
        problems.append("no-load/SHA256SUMS.json is missing")
    else:
        committed_sums = json.loads(sums_path.read_text(encoding="utf-8"))
        for relative, digest in committed_sums.get("files", {}).items():
            path = HERE / relative
            if not path.exists():
                problems.append(f"{relative} is missing")
                continue
            actual = sha256_file(path)
            if actual != digest:
                if relative.startswith("no-load/") and relative.endswith((".json",)):
                    print(f"note: {relative} hash changed (toolchain or float drift); "
                          "semantic comparison decides below")
                else:
                    problems.append(f"{relative}: SHA-256 {actual} != {digest}")

    # 3. Rebuilt artefacts must match the committed ones.
    for name, text in built["files"].items():
        path = OUT_DIR / name
        if not path.exists():
            problems.append(f"no-load/{name} is missing")
            continue
        on_disk = path.read_text(encoding="utf-8")
        if name == "SHA256SUMS.json":
            # Derived-file hashes are machine dependent; only the two input
            # hashes and the key set are stable.  Step 2 above already checked
            # the on-disk hashes against the committed sums.
            committed_sums = json.loads(on_disk)
            rebuilt_sums = json.loads(text)
            if set(committed_sums.get("files", {})) != set(rebuilt_sums.get("files", {})):
                problems.append("no-load/SHA256SUMS.json: file key set differs")
            for key, digest in rebuilt_sums.get("files", {}).items():
                if key.startswith("no-load/"):
                    continue
                if committed_sums.get("files", {}).get(key) != digest:
                    problems.append(
                        f"no-load/SHA256SUMS.json: {key} hash {digest} != "
                        f"{committed_sums.get('files', {}).get(key)}"
                    )
            continue
        if name.endswith(".csv") or name == "README.md":
            if on_disk != text:
                if name == "README.md":
                    print("note: README.md prose differs from the regenerated text; "
                          "data artefacts still decide the check")
                else:
                    for line_number, (left, right) in enumerate(
                        zip(on_disk.splitlines(), text.splitlines()), start=1
                    ):
                        if left != right:
                            problems.append(
                                f"no-load/{name}: first difference at line {line_number}: "
                                f"{left!r} != {right!r}"
                            )
                            break
                    else:
                        problems.append(f"no-load/{name}: line count differs")
        elif name.endswith(".json"):
            committed = json.loads(on_disk)
            rebuilt = json.loads(text)
            for ignored in IGNORED_TOOLCHAIN_KEYS:
                try:
                    committed_value = dig(committed, ignored)
                    dig(rebuilt, ignored)
                except (KeyError, TypeError):
                    continue
                if committed_value != dig(rebuilt, ignored):
                    print(f"note: {name}: ignoring toolchain field {ignored}")
            differences = compare_documents(committed, rebuilt)
            for difference in differences:
                if any(difference.startswith(ignored + ":") for ignored in IGNORED_TOOLCHAIN_KEYS):
                    continue
                problems.append(f"no-load/{name}: {difference}")

    return problems


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------
def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reproducible no-load rope-diameter calibration."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed artefacts without writing anything",
    )
    args = parser.parse_args(argv)

    started = time.perf_counter()
    try:
        built = build()
    except CalibrationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    sample = built["sample"]
    print(
        f"Sample: {len(sample['usable'])} type-P rows, {len(sample['removed'])} removed, "
        f"{len(sample['mergedLog'])} averaged groups -> {len(built['cleaned'])} working rows; "
        f"training {len(built['training'])} "
        f"({sum(not row['isNew'] for row in built['training'])} old + "
        f"{sum(row['isNew'] for row in built['training'])} new), "
        f"{len(built['families'])} families."
    )
    print(
        f"XLSX cross-check: {built['crossCheck']['status']} "
        f"({built['crossCheck']['mismatchCount']} mismatches over "
        f"{built['crossCheck']['rowsCompared']} rows x {len(built['crossCheck']['comparedColumns'])} columns)."
    )

    print_comparison(built["table"])

    fixture = built["fixture"]
    print()
    print("Fixture facts")
    for n in (1, 2):
        entry = fixture["measuredUniC"][str(n)]
        print(
            f"  UNI-C 20D 22.22 dTex n={n}: measured {entry['measuredMm']:.4f} mm "
            f"(row {entry['excelRows'][0]}), published {entry['publishedMm']:.4f} mm -> "
            f"{'ok' if entry['matches'] else 'FAIL'}"
        )
    print(
        f"  22.22 dTex n=1 prediction: fitted {fixture['prediction']['fittedMm']:.16f} mm, "
        f"published {fixture['prediction']['publishedMm']:.16f} mm, "
        f"relative deviation {fixture['prediction']['fittedRelativeDeviation']:.2e} -> "
        f"{'ok' if fixture['prediction']['fittedRelativeDeviation'] <= COEFFICIENT_RTOL else 'FAIL'}"
    )

    if built["problems"]:
        print()
        print("Publication gate FAILED:", file=sys.stderr)
        for problem in built["problems"]:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    elapsed = time.perf_counter() - started

    if args.check:
        problems = check_committed(built)
        print()
        if problems:
            print("Check FAILED:", file=sys.stderr)
            for problem in problems:
                print(f"  - {problem}", file=sys.stderr)
            return 1
        print(f"Check passed: committed artefacts match (no files written, {elapsed:.2f} s).")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, text in built["files"].items():
        (OUT_DIR / name).write_text(text, encoding="utf-8")
    print()
    for name in sorted(built["files"]):
        print(f"  wrote no-load/{name}")
    print(f"Done in {elapsed:.2f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
