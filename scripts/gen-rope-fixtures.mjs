#!/usr/bin/env node
/**
 * Генератор эталонных фикстур калькулятора канатов.
 *
 * Источник истины для формулы — docs/rope-calculator/reference/RopeCalc.html.
 * Выражение извлекается из исходной функции diameterByDtex(), поэтому правка
 * эталона меняет фикстуры, а не проходит незамеченной. Вручную формула в этом
 * скрипте не дублируется.
 *
 * Режимы:
 *   node scripts/gen-rope-fixtures.mjs             пересобрать reference.json и проверить снимок CMS
 *   node scripts/gen-rope-fixtures.mjs --catalog   пересобрать снимок CMS из GraphQL (нужны WP_GRAPHQL_*)
 *   node scripts/gen-rope-fixtures.mjs --check     ничего не писать, упасть при расхождении
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

const THREAD_COUNTS = [1, 2, 3];
const STRANDS = 3;
const CUSTOM_ANCHORS = [
  { dtex: 80, threadsPerStrand: 1 },
  { dtex: 750, threadsPerStrand: 2 },
  { dtex: 3000, threadsPerStrand: 3 },
  { dtex: 6000, threadsPerStrand: 3 },
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

function buildSnapshot(threads, oracle) {
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
      diametersMm: diameters(oracle.diameter, thread.dtex),
    })),
  };
}

function verifySnapshot(snapshot, oracle) {
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

    const expected = diameters(oracle.diameter, thread.dtex);
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

function reportDrift(reference, snapshot) {
  const byKey = new Map(
    reference.threads.map((thread) => [`${thread.brand} ${thread.number}`, thread]),
  );

  const rows = [];
  for (const thread of snapshot.threads) {
    const source = byKey.get(`${thread.brand} ${thread.number}`);
    if (!source) continue;
    if (source.dtex !== thread.dtex) {
      const percent = ((thread.diametersMm['3'] - source.diametersMm['3']) / source.diametersMm['3']) * 100;
      rows.push({ threadId: thread.threadId, source: source.dtex, cms: thread.dtex, percent });
    }
  }

  if (rows.length === 0) {
    console.log('drift: каталог CMS совпадает с эталоном по dtex');
    return;
  }

  console.log('drift (эталон → CMS, отклонение диаметра при 3 × 3):');
  for (const row of rows) {
    console.log(
      `  ${row.threadId}: ${row.source} → ${row.cms} (${row.percent >= 0 ? '+' : ''}${row.percent.toFixed(3)}%)`,
    );
  }
}

async function main() {
  const html = readFileSync(SOURCE_FILE, 'utf8');
  const oracle = extractOracle(html);
  const sourceThreads = extractSourceCatalog(html);

  console.log(`эталон: ${SOURCE_FILE}`);
  console.log(`формула: ${oracle.expression}`);
  console.log(`нитей в эталоне: ${sourceThreads.length}, допуск: ${oracle.maxDeviation}`);

  const reference = buildReference(oracle, html, sourceThreads);
  writeJson(REFERENCE_FILE, reference);

  let snapshot;

  if (FETCH_CATALOG) {
    const threads = await fetchCatalog();
    validateCatalog(threads);
    snapshot = buildSnapshot(threads, oracle);
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
    verifySnapshot(snapshot, oracle);
    reportDrift(reference, snapshot);
  }

  if (problems.length > 0) {
    console.error(`\nПроверка не пройдена: ${problems.length} проблем(ы).`);
    process.exit(1);
  }

  console.log('\nГотово.');
}

await main();
