/**
 * Мост к общему расчётному ядру сайта.
 *
 * Ядро остаётся единственным источником формул: Worker не содержит копии
 * коэффициентов и импортирует те же чистые функции, что и клиент.
 */

export { calculate } from '../../../src/lib/rigging/calculate.ts';
export { PROFILE_REGISTRY, findSuitableProfiles } from '../../../src/lib/rigging/profiles.ts';
export {
  ALGORITHM_VERSION,
  PROFILE_ID,
  PROFILE_VERSION,
  SCHEMA_VERSION,
} from '../../../src/lib/rigging/types.ts';
export type {
  Calculation,
  HistoricalContext,
  RiggingInput,
  RiggingResult,
} from '../../../src/lib/rigging/types.ts';
