/**
 * Мост к общему расчётному ядру сайта.
 *
 * Ядро остаётся единственным источником формул: Worker не содержит копии
 * коэффициентов, документов профилей или ролей и импортирует те же чистые
 * функции, что и сайт.
 */

export { calculate } from '../../../src/lib/rigging/calculate.ts';
export { validateProfileDocument } from '../../../src/lib/rigging/document.ts';
export {
  ALGORITHM_VERSION,
  DEFAULT_PROFILE_ID,
  SCHEMA_VERSION,
} from '../../../src/lib/rigging/types.ts';
export type {
  Calculation,
  RiggingInput,
  RiggingResult,
} from '../../../src/lib/rigging/types.ts';
export type {
  ProfileDocument,
  ProfileManifest,
} from '../../../src/lib/rigging/document.ts';
