import { MAX_CUSTOM_DTEX, MIN_CUSTOM_DTEX, THREAD_COUNTS } from './constants';
import { invalidParams } from './errors';
import type { ForwardInput, ReverseInput, ThreadCount } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidParams('Request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requireThreadCount(value: unknown): ThreadCount {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !THREAD_COUNTS.includes(value as ThreadCount)
  ) {
    throw invalidParams('threadsPerStrand must be 1, 2 or 3.', ['threadsPerStrand']);
  }
  return value as ThreadCount;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidParams(`${field} must be a finite number.`, [field]);
  }
  return value;
}

/**
 * Разбирает и валидирует тело прямого расчёта. Возвращает нормализованный
 * вход либо бросает RopeError с кодом INVALID_PARAMS.
 */
export function parseForwardInput(raw: unknown): ForwardInput {
  const body = asRecord(raw);

  if (body.basis === 'catalog') {
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    if (threadId === '') {
      throw invalidParams('threadId is required when basis is "catalog".', ['threadId']);
    }
    return {
      basis: 'catalog',
      threadId,
      threadsPerStrand: requireThreadCount(body.threadsPerStrand),
    };
  }

  if (body.basis === 'dtex') {
    const dtex = requireFiniteNumber(body.dtex, 'dtex');
    if (dtex < MIN_CUSTOM_DTEX || dtex > MAX_CUSTOM_DTEX) {
      throw invalidParams(
        `dtex must be between ${MIN_CUSTOM_DTEX} and ${MAX_CUSTOM_DTEX}.`,
        ['dtex'],
      );
    }
    return {
      basis: 'dtex',
      dtex,
      threadsPerStrand: requireThreadCount(body.threadsPerStrand),
    };
  }

  throw invalidParams('basis must be "catalog" or "dtex".', ['basis']);
}

/**
 * Разбирает и валидирует тело обратного подбора.
 *
 * `threadIds` отсутствует — проверяются все активные нити. Пустой массив или
 * массив без валидных значений — ошибка: молча подставлять весь каталог нельзя.
 * Дубли схлопываются с сохранением первого вхождения.
 */
export function parseReverseInput(raw: unknown): ReverseInput {
  const body = asRecord(raw);

  const targetDiameterMm = requireFiniteNumber(body.targetDiameterMm, 'targetDiameterMm');
  if (targetDiameterMm <= 0) {
    throw invalidParams('targetDiameterMm must be greater than zero.', ['targetDiameterMm']);
  }

  if (body.threadIds === undefined) {
    return { targetDiameterMm };
  }

  if (!Array.isArray(body.threadIds)) {
    throw invalidParams('threadIds must be an array of thread ids.', ['threadIds']);
  }

  const ids = body.threadIds.map((value, index) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidParams(`threadIds[${index}] must be a non-empty string.`, ['threadIds']);
    }
    return value.trim();
  });

  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    throw invalidParams('threadIds must contain at least one thread id.', ['threadIds']);
  }

  return { targetDiameterMm, threadIds: unique };
}
