#!/usr/bin/env node
/**
 * Генератор и проверка фикстур калькулятора канатов.
 *
 * Источник истины для актуальной модели — код воркера: коэффициенты берутся
 * из rope-calculator-worker/src/core/model.ts, версии и границы — из
 * constants.ts. Вручную коэффициенты здесь не переписываются, поэтому
 * расхождение кода и фикстур ловится проверкой.
 *
 * reference.json — исторический baseline алгоритма 2.0.0 из RopeCalc.html
 * (формула замороженного контракта v1). Он не перегенерируется из HTML по
 * умолчанию: модель 4.0.0 намеренно даёт другие диаметры, и подменять baseline
 * нельзя.
 *
 * Режимы:
 *   node scripts/gen-rope-fixtures.mjs                  проверить golden, снимок CMS и исторический baseline
 *   node scripts/gen-rope-fixtures.mjs --catalog        пересобрать снимок CMS из GraphQL (нужны WP_GRAPHQL_*)
 *   node scripts/gen-rope-fixtures.mjs --check          ничего не писать, упасть при расхождении
 *   node scripts/gen-rope-fixtures.mjs --legacy-reference  пересобрать исторический reference.json из HTML
 *
 * Переменные окружения для --catalog: WP_GRAPHQL_URL, WP_GRAPHQL_SECRET.
 * Значения читаются из окружения или из .env в корне репозитория.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = join(ROOT, 'docs/rope-calculator/reference/RopeCalc.html');
const REFERENCE_FILE = join(ROOT, 'docs/rope-calculator/fixtures/reference.json');
const SNAPSHOT_FILE = join(ROOT, 'docs/rope-calculator/fixtures/catalog-snapshot.json');
const GOLDEN_FILE = join(ROOT, 'docs/rope-calculator/fixtures/golden-model.json');
const CORE_FORMULA_FILE = join(ROOT, 'rope-calculator-worker/src/core/model.ts');
const CORE_CONSTANTS_FILE = join(ROOT, 'rope-calculator-worker/src/core/constants.ts');

const THREAD_COUNTS = [1, 2, 3, 4, 5];
const STRANDS = 3;
const CUSTOM_ANCHORS = [
  { dtex: 80, threadsPerStrand: 1 },
  { dtex: 750, threadsPerStrand: 2 },
  { dtex: 3000, threadsPerStrand: 3 },
  { dtex: 6000, threadsPerStrand: 3 },
  { dtex: 1500, threadsPerStrand: 5 },
];

const CATALOG_QUERY = `
  query RopeCatalog {
    ropeThreads(first: 100) {
      pageInfo { hasNextPage }
      nodes {
        slug
        status
        ropethreadfields { threadId brand number dtex enabled sortOrder }
      }
    }
  }
`;

const flags = new Set(process.argv.slice(2));
const CHECK_ONLY = flags.has('--check');
const FETCH_CATALOG = flags.has('--catalog');
const REBUILD_LEGACY_REFERENCE = flags.has('--legacy-reference');

const problems = [];

function fail(message) {
  problems.push(message);
  console.error(`ОШИБКА: ${message}`);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function compareIds(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Нормализованное представление каталога, по которому считается версия. */
function canonicalThreads(threads) {
  return threads.map((thread) => ({
    threadId: thread.threadId,
    brand: thread.brand,
    number: thread.number,
    dtex: thread.dtex,
    sortOrder: thread.sortOrder,
    enabled: thread.enabled,
  }));
}

