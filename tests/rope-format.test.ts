import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    MAX_CUSTOM_DTEX,
    MEASURED_DTEX_MAX,
    MIN_CUSTOM_DTEX,
    TOLERANCE_PERCENT,
    formatConstruction,
    formatDeviation,
    formatDiameter,
    formatSelectionSummary,
    formatThreadLabel,
    normalizeDecimal,
    parseCustomDtex,
    parseTargetDiameter,
} from '../src/widgets/rope-calculator/format.ts';

test('диаметр печатается с тремя знаками и единицами', () => {
    assert.equal(formatDiameter(0.9631868577202545), '0.963 mm');
    assert.equal(formatDiameter(3.786712), '3.787 mm');
    assert.equal(formatDiameter(0.9806440349690794), '0.981 mm');
    assert.equal(formatDiameter(1.0201549921706878), '1.020 mm');
});

test('отклонение печатается в процентах со знаком', () => {
    assert.equal(formatDeviation(-1.935596503092063), '-1.94%');
    assert.equal(formatDeviation(1.935596503092063), '+1.94%');
    assert.equal(formatDeviation(-3.676), '-3.68%');
});

test('почти нулевое отклонение выводится как 0.00% без знака', () => {
    assert.equal(formatDeviation(0), '0.00%');
    assert.equal(formatDeviation(0.004), '0.00%');
    assert.equal(formatDeviation(-0.004), '0.00%');
});

test('граница правила почти нуля', () => {
    // 0.005 уже не «почти ноль»: |pct| < 0.005 — строгое неравенство.
    assert.equal(formatDeviation(0.005), '+0.01%');
    assert.equal(formatDeviation(-0.005), '-0.01%');
});

test('конструкция печатается как N × 3', () => {
    assert.equal(formatConstruction(1), '1 × 3');
    assert.equal(formatConstruction(2), '2 × 3');
    assert.equal(formatConstruction(3), '3 × 3');
});

test('подпись нити совпадает с эталонным форматом', () => {
    assert.equal(
        formatThreadLabel({ brand: 'Tera', number: '40', dtex: 750 }),
        'Tera 40 — 750 dTex',
    );
    assert.equal(
        formatThreadLabel({ brand: 'Skala', number: '240', dtex: 119 }),
        'Skala 240 — 119 dTex',
    );
});

test('ручной dTex принимается в диапазоне 22.22–6000 включительно', () => {
    assert.equal(parseCustomDtex('750'), 750);
    assert.equal(parseCustomDtex(' 22.22 '), 22.22);
    assert.equal(parseCustomDtex('40'), 40);
    assert.equal(parseCustomDtex('6000'), 6000);
    assert.equal(parseCustomDtex('80.5'), 80.5);
});

test('десятичная запятая нормализуется на границе интерфейса', () => {
    assert.equal(normalizeDecimal('22,22'), '22.22');
    assert.equal(normalizeDecimal(' 1,5 '), '1.5');
    assert.equal(parseCustomDtex('22,22'), 22.22);
    assert.equal(parseCustomDtex('750,5'), 750.5);
    assert.equal(parseTargetDiameter('1,2'), 1.2);
});

test('ручной dTex отклоняется вне диапазона и для мусора', () => {
    for (const raw of ['', '   ', '22.21', '6000.01', 'abc', 'NaN', '-5', '1,2,3']) {
        assert.equal(parseCustomDtex(raw), null, `ожидался null для ${JSON.stringify(raw)}`);
    }
});

test('целевой диаметр требует положительного числа', () => {
    assert.equal(parseTargetDiameter('1.00'), 1);
    assert.equal(parseTargetDiameter('0.053'), 0.053);
    assert.equal(parseTargetDiameter('3,5'), 3.5);

    for (const raw of ['', '0', '-1', 'abc', 'Infinity']) {
        assert.equal(parseTargetDiameter(raw), null, `ожидался null для ${JSON.stringify(raw)}`);
    }
});

test('границы диапазона совпадают с контрактом API', () => {
    assert.equal(MIN_CUSTOM_DTEX, 22.22);
    assert.equal(MAX_CUSTOM_DTEX, 6000);
    assert.equal(parseCustomDtex(String(MIN_CUSTOM_DTEX)), MIN_CUSTOM_DTEX);
    assert.equal(parseCustomDtex(String(MAX_CUSTOM_DTEX)), MAX_CUSTOM_DTEX);
});

test('сводка выбора показывает фактическое число нитей и брендов', () => {
    assert.equal(formatSelectionSummary(5, 3), 'Selected 5 threads in 3 brands');
    assert.equal(formatSelectionSummary(1, 1), 'Selected 1 thread in 1 brand');
    assert.equal(formatSelectionSummary(22, 3), 'Selected 22 threads in 3 brands');
    assert.equal(formatSelectionSummary(0, 0), 'No threads selected');
});

test('допуск и измеренная граница совпадают с контрактом API', () => {
    assert.equal(TOLERANCE_PERCENT, 10);
    assert.equal(MEASURED_DTEX_MAX, 3000);
});

test('текст интерфейса совпадает с приёмочной таблицей модели', () => {
    const fixtureUrl = new URL(
        '../docs/rope-calculator/fixtures/golden-model.json',
        import.meta.url,
    );
    const golden = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as {
        rows: Array<{ dtex: number; threadsPerStrand: number; diameterMm: number; text: string }>;
    };

    assert.ok(golden.rows.length >= 9);

    for (const row of golden.rows) {
        assert.equal(
            formatDiameter(row.diameterMm),
            `${row.text} mm`,
            `ожидался текст ${row.text} для ${row.dtex} × ${row.threadsPerStrand}`,
        );
    }
});
