import { describe, expect, it } from 'vitest';
import { parseForwardInput, parseReverseInput } from '../src/core/validation';
import { errorCodeOf } from './helpers';

describe('parseForwardInput', () => {
  it('принимает каталожный расчёт и обрезает threadId', () => {
    expect(
      parseForwardInput({ basis: 'catalog', threadId: ' tera-40 ', threadsPerStrand: 2 }),
    ).toEqual({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 });
  });

  it('принимает ручной dTex на границах диапазона', () => {
    expect(parseForwardInput({ basis: 'dtex', dtex: 80, threadsPerStrand: 1 })).toEqual({
      basis: 'dtex',
      dtex: 80,
      threadsPerStrand: 1,
    });
    expect(parseForwardInput({ basis: 'dtex', dtex: 6000, threadsPerStrand: 3 })).toEqual({
      basis: 'dtex',
      dtex: 6000,
      threadsPerStrand: 3,
    });
  });

  it.each([
    ['ниже минимума', 79.99],
    ['выше максимума', 6000.01],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['строка вместо числа', '750'],
  ])('отклоняет dTex: %s', (_label, dtex) => {
    expect(errorCodeOf(() => parseForwardInput({ basis: 'dtex', dtex, threadsPerStrand: 2 }))).toBe(
      'INVALID_PARAMS',
    );
  });

  it.each([0, 4, 1.5, '2', null])('отклоняет threadsPerStrand = %s', (threadsPerStrand) => {
    expect(
      errorCodeOf(() => parseForwardInput({ basis: 'dtex', dtex: 750, threadsPerStrand })),
    ).toBe('INVALID_PARAMS');
  });

  it('отклоняет неизвестный basis', () => {
    expect(errorCodeOf(() => parseForwardInput({ basis: 'other' }))).toBe('INVALID_PARAMS');
  });

  it('отклоняет пустой threadId для каталожного расчёта', () => {
    expect(
      errorCodeOf(() => parseForwardInput({ basis: 'catalog', threadId: '   ', threadsPerStrand: 2 })),
    ).toBe('INVALID_PARAMS');
  });

  it.each([null, [], 'body', 42])('отклоняет тело не-объект: %s', (body) => {
    expect(errorCodeOf(() => parseForwardInput(body))).toBe('INVALID_PARAMS');
  });
});

describe('parseReverseInput', () => {
  it('принимает target без списка нитей', () => {
    expect(parseReverseInput({ targetDiameterMm: 1 })).toEqual({ targetDiameterMm: 1 });
  });

  it('схлопывает дубли threadIds с сохранением порядка', () => {
    expect(
      parseReverseInput({ targetDiameterMm: 1.5, threadIds: ['tera-40', 'tera-60', 'tera-40'] }),
    ).toEqual({ targetDiameterMm: 1.5, threadIds: ['tera-40', 'tera-60'] });
  });

  it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])(
    'отклоняет targetDiameterMm = %s',
    (targetDiameterMm) => {
      expect(errorCodeOf(() => parseReverseInput({ targetDiameterMm }))).toBe('INVALID_PARAMS');
    },
  );

  it('требует targetDiameterMm', () => {
    expect(errorCodeOf(() => parseReverseInput({}))).toBe('INVALID_PARAMS');
  });

  it.each([
    ['пустой массив', []],
    ['строка вместо массива', 'tera-40'],
    ['пустая строка в массиве', ['']],
    ['число в массиве', [1]],
  ])('отклоняет threadIds: %s', (_label, threadIds) => {
    expect(errorCodeOf(() => parseReverseInput({ targetDiameterMm: 1, threadIds }))).toBe(
      'INVALID_PARAMS',
    );
  });
});