function catalogVersion(threads) {
  return sha256(JSON.stringify(canonicalThreads(threads))).slice(0, 12);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(path, value) {
  if (CHECK_ONLY) {
    if (!existsSync(path)) {
      fail(`${path}: файл отсутствует`);
      return;
    }
    const current = readFileSync(path, 'utf8');
    const next = stableJson(value);
    if (current !== next) {
      fail(`${path}: содержимое расходится с генератором (запустите без --check)`);
      return;
    }
    console.log(`ok   ${path}`);
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableJson(value));
  console.log(`write ${path}`);
}

function extractOracle(html) {
  const formulaMatch = html.match(
    /function\s+diameterByDtex\s*\(\s*dtex\s*,\s*threads\s*\)\s*\{\s*return\s*\(([\s\S]*?)\)\s*;\s*\}/,
  );

  if (!formulaMatch) {
    throw new Error(
      'В эталонном файле не найдена функция diameterByDtex(dtex, threads) — формат исходника изменился.',
    );
  }

  const expression = formulaMatch[1].replace(/\s+/g, ' ').trim();

  // Тот же код, что исполнял браузер: строка из исходника, а не переписанная вручную.
  const diameter = new Function('dtex', 'threads', `"use strict"; return (${expression});`);

  const toleranceMatch = html.match(/const\s+MAX_DEVIATION\s*=\s*([0-9.]+)\s*;/);
  const countsMatch = html.match(/const\s+THREAD_COUNTS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/);

  if (!toleranceMatch) {
    throw new Error('В эталонном файле не найдена константа MAX_DEVIATION.');
  }
  if (!countsMatch) {
    throw new Error('В эталонном файле не найдена константа THREAD_COUNTS.');
  }

  const counts = countsMatch[1]
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));

  return {
    expression,
    diameter,
    maxDeviation: Number(toleranceMatch[1]),
    threadCounts: counts,
  };
}

function extractSourceCatalog(html) {
  const entryPattern =
    /Object\.freeze\(\{\s*brand:\s*"([^"]+)",\s*number:\s*(\d+),\s*dtex:\s*(\d+)\s*\}\)/g;

  const threads = [];
  for (const match of html.matchAll(entryPattern)) {
    threads.push({ brand: match[1], number: String(match[2]), dtex: Number(match[3]) });
  }

  if (threads.length === 0) {
    throw new Error('В эталонном файле не найден THREAD_CATALOG.');
  }

  return threads;
}

/**
 * Коэффициенты и константы текущей модели читаются из кода воркера.
 *
 * Тело calculateDiameterMm — обычный JavaScript без типов, поэтому оно
 * исполняется как есть: скрипт проверяет реальную формулу, а не её копию.
 */
function extractModel() {
  const formulaSource = readFileSync(CORE_FORMULA_FILE, 'utf8');
  const constantsSource = readFileSync(CORE_CONSTANTS_FILE, 'utf8');

  const bodyMatch = formulaSource.match(
    /export function calculateDiameterMm\([^)]*\)\s*:[^{]*\{([\s\S]*?)\n\}/,
  );
  if (!bodyMatch) {
    throw new Error(`${CORE_FORMULA_FILE}: не найдено тело calculateDiameterMm.`);
  }
  const diameter = new Function('dtex', 'threadsPerStrand', `"use strict";\n${bodyMatch[1]}`);

  const constant = (name) => {
    const match = constantsSource.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
    if (!match) throw new Error(`${CORE_CONSTANTS_FILE}: не найдена константа ${name}.`);
    return match[1].trim();
  };
  const stringConstant = (name) => constant(name).replace(/^['"]|['"]$/g, '');
  const numberConstant = (name) => Number(constant(name));

  return {
    algorithmVersion: stringConstant('TARGET_ALGORITHM_VERSION'),
    modelId: stringConstant('MODEL_ID'),
    maxDeviation: numberConstant('MAX_DEVIATION'),
    minCustomDtex: numberConstant('TARGET_MIN_CUSTOM_DTEX'),
    maxCustomDtex: numberConstant('TARGET_MAX_CUSTOM_DTEX'),
    measuredDtexMin: numberConstant('MEASURED_DTEX_MIN'),
    measuredDtexMax: numberConstant('MEASURED_DTEX_MAX'),
    diameter,
  };
}

/** Приёмочная таблица модели. Значения заданы ТЗ, скрипт их не пересобирает. */
function verifyGolden(model) {
  const golden = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));

  if (golden.model.apiVersion !== '2') {
    fail('golden: apiVersion должен быть 2');
  }
  if (golden.model.algorithmVersion !== model.algorithmVersion) {
    fail(`golden: algorithmVersion ${golden.model.algorithmVersion} != ${model.algorithmVersion}`);
  }
  if (golden.model.modelId !== model.modelId) {
    fail(`golden: modelId ${golden.model.modelId} != ${model.modelId}`);
  }
  if (golden.model.tolerance !== model.maxDeviation) {
    fail(`golden: допуск ${golden.model.tolerance} != ${model.maxDeviation}`);
  }
  if (golden.model.customDtexRange[0] !== model.minCustomDtex) {
    fail('golden: нижняя граница custom dTex расходится с константами');
  }
  if (golden.model.customDtexRange[1] !== model.maxCustomDtex) {
    fail('golden: верхняя граница custom dTex расходится с константами');
  }
  if (golden.model.measuredDtexRange[1] !== model.measuredDtexMax) {
    fail('golden: граница измеренного диапазона расходится с константами');
  }

  for (const row of golden.rows) {
    const actual = model.diameter(row.dtex, row.threadsPerStrand);
    if (Math.abs(actual - row.diameterMm) > 1e-9) {
      fail(`golden: ${row.dtex} × ${row.threadsPerStrand} даёт ${actual}, ожидалось ${row.diameterMm}`);
    }
    if (actual.toFixed(3) !== row.text) {
      fail(`golden: текст ${row.dtex} × ${row.threadsPerStrand} — ${actual.toFixed(3)}, ожидалось ${row.text}`);
    }
  }

  if (problems.length === 0) {
    console.log(`ok   ${GOLDEN_FILE} (${golden.rows.length} строк, ${model.algorithmVersion})`);
  }
}

