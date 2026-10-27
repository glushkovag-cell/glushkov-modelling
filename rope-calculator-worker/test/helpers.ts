import referenceFixture from '../../docs/rope-calculator/fixtures/reference.json';
import snapshotFixture from '../../docs/rope-calculator/fixtures/catalog-snapshot.json';
import type { CatalogThread } from '../src/core/types';

/** Эталонные значения, извлечённые из RopeCalc.html. */
export const reference = referenceFixture;

/** Снимок каталога CMS на 27.10.2026. */
export const snapshot = snapshotFixture;

/** Каталог в форме, которую отдаёт Worker. */
export const catalog: CatalogThread[] = snapshot.threads.map((thread) => ({
  threadId: thread.threadId,
  brand: thread.brand,
  number: thread.number,
  dtex: thread.dtex,
  sortOrder: thread.sortOrder,
  enabled: thread.enabled,
}));

/** Относительная разница: сравнение не зависит от масштаба диаметра. */
export function relativeDifference(actual: number, expected: number): number {
  return Math.abs(actual - expected) / expected;
}

export function errorCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    throw error;
  }
  throw new Error('Ожидалась ошибка, но вызов завершился успешно.');
}
