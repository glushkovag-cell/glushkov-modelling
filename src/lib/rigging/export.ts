/**
 * Экспорт ведомости и проекта. Функции чистые, чтобы их можно было проверить
 * без DOM. CSV содержит все строки, включая неподдерживаемые и неприменимые:
 * это исследовательская ведомость, а не только список посчитанных чисел.
 *
 * Формулы и пошаговая трассировка намеренно не экспортируются: CSV и JSON
 * содержат результат и провенанс, но не расчётные выражения.
 */

import type { Calculation, RiggingResult } from './types.ts';
import type { RiggingSettings } from './settings.ts';
import { ledgerRowKey } from './ledgerKey.ts';
import {
    threadPickLabel,
    type ThreadPick,
} from './threadPick.ts';

const CSV_COLUMNS = [
    'profileId',
    'profileVersion',
    'schemaVersion',
    'ownerType',
    'ownerId',
    'nodeId',
    'ropeId',
    'ruleId',
    'role',
    'group',
    'tier',
    'nameEn',
    'nameRu',
    'status',
    'reasonCode',
    'missingInputIds',
    'diameterPrototypeMm',
    'diameterModelMm',
    'coefficientBasis',
    'calibrationStatus',
    'material',
    'measurementPointId',
    'sourceIds',
    'sourceLocator',
    'thread_id',
    'thread_label',
    'thread_diameter_mm',
    'thread_target_mm',
] as const;

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function threadCsvValue(
    pick: ThreadPick | undefined,
    column: (typeof CSV_COLUMNS)[number],
): unknown {
    if (!pick) return '';
    if (column === 'thread_id') return pick.threadId;
    if (column === 'thread_label') return threadPickLabel(pick);
    if (column === 'thread_diameter_mm') return String(pick.diameterMm);
    if (column === 'thread_target_mm') return String(pick.targetMm);
    return '';
}

function resultValue(result: RiggingResult, column: (typeof CSV_COLUMNS)[number]): unknown {
    if (column === 'missingInputIds') return result.missingInputIds.join('|');
    if (column === 'sourceIds') return result.sourceIds.join('|');
    if (column === 'diameterPrototypeMm' || column === 'diameterModelMm') {
        const value = result[column];
        return value === null ? '' : String(value);
    }
    return result[column as keyof RiggingResult];
}

export function toCsv(
    calculation: Calculation,
    results: readonly RiggingResult[] = calculation.results,
    threadPicks?: ReadonlyMap<string, ThreadPick>,
): string {
    const lines = [CSV_COLUMNS.join(',')];

    for (const result of results) {
        const pick = threadPicks?.get(ledgerRowKey(result));
        lines.push(
            CSV_COLUMNS.map((column) =>
                csvCell(
                    column.startsWith('thread_')
                        ? threadCsvValue(pick, column)
                        : resultValue(result, column),
                ),
            ).join(','),
        );
    }

    return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export type ExportedResult = Omit<RiggingResult, 'formula' | 'trace'>;

export type ExportedCalculation = Omit<Calculation, 'results'> & {
    results: ExportedResult[];
};

export type ExportScope = 'all' | 'selection';

export interface ExportSelection {
    scope: ExportScope;
    rowCount: number;
    totalRowCount: number;
    conditions: string[];
}

export interface ExportedThreadPick {
    rowKey: string;
    thread_id: string;
    brand: string;
    number: string;
    dtex: number;
    threadsPerStrand: number;
    diameterMm: number;
    deviationPercent: number;
    targetMm: number;
    rowDiameterMm: number;
}

export interface ProjectExport {
    exportedAt: string;
    profile: {
        profileId: string;
        profileVersion: string;
        schemaVersion: string;
        algorithmVersion: string;
    };
    settings: RiggingSettings;
    calculation: ExportedCalculation;
    /** Выбранные нити; ключ строки + thread_id и параметры подбора. */
    threads?: ExportedThreadPick[];
    /** Присутствует только для экспорта текущей выборки. */
    selection?: ExportSelection;
}

export interface ExportOptions {
    results?: readonly RiggingResult[];
    scope?: ExportScope;
    conditions?: string[];
    threadPicks?: ReadonlyMap<string, ThreadPick>;
}

function withoutFormulas(result: RiggingResult): ExportedResult {
    const { formula, trace, ...rest } = result;
    void formula;
    void trace;
    return rest;
}

export function toProjectJson(
    calculation: Calculation,
    settings: RiggingSettings,
    exportedAt = new Date().toISOString(),
    options: ExportOptions = {},
): string {
    const { results, ...meta } = calculation;
    const exportedResults = options.results ?? results;
    const scope = options.scope ?? 'all';

    const project: ProjectExport = {
        exportedAt,
        profile: {
            profileId: calculation.profileId,
            profileVersion: calculation.profileVersion,
            schemaVersion: calculation.schemaVersion,
            algorithmVersion: calculation.algorithmVersion,
        },
        settings,
        calculation: {
            ...meta,
            results: exportedResults.map(withoutFormulas),
        },
    };

    if (options.threadPicks) {
        const threads: ExportedThreadPick[] = [];
        for (const result of exportedResults) {
            const pick = options.threadPicks.get(ledgerRowKey(result));
            if (!pick) continue;
            threads.push({
                rowKey: ledgerRowKey(result),
                thread_id: pick.threadId,
                brand: pick.brand,
                number: pick.number,
                dtex: pick.dtex,
                threadsPerStrand: pick.threadsPerStrand,
                diameterMm: pick.diameterMm,
                deviationPercent: pick.deviationPercent,
                targetMm: pick.targetMm,
                rowDiameterMm: pick.rowDiameterMm,
            });
        }
        if (threads.length > 0) project.threads = threads;
    }

    if (scope === 'selection') {
        project.selection = {
            scope,
            rowCount: exportedResults.length,
            totalRowCount: results.length,
            conditions: options.conditions ?? [],
        };
    }

    return `${JSON.stringify(project, null, 2)}\n`;
}