function diameters(diameter, dtex) {
  const result = {};
  for (const threadsPerStrand of THREAD_COUNTS) {
    const value = diameter(dtex, threadsPerStrand);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Формула дала некорректный диаметр для dtex=${dtex}, n=${threadsPerStrand}: ${value}`);
    }
    result[String(threadsPerStrand)] = value;
  }
  return result;
}

function buildReference(oracle, html, sourceThreads) {
  return {
    schema: 1,
    source: {
      file: 'docs/rope-calculator/reference/RopeCalc.html',
      sha256: sha256(html),
      threadCount: sourceThreads.length,
    },
    algorithm: {
      expression: oracle.expression,
      source: 'RopeCalc.html: diameterByDtex(dtex, threads)',
      threadsPerStrand: oracle.threadCounts,
      strands: STRANDS,
      maxDeviation: oracle.maxDeviation,
      nearZeroPercent: 0.005,
    },
    threads: sourceThreads.map((thread) => ({
      brand: thread.brand,
      number: thread.number,
      dtex: thread.dtex,
      diametersMm: diameters(oracle.diameter, thread.dtex),
    })),
    custom: CUSTOM_ANCHORS.map((anchor) => ({
      dtex: anchor.dtex,
      threadsPerStrand: anchor.threadsPerStrand,
      diameterMm: oracle.diameter(anchor.dtex, anchor.threadsPerStrand),
    })),
  };
}

function loadEnv() {
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return;

  for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
    const match = rawLine.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    process.env[match[1]] ??= value;
  }
}

async function fetchCatalog() {
  loadEnv();

  const endpoint = process.env.WP_GRAPHQL_URL;
  if (!endpoint) {
    throw new Error('WP_GRAPHQL_URL не задан: снимок каталога нельзя обновить.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.WP_GRAPHQL_SECRET
        ? { 'x-graphql-secret': process.env.WP_GRAPHQL_SECRET }
        : {}),
    },
    body: JSON.stringify({ query: CATALOG_QUERY }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`CMS вернула HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`GraphQL вернул ошибки: ${JSON.stringify(payload.errors)}`);
  }

  const connection = payload.data?.ropeThreads;
  if (!connection) {
    throw new Error('В ответе GraphQL нет ropeThreads.');
  }
  if (connection.pageInfo?.hasNextPage) {
    throw new Error('Каталог не поместился в первую страницу: нужна пагинация.');
  }

  const threads = connection.nodes
    .filter((node) => node.status === 'publish')
    .map((node) => {
      const fields = node.ropethreadfields ?? {};
      return {
        threadId: String(fields.threadId ?? '').trim(),
        brand: String(fields.brand ?? '').trim(),
        number: String(fields.number ?? '').trim(),
        dtex: Number(fields.dtex),
        sortOrder: Number(fields.sortOrder),
        enabled: fields.enabled === true,
        slug: node.slug,
      };
    });

  return threads;
}

