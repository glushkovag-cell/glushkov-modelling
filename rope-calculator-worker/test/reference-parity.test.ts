import { describe, expect, it } from 'vitest';
import { calculateDiameterMm } from '../src/core/formula';
import { reference, relativeDifference } from './helpers';

describe('паритет с эталоном RopeCalc.html', () => {
  it('9 нитей × 3 конструкции дают 27 эталонных значений', () => {
    expect(reference.threads).toHaveLength(9);

    let checked = 0;
    for (const thread of reference.threads) {
      for (const threadsPerStrand of [1, 2, 3] as const) {
        const expected = thread.diametersMm[String(threadsPerStrand) as '1' | '2' | '3'];
        const actual = calculateDiameterMm(thread.dtex, threadsPerStrand);

        expect(relativeDifference(actual, expected)).toBeLessThan(1e-12);
        checked += 1;
      }
    }

    expect(checked).toBe(27);
  });

  it('совпадает с эталонными значениями для ручного dTex', () => {
    expect(reference.custom).toHaveLength(4);

    for (const anchor of reference.custom) {
      const actual = calculateDiameterMm(anchor.dtex, anchor.threadsPerStrand);
      expect(relativeDifference(actual, anchor.diameterMm)).toBeLessThan(1e-12);
    }
  });

  it('не округляет промежуточный результат', () => {
    // Tera 40 × 2 по эталону: 0.9631868577202545; округление до трёх знаков
    // произошло бы только при выводе.
    expect(calculateDiameterMm(750, 2)).toBeCloseTo(0.9631868577202545, 12);
    expect(calculateDiameterMm(750, 2)).not.toBe(0.963);
  });

  it('порядок умножения совпадает с эталоном', () => {
    // Проверяем именно группировку (0.01752 × dtex^0.5437) × n^0.5880.
    const left = 0.01752 * Math.pow(750, 0.5437);
    expect(calculateDiameterMm(750, 2)).toBe(left * Math.pow(2, 0.588));
  });
});
