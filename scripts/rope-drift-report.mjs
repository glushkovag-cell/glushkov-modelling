#!/usr/bin/env node
/**
 * Отчёт drift калькулятора канатов: legacy API v1 (алгоритм 2.0.0) против
 * API v2 (алгоритм 3.0.0, учёт груза).
 *
 * Источники:
 *   docs/rope-calculator/fixtures/legacy-v1-snapshot.json  поведение до доработки
 *   docs/rope-calculator/fixtures/catalog-snapshot.json    каталог нитей
 *   rope-calculator-worker/src/core                        текущий код v1 и v2
 *
 * Запуск из корня репозитория (нужны зависимости rope-calculator-worker):
 *   node scripts/rope-drift-report.mjs           записать отчёт
 *   node scripts/rope-drift-report.mjs --check   сверить без записи
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'rope-calculator-worker');
const OUT = join(ROOT, 'docs/rope-calculator/load-v2/drift.md');
const LEGACY = join(ROOT, 'docs/rope-calculator/fixtures/legacy-v1-snapshot.json');
const CATALOG = join(ROOT, 'docs/rope-calculator/fixtures/catalog-snapshot.json');

const require = createRequire(join(WORKER, 'package.json'));
const esbuild = require('esbuild');

const ENTRY = `
export { ALGORITHM_VERSION, MAX_DEVIATION } from './src/core/constants';
export { findMatches } from './src/core/reverse';
export { LOAD_ALGORITHM_VERSION, LOAD_GRAMS, calculateDiameterMm, recommendLoadGrams } from './src/core/load-model';
export { findMatchesV2 } from './src/core/v2';
`;

async function loadCore() {
  const dir = mkdtempSync(join(tmpdir(), 'rope-drift-'));
  const file = join(dir, 'core.mjs');
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: WORKER, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent',
  });
  const core = await import(pathToFileURL(file).href);
  rmSync(dir, { recursive: true, force: true });
  return core;
}

const core = await loadCore();
const legacy = JSON.parse(readFileSync(LEGACY, 'utf8'));
const catalogFixture = JSON.parse(readFileSync(CATALOG, 'utf8'));
const catalog = catalogFixture.threads.map(({ threadId, brand, number, dtex, sortOrder, enabled }) => ({
  threadId, brand, number, dtex, sortOrder, enabled,
}));

const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const mm = (v) => v.toFixed(3);
const rel = (next, prev) => ((next - prev) / prev) * 100;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stats = (xs) => ({
  min: Math.min(...xs), max: Math.max(...xs), median: median(xs),
  meanAbs: xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length,
});
const key = (r) => `${r.threadId}×${r.threadsPerStrand}`;

const lines = [];
const out = (s = '') => lines.push(s);

out('# Drift: API v1 (2.0.0) → API v2 (3.0.0)');
out();
out('Файл сгенерирован `node scripts/rope-drift-report.mjs`; не править вручную.');
out();
out(`- Каталог: \`${legacy.catalogVersion}\`, конструкций в каталоге: ${legacy.forward.catalog.length}.`);
out(`- Legacy: алгоритм ${legacy.contract.algorithmVersion}, допуск ±${legacy.contract.reverseTolerance * 100}% (снимок до доработки).`);
out(`- Текущий v1: алгоритм ${core.ALGORITHM_VERSION}, допуск ±${core.MAX_DEVIATION * 100}%.`);
out(`- v2: алгоритм ${core.LOAD_ALGORITHM_VERSION}; режим \`auto\` экспериментальный — груз является рекомендуемым стартовым значением, а не экспериментально установленным оптимумом.`);
out('- Δ = (D_v2 − D_v1) / D_v1. Положительное значение — v2 даёт канат толще.');
out();

// 1. Прямой расчёт: v1 против v2 auto.
const forward = legacy.forward.catalog.map((r) => {
  const load = core.recommendLoadGrams(r.dtex, r.threadsPerStrand);
  const v2 = core.calculateDiameterMm(r.dtex, r.threadsPerStrand, load);
  return { ...r, load, v2, delta: rel(v2, r.diameterMm) };
});
const fs = stats(forward.map((r) => r.delta));
out('## Прямой расчёт по каталогу: v1 и v2 auto');
out();
out('| Показатель | Значение |');
out('|---|---|');
out(`| Минимум Δ | ${pct(fs.min)} |`);
out(`| Медиана Δ | ${pct(fs.median)} |`);
out(`| Максимум Δ | ${pct(fs.max)} |`);
out(`| Средний модуль Δ | ${fs.meanAbs.toFixed(1)}% |`);
out(`| Конструкций с \\|Δ\\| > 10% | ${forward.filter((r) => Math.abs(r.delta) > 10).length} из ${forward.length} |`);
out();
out('Наибольшие расхождения:');
out();
out('| Нить | dTex | Нитей в пряди | Груз auto, g | D v1, мм | D v2, мм | Δ |');
out('|---|---:|---:|---:|---:|---:|---:|');
for (const r of [...forward].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)) {
  out(`| ${r.threadId} | ${r.dtex} | ${r.threadsPerStrand} | ${r.load} | ${mm(r.diameterMm)} | ${mm(r.v2)} | ${pct(r.delta)} |`);
}
out();

// 2. По грузам.
out('## Прямой расчёт по каталогу: v2 с ручным грузом против v1');
out();
out('| Груз, g | Мин. Δ | Медиана Δ | Макс. Δ | Средний модуль Δ |');
out('|---:|---:|---:|---:|---:|');
for (const load of core.LOAD_GRAMS) {
  const s = stats(legacy.forward.catalog.map((r) => rel(core.calculateDiameterMm(r.dtex, r.threadsPerStrand, load), r.diameterMm)));
  out(`| ${load} | ${pct(s.min)} | ${pct(s.median)} | ${pct(s.max)} | ${s.meanAbs.toFixed(1)}% |`);
}
out();

// 3. Ручной dTex.
out('## Ручной dTex: v1 и v2 auto');
out();
out('| dTex | Нитей в пряди | Груз auto, g | D v1, мм | D v2, мм | Δ |');
out('|---:|---:|---:|---:|---:|---:|');
for (const r of legacy.forward.dtex.filter((x) => [1, 3, 5].includes(x.threadsPerStrand))) {
  const load = core.recommendLoadGrams(r.dtex, r.threadsPerStrand);
  const v2 = core.calculateDiameterMm(r.dtex, r.threadsPerStrand, load);
  out(`| ${r.dtex} | ${r.threadsPerStrand} | ${load} | ${mm(r.diameterMm)} | ${mm(v2)} | ${pct(rel(v2, r.diameterMm))} |`);
}
out();
out('v2 дополнительно принимает ручной dTex от 20 до 80 (v1 — от 80).');
out();

// 4. Обратный подбор.
out('## Обратный подбор по всему каталогу');
out();
out('| Цель, мм | v1 ±15% (legacy) | v1 ±10% (текущий) | v2 auto ±10% | Общих v1 ±10% и v2 auto | Лучший v1 ±10% | Лучший v2 auto |');
out('|---:|---:|---:|---:|---:|---|---|');
for (const c of legacy.reverse) {
  const v1 = core.findMatches({ targetDiameterMm: c.targetDiameterMm }, catalog).matches;
  const v2 = core.findMatchesV2({ targetDiameterMm: c.targetDiameterMm, loadMode: 'auto' }, catalog).matches;
  const v1Keys = new Set(v1.map(key));
  const common = v2.filter((m) => v1Keys.has(key(m))).length;
  const best = (m) => (m ? `${key(m)} (${pct(m.deviationPercent)})` : '—');
  out(`| ${c.targetDiameterMm} | ${c.results.length} | ${v1.length} | ${v2.length} | ${common} | ${best(v1[0])} | ${best(v2[0])} |`);
}
out();
out('Изменение допуска ±15% → ±10% относится и к v1 (согласовано); набор');
out('кандидатов v1 ±10% является подмножеством legacy ±15% с тем же порядком.');
out();

// Проверка подмножества.
for (const c of legacy.reverse) {
  const legacyKeys = c.results.map(key);
  const v1 = core.findMatches({ targetDiameterMm: c.targetDiameterMm }, catalog).matches.map(key);
  const filtered = legacyKeys.filter((k) => v1.includes(k));
  if (filtered.join() !== v1.join()) {
    console.error(`v1 ±10% for target ${c.targetDiameterMm} is not an ordered subset of legacy ±15%.`);
    process.exit(1);
  }
}

const text = `${lines.join('\n')}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') !== text) {
    console.error('drift.md differs from the current code.');
    process.exit(1);
  }
  console.log('drift.md matches the current code.');
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${OUT}`);
}