function validateCatalog(threads) {
  if (threads.length === 0) {
    throw new Error('Каталог пуст: нет опубликованных нитей.');
  }

  const seen = new Set();
  for (const thread of threads) {
    if (!thread.threadId) throw new Error(`Нить ${thread.slug} без threadId.`);
    if (!thread.brand) throw new Error(`Нить ${thread.threadId} без brand.`);
    if (!thread.number) throw new Error(`Нить ${thread.threadId} без number.`);
    if (!Number.isFinite(thread.dtex) || thread.dtex <= 0) {
      throw new Error(`Нить ${thread.threadId}: некорректный dtex (${thread.dtex}).`);
    }
    if (!Number.isFinite(thread.sortOrder)) {
      throw new Error(`Нить ${thread.threadId}: некорректный sortOrder.`);
    }
    if (seen.has(thread.threadId)) {
      throw new Error(`Дубль threadId: ${thread.threadId}.`);
    }
    seen.add(thread.threadId);
  }
}

function buildSnapshot(threads, model) {
  const active = threads
    .filter((thread) => thread.enabled)
    .map((thread) => ({
      threadId: thread.threadId,
      brand: thread.brand,
      number: thread.number,
      dtex: thread.dtex,
      sortOrder: thread.sortOrder,
      enabled: true,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.threadId, b.threadId));

  if (active.length === 0) {
    throw new Error('После фильтра enabled не осталось ни одной нити.');
  }

  return {
    schema: 1,
    source: {
      system: 'WPGraphQL',
      type: 'RopeThread',
      field: 'ropethreadfields',
      publishedCount: threads.length,
      activeCount: active.length,
    },
    catalogVersion: catalogVersion(active),
    threads: active.map((thread) => ({
      ...thread,
      diametersMm: diameters(model.diameter, thread.dtex),
    })),
  };
}

function verifySnapshot(snapshot, model) {
  if (snapshot.schema !== 1) fail('snapshot: неожиданная версия схемы');
  if (!Array.isArray(snapshot.threads) || snapshot.threads.length === 0) {
    fail('snapshot: нет нитей');
    return;
  }

  const ids = new Set();
  let previous = null;

  for (const thread of snapshot.threads) {
    if (ids.has(thread.threadId)) fail(`snapshot: дубль threadId ${thread.threadId}`);
    ids.add(thread.threadId);

    if (previous) {
      const outOfOrder =
        thread.sortOrder < previous.sortOrder ||
        (thread.sortOrder === previous.sortOrder && compareIds(thread.threadId, previous.threadId) < 0);
      if (outOfOrder) {
        fail(`snapshot: нарушен порядок на ${thread.threadId}`);
      }
    }
    previous = thread;

    const expected = diameters(model.diameter, thread.dtex);
    for (const n of THREAD_COUNTS) {
      const actual = thread.diametersMm?.[String(n)];
      if (typeof actual !== 'number' || Math.abs(actual - expected[String(n)]) > 1e-12) {
        fail(`snapshot: диаметр ${thread.threadId} × ${n} не совпадает с эталонной формулой`);
      }
    }
  }

  const expectedVersion = catalogVersion(snapshot.threads);
  if (snapshot.catalogVersion !== expectedVersion) {
    fail(`snapshot: catalogVersion ${snapshot.catalogVersion} != ${expectedVersion}`);
  }

  if (problems.length === 0) {
    console.log(`ok   ${SNAPSHOT_FILE} (${snapshot.threads.length} нитей, ${snapshot.catalogVersion})`);
  }
}

/**
 * Дрейф: dTex каталога относительно исторического эталона и диаметры новой
 * модели относительно baseline 2.0.0. Это отчёт, а не ошибка: новая формула
 * намеренно даёт другие значения.
 */
function reportDrift(reference, snapshot, model) {
  const byKey = new Map(
    reference.threads.map((thread) => [`${thread.brand} ${thread.number}`, thread]),
  );

  const dtexRows = [];
  const modelRows = [];

  for (const thread of snapshot.threads) {
    const source = byKey.get(`${thread.brand} ${thread.number}`);
    if (!source) continue;

    if (source.dtex !== thread.dtex) {
      dtexRows.push({
        threadId: thread.threadId,
        source: source.dtex,
        cms: thread.dtex,
        percent: ((thread.dtex - source.dtex) / source.dtex) * 100,
      });
    }

    const previous = source.diametersMm['3'];
    const current = model.diameter(thread.dtex, 3);
    modelRows.push({ threadId: thread.threadId, previous, current, percent: ((current - previous) / previous) * 100 });
  }

  if (dtexRows.length === 0) {
    console.log('drift dTex: каталог CMS совпадает с историческим эталоном');
  } else {
    console.log('drift dTex (исторический эталон → CMS, отклонение самой линейной плотности):');
    for (const row of dtexRows) {
      console.log(
        `  ${row.threadId}: ${row.source} → ${row.cms} (${row.percent >= 0 ? '+' : ''}${row.percent.toFixed(3)}%)`,
      );
    }
  }

  if (modelRows.length === 0) {
    console.log('drift модели: общих нитей с baseline нет');
    return;
  }

  const squares = modelRows.map((row) => (row.percent / 100) ** 2);
  const rmspe = Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / squares.length) * 100;
  const min = modelRows.reduce((a, b) => (a.percent <= b.percent ? a : b));
  const max = modelRows.reduce((a, b) => (a.percent >= b.percent ? a : b));

  console.log(
    `drift модели ${model.algorithmVersion} к baseline 2.0.0 (3 × 3, ${modelRows.length} нитей): ` +
      `RMSPE ${rmspe.toFixed(2)}%, от ${min.threadId} ${min.percent.toFixed(1)}% до ` +
      `${max.threadId} ${max.percent.toFixed(1)}%`,
  );
}

