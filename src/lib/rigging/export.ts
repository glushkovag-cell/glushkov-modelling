/**
 * Экспорт ведомости и проекта. Функции чистые, чтобы их можно было проверить
 * без DOM. CSV содержит все строки, включая неподдерживаемые и неприменимые:
 * это исследовательская ведомость, а не только список посчитанных чисел.
 */

import type { Calculation, RiggingResult } from './types.ts';
import type { RiggingSettings } from './settings.ts';

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
    'formula',
] as const;

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function resultValue(result: RiggingResult, column: (typeof CSV_COLUMNS)[number]): unknown {
    if (column === 'missingInputIds') return result.missingInputIds.join('|');
    if (column === 'diameterPrototypeMm' || column === 'diameterModelMm') {
        const value = result[column];
        return value === null ? '' : String(value);
    }
    return result[column];
}

export function toCsv(calculation: Calculation): string {
    const lines = [CSV_COLUMNS.join(',')];

    for (const result of calculation.results) {
        lines.push(
            CSV_COLUMNS.map((column) => csvCell(resultValue(result, column))).join(','),
        );
    }

    return `\uFEFF${lines.join('\r\n')}\r\n`;
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
    calculation: Calculation;
}

export function toProjectJson(
    calculation: Calculation,
    settings: RiggingSettings,
    exportedAt = new Date().toISOString(),
): string {
    const project: ProjectExport = {
        exportedAt,
        profile: {
            profileId: calculation.profileId,
            profileVersion: calculation.profileVersion,
            schemaVersion: calculation.schemaVersion,
            algorithmVersion: calculation.algorithmVersion,
        },
        settings,
        calculation,
    };

    return `${JSON.stringify(project, null, 2)}\n`;
}
