import { describe, expect, it } from 'vitest';
import { MAX_DEVIATION, STRANDS, THREAD_COUNTS, ALGORITHM_VERSION } from '../src/core/constants';
import { reference } from './helpers';

describe('константы совпадают с эталоном', () => {
  it('допуск', () => {
    expect(MAX_DEVIATION).toBe(reference.algorithm.maxDeviation);
  });

  it('число нитей в пряди', () => {
    expect([...THREAD_COUNTS]).toEqual(reference.algorithm.threadsPerStrand);
  });

  it('число прядей', () => {
    expect(STRANDS).toBe(reference.algorithm.strands);
  });

  it('версия алгоритма в формате semver', () => {
    expect(ALGORITHM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
