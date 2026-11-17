#!/usr/bin/env node
/**
 * Снимок legacy-контракта калькулятора канатов (API v1, алгоритм 2.0.0).
 *
 * Снимок фиксирует поведение до доработки «учёт груза» (API v2, алгоритм
 * 3.0.0): прямой расчёт для каталога и ручного dTex, обратный подбор для набора
 * целевых диаметров и схемы MCP-инструментов. Он нужен для отчёта drift и
 * проверки, что legacy-запросы после доработки отличаются только в
 * согласованных местах (допуск v1: ±15% → ±10%).
 *
 * Запуск из корня репозитория (нужны зависимости rope-calculator-worker):
 *   node scripts/rope-legacy-snapshot.mjs           записать снимок
 *   node scripts/rope-legacy-snapshot.mjs --check   сверить без записи
 *
 * Снимок пишется один раз на коммите до доработки; после изменения v1
 * режим --check ожидаемо расходится по допуску.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'rope-calculator-worker');
const OUT = join(ROOT, 'docs/rope-calculator/fixtures/legacy-v1-snapshot.json');
const CATALOG = join(ROOT, 'docs/rope-calculator/fixtures/catalog-snapshot.json');

const require = createRequire(join(WORKER, 'package.json'));
const esbuild = require('esbuild');

const ENTRY = `
export { ALGORITHM_VERSION, API_VERSION, MAX_DEVIATION, MIN_CUSTOM_DTEX, MAX_CUSTOM_DTEX, THREAD_COUNTS } from './src/core/constants';
export { computeForward } from './src/core/forward';
export { findMatches } from './src/core/reverse';
`;

const CUSTOM_DTEX = [80, 130, 300, 750, 1500, 3000, 6000];
const TARGETS = [0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2];

async function loadCore() {
  const dir = mkdtempSync(join(tmpdir(), 'rope-legacy-'));
  const file = join(dir, 'core.mjs');
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: WORKER, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: file,
    logLevel: 'silent',
  });
  const core = await import(pathToFileURL(file).href);
  rmSync(dir, { recursive: true, force: true });
  return core;
}

const core = await loadCore();
const catalogFixture = JSON.parse(readFileSync(CATALOG, 'utf8'));
const catalog = catalogFixture.threads.map(({ threadId, brand, number, dtex, sortOrder, enabled }) => ({
  threadId, brand, number, dtex, sortOrder, enabled,
}));
const enabled = catalog.filter((thread) => thread.enabled);

const forwardCatalog = enabled.flatMap((thread) =>
  core.THREAD_COUNTS.map((threadsPerStrand) => {
    const result = core.computeForward({ basis: 'catalog', threadId: thread.threadId, threadsPerStrand }, catalog);
    return { threadId: thread.threadId, dtex: result.dtex, threadsPerStrand, diameterMm: result.diameterMm };
  }),
);

const forwardDtex = CUSTOM_DTEX.flatMap((dtex) =>
  core.THREAD_COUNTS.map((threadsPerStrand) => ({
    dtex,
    threadsPerStrand,
    diameterMm: core.computeForward({ basis: 'dtex', dtex, threadsPerStrand }).diameterMm,
  })),
);

const reverse = TARGETS.map((targetDiameterMm) => {
  const { tolerance, matches } = core.findMatches({ targetDiameterMm }, catalog);
  return {
    targetDiameterMm,
    tolerance,
    results: matches.map((match) => ({
      threadId: match.threadId,
      threadsPerStrand: match.threadsPerStrand,
      diameterMm: match.diameterMm,
      deviationPercent: match.deviationPercent,
    })),
  };
});

const snapshot = {
  schema: 1,
  description: 'Legacy rope calculator contract before load-aware algorithm 3.0.0.',
  catalogVersion: catalogFixture.catalogVersion,
  contract: {
    apiVersion: core.API_VERSION,
    algorithmVersion: core.ALGORITHM_VERSION,
    routes: ['/api/rope/v1/health', '/api/rope/v1/catalog', '/api/rope/v1/forward', '/api/rope/v1/reverse'],
    formula: '0.0204055952 * dtex^0.5293147610 * n^0.5366123919',
    threadsPerStrand: [...core.THREAD_COUNTS],
    customDtex: { min: core.MIN_CUSTOM_DTEX, max: core.MAX_CUSTOM_DTEX },
    reverseTolerance: core.MAX_DEVIATION,
    forwardRequest: {
      catalog: { basis: 'catalog', threadId: 'string', threadsPerStrand: '1..5' },
      dtex: { basis: 'dtex', dtex: '80..6000', threadsPerStrand: '1..5' },
    },
    forwardResponse: ['apiVersion', 'algorithmVersion', 'catalogVersion', 'fetchedAt', 'basis', 'input', 'result'],
    forwardResult: ['basis', 'threadId', 'dtex', 'threadsPerStrand', 'strands', 'construction', 'diameterMm'],
    reverseRequest: { targetDiameterMm: '> 0', threadIds: 'string[] | absent' },
    reverseResponse: ['apiVersion', 'algorithmVersion', 'catalogVersion', 'fetchedAt', 'input', 'results'],
    reverseMatch: ['threadId', 'brand', 'number', 'dtex', 'threadsPerStrand', 'construction', 'diameterMm', 'deviationPercent'],
    reverseSort: ['|deviation|', 'dtex', 'threadsPerStrand', 'sortOrder', 'threadId'],
  },
  mcp: {
    calculate_rope_diameter: {
      input: { basis: "'catalog' | 'dtex'", threadId: 'string?', dtex: 'number 80..6000?', threadsPerStrand: 'int 1..5' },
      output: ['basis', 'threadId', 'dtex', 'diameterMm', 'threadsPerStrand', 'strands', 'construction', 'catalogVersion', 'apiVersion', 'algorithmVersion'],
      rounding: 'none: Worker numbers are passed through',
    },
    find_rope_threads: {
      input: { targetDiameterMm: 'number > 0', threadIds: 'string[]?' },
      output: ['targetDiameterMm', 'tolerancePercent', 'totalMatched', 'catalogVersion', 'apiVersion', 'algorithmVersion', 'results'],
      rounding: 'none: Worker numbers are passed through',
    },
  },
  forward: { catalog: forwardCatalog, dtex: forwardDtex },
  reverse,
};

const text = `${JSON.stringify(snapshot, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== text) {
    console.error('legacy-v1-snapshot.json differs from the current code.');
    process.exit(1);
  }
  console.log('legacy-v1-snapshot.json matches the current code.');
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${OUT}: ${forwardCatalog.length} catalog, ${forwardDtex.length} dTex, ${reverse.length} reverse cases.`);
}
