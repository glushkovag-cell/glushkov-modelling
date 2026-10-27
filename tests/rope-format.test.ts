import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_CUSTOM_DTEX,
    MIN_CUSTOM_DTEX,
    formatConstruction,
    formatDeviation,
    formatDiameter,
    formatThreadLabel,
    parseCustomDtex,
} from '../src/widgets/rope-calculator/format.ts';

test('диаметр печатается с тремя знаками и единицами', () => {
    assert.equal(formatDiameter(0.9631868577202545), '0.963 mm');
    assert.equal(formatDiameter(3.786712), '3.787 mm');
    assert.equal(formatDiameter(0.9806440349690794), '0.981 mm');
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

test('ручной dTex принимается в диапазоне 80–6000 включительно', () => {
    assert.equal(parseCustomDtex('750'), 750);
    assert.equal(parseCustomDtex(' 80 '), 80);
    assert.equal(parseCustomDtex('6000'), 6000);
    assert.equal(parseCustomDtex('80.5'), 80.5);
});

test('ручной dTex отклоняется вне диапазона и для мусора', () => {
    for (const raw of ['', '   ', '79.99', '6000.01', 'abc', 'NaN', '-5']) {
        assert.equal(parseCustomDtex(raw), null, `ожидался null для ${JSON.stringify(raw)}`);
    }
});

test('границы диапазона совпадают с контрактом API', () => {
    assert.equal(MIN_CUSTOM_DTEX, 80);
    assert.equal(MAX_CUSTOM_DTEX, 6000);
    assert.equal(parseCustomDtex(String(MIN_CUSTOM_DTEX)), MIN_CUSTOM_DTEX);
    assert.equal(parseCustomDtex(String(MAX_CUSTOM_DTEX)), MAX_CUSTOM_DTEX);
});
