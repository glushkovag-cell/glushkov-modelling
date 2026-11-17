#!/usr/bin/env python3
"""
Воспроизводимая калибровка калькулятора канатов с учётом груза (алгоритм 3.0.0).

Источник: threads_merged.xlsx, лист «Общая таблица». Скрипт:

1. нормализует таблицу в normalized.csv (исходные значения не меняются,
   выведенные поля помечены отдельно);
2. отбирает измерения типа P с dTex, фактическим диаметром и грузом (143);
3. исключает из подбора строки Excel 95 и 133 (141 наблюдение);
4. подбирает D = A * x^b * n^c * (w/200)^gamma по сумме квадратов
   относительных ошибок: по фактическому грузу, по рекомендованному грузу и
   общий набор для обоих режимов;
5. считает RMSPE / MAPE / MAE / RMSE / смещение для обучения и LOFO
   (22 семейства нитей) отдельно для старых, новых и всех измерений;
6. пишет coefficients.json и results.json.

Запуск:  python3 data/rope-calibration/calibrate.py [--check]
Зависимости: см. requirements.txt (numpy, scipy, openpyxl).

--check ничего не пишет и завершается с ошибкой, если результаты расходятся
с сохранёнными файлами или зафиксированные коэффициенты алгоритма 3.0.0
отличаются от подобранных больше чем на 1e-6 (относительно).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import openpyxl
from scipy.optimize import least_squares

HERE = Path(__file__).resolve().parent
XLSX = HERE / "threads_merged.xlsx"
CSV_OUT = HERE / "normalized.csv"
COEF_OUT = HERE / "coefficients.json"
RESULTS_OUT = HERE / "results.json"
SHEET = "Общая таблица"

# Первые строки Excel с новыми измерениями (175–187 включительно).
FIRST_NEW_ROW = 175
# Прежние исключения: сохранены в таблице, исключены только из подбора.
EXCLUDED_ROWS = {
    95: "Skala 240 5×3, measured 0.825 mm: earlier outlier",
    133: "Tera 30 2×3, measured 1.000 mm: earlier outlier",
}
# Допустимые грузы и пороги рекомендации (loadRecommendationVersion 1.0.0).
LOAD_STEPS = [(150, 30), (250, 50), (400, 100), (550, 150), (650, 200), (800, 250)]
LOAD_MAX = 300
# Коэффициенты, зафиксированные в rope-calculator-worker (алгоритм 3.0.0).
SHIPPED = {
    "a": 0.015783234759902807,
    "b": 0.5592028655918567,
    "c": 0.5097503439652015,
    "loadExponent": 0.27528238252976955,
}

CONSTRUCTION = re.compile(r"^\s*(\d+)\s*[×xх]\s*3\s*$", re.IGNORECASE)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def recommend_load(total_dtex: float) -> int:
    for upper, grams in LOAD_STEPS:
        if total_dtex < upper:
            return grams
    return LOAD_MAX


def family_of(manufacturer: str, series: str, dtex: float | None) -> str:
    """Семейство нити для LOFO: серия целиком, со всеми свивками и повторами."""
    name = (series or manufacturer or "").strip()
    low = name.lower()
    if low in {"n100"} or (low == "poliestere" and dtex == 300):
        return "Gutermann Sew-all 300"
    if low == "40/2" and (manufacturer or "").strip() == "Gamma":
        return "Gamma 40/2"
    if low.startswith("extra strong m7"):
        return "Gutermann Extra Strong 750"
    if low == "poliestere" and dtex == 1000:
        return "Gutermann Top Stitch 1000"
    return name


def read_rows() -> list[dict]:
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb[SHEET]
    rows = []
    for excel_row, values in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        (manufacturer, series, ident, dtex, thread_d, rope_type, construction,
         diameter, load, _load_calc, _note, source, position) = values[:13]
        if all(v is None for v in values):
            continue
        rows.append({
            "excelRow": excel_row,
            "manufacturer": manufacturer or "",
            "series": series or "",
            "identifier": ident or "",
            "dtex": dtex,
            "threadDiameterMm": thread_d,
            "ropeType": rope_type or "",
            "construction": construction or "",
            "diameterMm": diameter,
            "loadGrams": load,
            "source": source or "",
            "position": position or "",
        })
    return rows


def normalize(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        match = CONSTRUCTION.match(str(row["construction"]))
        n = int(match.group(1)) if match else None
        is_new = row["excelRow"] >= FIRST_NEW_ROW
        # Для новых строк с пустым типом принят P по конструкции n×3.
        type_inferred = row["ropeType"] == "" and is_new and n is not None
        rope_type = "P" if type_inferred else row["ropeType"]
        usable = (
            rope_type == "P" and n is not None and isinstance(row["dtex"], (int, float))
            and isinstance(row["diameterMm"], (int, float)) and isinstance(row["loadGrams"], (int, float))
        )
        excluded = row["excelRow"] in EXCLUDED_ROWS
        out.append({
            **row,
            "ropeTypeNormalized": rope_type,
            "ropeTypeInferred": type_inferred,
            "threadsPerStrand": n,
            "isNew": is_new,
            "usable": usable,
            "excluded": excluded,
            "exclusionReason": EXCLUDED_ROWS.get(row["excelRow"], ""),
            "inCalibration": usable and not excluded,
            "family": family_of(row["manufacturer"], row["series"], row["dtex"]) if usable else "",
            "totalDtex": 3 * row["dtex"] * n if usable else None,
            "recommendedLoadGrams": recommend_load(3 * row["dtex"] * n) if usable else None,
        })
    return out


CSV_FIELDS = [
    "excelRow", "manufacturer", "series", "identifier", "dtex", "threadDiameterMm",
    "ropeType", "ropeTypeNormalized", "ropeTypeInferred", "construction", "threadsPerStrand",
    "diameterMm", "loadGrams", "source", "position", "isNew", "usable", "excluded",
    "exclusionReason", "inCalibration", "family", "totalDtex", "recommendedLoadGrams",
]


def csv_text(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row[k] is None else row[k]) for k in CSV_FIELDS})
    return buffer.getvalue()


def predict(p: np.ndarray, x: np.ndarray, n: np.ndarray, w: np.ndarray) -> np.ndarray:
    a, b, c, g = p
    return a * np.power(x, b) * np.power(n, c) * np.power(w / 200.0, g)


def fit(blocks: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]]) -> np.ndarray:
    """Минимизация суммы квадратов относительных ошибок по всем блокам."""

    def residuals(q: np.ndarray) -> np.ndarray:
        p = np.array([math.exp(q[0]), q[1], q[2], q[3]])
        return np.concatenate([(predict(p, x, n, w) - d) / d for x, n, w, d in blocks])

    start = np.array([math.log(0.016), 0.55, 0.5, 0.27])
    result = least_squares(residuals, start, method="lm", xtol=1e-15, ftol=1e-15, gtol=1e-15, max_nfev=20000)
    q = result.x
    return np.array([math.exp(q[0]), q[1], q[2], q[3]])


def metrics(pred: np.ndarray, actual: np.ndarray) -> dict:
    rel = (pred - actual) / actual
    err = pred - actual
    return {
        "count": int(actual.size),
        "rmspePercent": float(math.sqrt(np.mean(rel ** 2)) * 100),
        "mapePercent": float(np.mean(np.abs(rel)) * 100),
        "maeMm": float(np.mean(np.abs(err))),
        "rmseMm": float(math.sqrt(np.mean(err ** 2))),
        "biasPercent": float(np.mean(rel) * 100),
        "biasMm": float(np.mean(err)),
    }


def arrays(rows: list[dict], load_key: str):
    x = np.array([r["dtex"] for r in rows], dtype=float)
    n = np.array([r["threadsPerStrand"] for r in rows], dtype=float)
    w = np.array([r[load_key] for r in rows], dtype=float)
    d = np.array([r["diameterMm"] for r in rows], dtype=float)
    return x, n, w, d


STRATEGIES = {
    # Имя: (блоки обучения, параметры для ручного и автоматического режимов)
    "actualLoad": "coefficients fitted on actual load, used in both modes",
    "separate": "separate sets: actual load for manual, recommended load for auto",
    "shared": "one shared set fitted on both modes with equal weight (algorithm 3.0.0)",
}


def fit_strategy(name: str, rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    manual = arrays(rows, "loadGrams")
    auto = arrays(rows, "recommendedLoadGrams")
    if name == "actualLoad":
        p = fit([manual])
        return p, p
    if name == "separate":
        return fit([manual]), fit([auto])
    if name == "shared":
        p = fit([manual, auto])
        return p, p
    raise ValueError(name)


def evaluate(rows: list[dict], p_manual: np.ndarray, p_auto: np.ndarray) -> dict[str, np.ndarray]:
    xm, nm, wm, _ = arrays(rows, "loadGrams")
    xa, na, wa, _ = arrays(rows, "recommendedLoadGrams")
    return {"manual": predict(p_manual, xm, nm, wm), "auto": predict(p_auto, xa, na, wa)}


def subset_metrics(rows: list[dict], preds: dict[str, np.ndarray]) -> dict:
    actual = np.array([r["diameterMm"] for r in rows], dtype=float)
    groups = {
        "all": np.ones(len(rows), dtype=bool),
        "old": np.array([not r["isNew"] for r in rows]),
        "new": np.array([r["isNew"] for r in rows]),
    }
    return {
        mode: {g: metrics(pred[mask], actual[mask]) for g, mask in groups.items()}
        for mode, pred in preds.items()
    }


def lofo(name: str, rows: list[dict]) -> dict[str, np.ndarray]:
    families = sorted({r["family"] for r in rows})
    preds = {"manual": np.zeros(len(rows)), "auto": np.zeros(len(rows))}
    for family in families:
        train = [r for r in rows if r["family"] != family]
        idx = [i for i, r in enumerate(rows) if r["family"] == family]
        p_manual, p_auto = fit_strategy(name, train)
        held = evaluate([rows[i] for i in idx], p_manual, p_auto)
        for mode in preds:
            preds[mode][idx] = held[mode]
    return preds


def coef_dict(p: np.ndarray) -> dict:
    return {"a": float(p[0]), "b": float(p[1]), "c": float(p[2]), "loadExponent": float(p[3])}


def build() -> tuple[str, dict, dict]:
    rows = normalize(read_rows())
    usable = [r for r in rows if r["usable"]]
    calib = [r for r in rows if r["inCalibration"]]
    families = sorted({r["family"] for r in calib})

    strategies = {}
    shared = None
    for name, description in STRATEGIES.items():
        p_manual, p_auto = fit_strategy(name, calib)
        if name == "shared":
            shared = p_manual
        strategies[name] = {
            "description": description,
            "coefficients": {"manual": coef_dict(p_manual), "auto": coef_dict(p_auto)},
            "training": subset_metrics(calib, evaluate(calib, p_manual, p_auto)),
            "lofo": subset_metrics(calib, lofo(name, calib)),
        }

    shipped = np.array([SHIPPED["a"], SHIPPED["b"], SHIPPED["c"], SHIPPED["loadExponent"]])
    load_distribution = {}
    for grams in sorted({int(r["loadGrams"]) for r in usable}):
        totals = sorted(r["totalDtex"] for r in usable if int(r["loadGrams"]) == grams)
        load_distribution[str(grams)] = {
            "count": len(totals),
            "minTotalDtex": totals[0],
            "medianTotalDtex": float(np.median(totals)),
            "maxTotalDtex": totals[-1],
        }

    results = {
        "schema": 1,
        "source": {"file": XLSX.name, "sheet": SHEET, "sha256": sha256(XLSX)},
        "normalizedCsvSha256": hashlib.sha256(csv_text(rows).encode("utf-8")).hexdigest(),
        "selection": {
            "dataRows": len(rows),
            "usableMeasurements": len(usable),
            "usableOld": sum(not r["isNew"] for r in usable),
            "usableNew": sum(r["isNew"] for r in usable),
            "calibrationObservations": len(calib),
            "calibrationOld": sum(not r["isNew"] for r in calib),
            "calibrationNew": sum(r["isNew"] for r in calib),
            "newRows": [FIRST_NEW_ROW, rows[-1]["excelRow"]],
            "ropeTypeInferredRows": [r["excelRow"] for r in rows if r["ropeTypeInferred"]],
            "excluded": [{"excelRow": k, "reason": v} for k, v in sorted(EXCLUDED_ROWS.items())],
        },
        "families": {
            "count": len(families),
            "members": {f: sum(r["family"] == f for r in calib) for f in families},
        },
        "loadDistribution": load_distribution,
        "strategies": strategies,
        "shippedAlgorithm3": {
            "coefficients": SHIPPED,
            "training": subset_metrics(calib, evaluate(calib, shipped, shipped)),
        },
    }

    coefficients = {
        "schema": 1,
        "algorithmVersion": "3.0.0",
        "loadRecommendationVersion": "1.0.0",
        "formula": "D = a * x^b * n^c * (w / 200)^loadExponent",
        "objective": "sum of squared relative errors, manual and auto residuals with equal weight",
        "fitted": coef_dict(shared),
        "shipped": SHIPPED,
        "loadThresholds": [
            {"totalDtexBelow": upper, "loadGrams": grams} for upper, grams in LOAD_STEPS
        ] + [{"totalDtexBelow": None, "loadGrams": LOAD_MAX}],
        "allowedLoadsGrams": [30, 50, 100, 150, 200, 250, 300],
    }
    return csv_text(rows), coefficients, results


def dump(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def rounded(value, digits: int = 8):
    """Округление до значащих цифр: --check не зависит от сборки scipy/BLAS."""
    if isinstance(value, float):
        return float(f"{value:.{digits}g}")
    if isinstance(value, dict):
        return {k: rounded(v, digits) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v, digits) for v in value]
    return value


def same(path: Path, data: dict) -> bool:
    return rounded(json.loads(path.read_text(encoding="utf-8"))) == rounded(data)


def main() -> int:
    csv_out, coefficients, results = build()
    fitted = coefficients["fitted"]
    drift = max(abs(fitted[k] - SHIPPED[k]) / abs(SHIPPED[k]) for k in SHIPPED)

    if "--check" in sys.argv:
        ok = (
            CSV_OUT.read_text(encoding="utf-8") == csv_out
            and same(COEF_OUT, coefficients)
            and same(RESULTS_OUT, results)
        )
        if drift > 1e-6:
            print(f"Shipped coefficients drift from the fit by {drift:.3e}.", file=sys.stderr)
            return 1
        if not ok:
            print("Calibration outputs differ from the committed files.", file=sys.stderr)
            return 1
        print("Calibration outputs match the committed files.")
        return 0

    CSV_OUT.write_text(csv_out, encoding="utf-8")
    COEF_OUT.write_text(dump(coefficients), encoding="utf-8")
    RESULTS_OUT.write_text(dump(results), encoding="utf-8")
    sel = results["selection"]
    print(
        f"Usable {sel['usableMeasurements']} ({sel['usableOld']} old + {sel['usableNew']} new), "
        f"calibration {sel['calibrationObservations']}, families {results['families']['count']}, "
        f"shipped drift {drift:.3e}."
    )
    for name, s in results["strategies"].items():
        t, l = s["training"], s["lofo"]
        print(
            f"{name:11s} train RMSPE {t['manual']['all']['rmspePercent']:.2f}/{t['auto']['all']['rmspePercent']:.2f} "
            f"MAPE {t['manual']['all']['mapePercent']:.2f}/{t['auto']['all']['mapePercent']:.2f} | "
            f"LOFO RMSPE {l['manual']['all']['rmspePercent']:.2f}/{l['auto']['all']['rmspePercent']:.2f} "
            f"MAPE {l['manual']['all']['mapePercent']:.2f}/{l['auto']['all']['mapePercent']:.2f} | "
            f"new RMSPE {t['manual']['new']['rmspePercent']:.2f}/{t['auto']['new']['rmspePercent']:.2f}"
        )
        print("            ", s["coefficients"]["manual"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
