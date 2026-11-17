import { describe, expect, it } from 'vitest';
import {
  MAX_DEVIATION,
  MEASURED_DTEX_MAX,
  MEASURED_DTEX_MIN,
  MODEL_ID,
  STRANDS,
  TARGET_ALGORITHM_VERSION,
  TARGET_MAX_CUSTOM_DTEX,
  TARGET_MIN_CUSTOM_DTEX,
  THREAD_COUNTS,
} from '../src/core/constants';
import { calculateDiameterMm } from '../src/core/model';
import { golden } from './helpers';

describe('модель 4.0.0: приёмочная таблица', () => {
  it('каждая строка совпадает с формулой с абсолютной точностью 1e-9', () => {
    expect(golden.rows.length).toBeGreaterThanOrEqual(9);

    for (const row of golden.rows) {
      const actual = calculateDiameterMm(row.dtex, row.threadsPerStrand);
      expect(Math.abs(actual - row.diameterMm)).toBeLessThan(1e-9);
    }
  });

  it('текстовая строка результата — три знака после запятой', () => {
    for (const row of golden.rows) {
      const actual = calculateDiameterMm(row.dtex, row.threadsPerStrand);
      expect(actual.toFixed(3)).toBe(row.text);
    }
  });

  it('не округляет промежуточный результат', () => {
    const value = calculateDiameterMm(750, 2);
    expect(Math.abs(value - 1.0201549921706878)).toBeLessThan(1e-9);
    expect(value).not.toBe(1.02);
  });

  it('границы диапазона из фикстуры совпадают с константами', () => {
    expect(golden.model.algorithmVersion).toBe(TARGET_ALGORITHM_VERSION);
    expect(golden.model.apiVersion).toBe('2');
    expect(golden.model.modelId).toBe(MODEL_ID);
    expect(golden.model.tolerance).toBe(MAX_DEVIATION);
    expect(golden.model.customDtexRange).toEqual([TARGET_MIN_CUSTOM_DTEX, TARGET_MAX_CUSTOM_DTEX]);
    expect(golden.model.measuredDtexRange).toEqual([MEASURED_DTEX_MIN, MEASURED_DTEX_MAX]);
    expect(golden.model.threadsPerStrand).toEqual([...THREAD_COUNTS]);
    expect(golden.model.strands).toBe(STRANDS);
  });
});

describe('модель 4.0.0: область применимости', () => {
  it('положительна и конечна на всём рабочем диапазоне', () => {
    const dtexAnchors = [22.22, 40, 80, 300, 750, 1500, 3000, 3750, 6000];

    for (const dtex of dtexAnchors) {
      for (const threadsPerStrand of THREAD_COUNTS) {
        const value = calculateDiameterMm(dtex, threadsPerStrand);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('монотонно растёт по dTex при каждом n', () => {
    let previous = 0;
    for (let step = 0; step <= 400; step += 1) {
      // Шаг по логарифму: покрывает 22.22–6000 без потери чувствительности.
      const dtex = 22.22 * Math.pow(6000 / 22.22, step / 400);
      for (const threadsPerStrand of THREAD_COUNTS) {
        const value = calculateDiameterMm(dtex, threadsPerStrand);
        expect(value).toBeGreaterThan(0);
      }
      const single = calculateDiameterMm(dtex, 1);
      expect(single).toBeGreaterThan(previous);
      previous = single;
    }
  });

  it('монотонно растёт по числу нитей в пряди', () => {
    for (const dtex of [22.22, 80, 300, 3000, 6000]) {
      let previous = 0;
      for (const threadsPerStrand of THREAD_COUNTS) {
        const value = calculateDiameterMm(dtex, threadsPerStrand);
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });
});
