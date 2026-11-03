import { describe, expect, it } from 'vitest';
import { calculateDiameterMm } from '../src/core/formula';
import { reference, relativeDifference } from './helpers';

describe('паритет с эталоном RopeCalc.html', () => {
  it('9 нитей × 5 конструкций дают 45 эталонных значений', () => {
    expect(reference.threads).toHaveLength(9);

    let checked = 0;
    for (const thread of reference.threads) {
      for (const threadsPerStrand of [1, 2, 3, 4, 5] as const) {
        const expected = thread.diametersMm[String(threadsPerStrand) as '1' | '2' | '3' | '4' | '5'];
        const actual = calculateDiameterMm(thread.dtex, threadsPerStrand);

        expect(relativeDifference(actual, expected)).toBeLessThan(1e-12);
        checked += 1;
      }
    }

    expect(checked).toBe(45);
  });

  it('совпадает с эталонными значениями для ручного dTex', () => {
    expect(reference.custom).toHaveLength(5);

    for (const anchor of reference.custom) {
      const actual = calculateDiameterMm(anchor.dtex, anchor.threadsPerStrand);
      expect(relativeDifference(actual, anchor.diameterMm)).toBeLessThan(1e-12);
    }
  });

  it('не округляет промежуточный результат', () => {
    // Tera 40 × 2 по эталону: 0.9842333087830643; округление до трёх знаков
    // произошло бы только при выводе.
    expect(calculateDiameterMm(750, 2)).toBeCloseTo(0.9842333087830643, 12);
    expect(calculateDiameterMm(750, 2)).not.toBe(0.984);
  });

  it('порядок умножения совпадает с эталоном', () => {
    // Проверяем именно группировку (0.0204055952 × dtex^0.5293147610) × n^0.5366123919.
    const left = 0.0204055952 * Math.pow(750, 0.529314761);
    expect(calculateDiameterMm(750, 2)).toBe(left * Math.pow(2, 0.5366123919));
  });
});