/**
 * Проверка покрытия каталога моделью.
 *
 * Каталог не должен молча терять позиции: значение вне 22.22–6000 — это
 * осознанное исключение, которое нужно согласовать, а не тихо проглотить.
 */
function verifyCatalogCoverage(snapshot, model) {
  const outside = snapshot.threads.filter(
    (thread) => thread.dtex < model.minCustomDtex || thread.dtex > model.maxCustomDtex,
  );

  if (outside.length > 0) {
    for (const thread of outside) {
      fail(
        `каталог: ${thread.threadId} с ${thread.dtex} dTex вне диапазона модели ` +
          `${model.minCustomDtex}–${model.maxCustomDtex}`,
      );
    }
    return;
  }

  const extrapolated = snapshot.threads.filter((thread) => thread.dtex > model.measuredDtexMax);
  console.log(
    `покрытие каталога: ${snapshot.threads.length} нитей в диапазоне модели, ` +
      `${extrapolated.length} выше измеренного предела ${model.measuredDtexMax} dTex ` +
      `(EXTRAPOLATION)`,
  );
}

async function main() {
  const model = extractModel();

  console.log(`модель: ${model.algorithmVersion} (${model.modelId})`);
  console.log(
    `диапазон custom dTex: ${model.minCustomDtex}–${model.maxCustomDtex}, ` +
      `измерено до ${model.measuredDtexMax}, допуск: ${model.maxDeviation}`,
  );

  verifyGolden(model);

  let reference;
  if (REBUILD_LEGACY_REFERENCE) {
    const html = readFileSync(SOURCE_FILE, 'utf8');
    const oracle = extractOracle(html);
    const sourceThreads = extractSourceCatalog(html);

    reference = buildReference(oracle, html, sourceThreads);
    writeJson(REFERENCE_FILE, reference);
    console.log(`исторический эталон пересобран из ${SOURCE_FILE}`);
  } else {
    if (!existsSync(REFERENCE_FILE)) {
      fail(`${REFERENCE_FILE}: исторический baseline отсутствует`);
    } else {
      reference = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8'));
      const values = reference.threads.reduce(
        (sum, thread) => sum + Object.keys(thread.diametersMm).length,
        0,
      );
      console.log(`ok   ${REFERENCE_FILE} (baseline ${reference.algorithm.expression}, ${values} значений)`);
    }
  }

  let snapshot;

  if (FETCH_CATALOG) {
    const threads = await fetchCatalog();
    validateCatalog(threads);
    snapshot = buildSnapshot(threads, model);
    writeJson(SNAPSHOT_FILE, snapshot);
    console.log(
      `каталог CMS: опубликовано ${threads.length}, активно ${snapshot.threads.length}, версия ${snapshot.catalogVersion}`,
    );
  } else if (existsSync(SNAPSHOT_FILE)) {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
  } else {
    fail(`${SNAPSHOT_FILE}: снимок отсутствует, запустите с --catalog`);
  }

  if (snapshot) {
    verifySnapshot(snapshot, model);
    verifyCatalogCoverage(snapshot, model);
    reportDrift(reference, snapshot, model);
  }

  if (problems.length > 0) {
    console.error(`\nПроверка не пройдена: ${problems.length} проблем(ы).`);
    process.exit(1);
  }

  console.log('\nГотово.');
}

await main();
