/**
 * Формат версионированного документа профиля (data/rigging).
 *
 * Документ — данные, а не код: коэффициенты, состав ролей, материалы,
 * источники и предупреждения. Ядро лишь интерпретирует документ. Формат
 * фиксируется JSON Schema (data/rigging/schema/profile-document.schema.json)
 * и проверяется лёгкими guard-функциями ниже.
 */

import {
    SCHEMA_VERSION,
    type CalibrationStatus,
    type CoefficientBasis,
    type Material,
    type MastId,
    type MeasurementPointId,
    type NodeType,
    type ReasonCode,
    type ResultGroup,
    type SailClass,
    type Tier,
} from './types.ts';

export type ProfilePublicationStatus = 'draft' | 'published' | 'deprecated';

export interface ProfileSource {
    id: string;
    title: string;
    locator: string;
}

/** Множители размерных баз профиля: d = q × (bases[kind] × измерение). */
export interface ProfileBases {
    mast: number;
    bowsprit: number;
    hullWidth: number;
    gunBore: number;
    thickestMast: number;
}

/** Короткие обозначения баз в формуле и трассировке. */
export interface ProfileBaseLabels {
    mast: string;
    bowsprit: string;
    hullWidth: string;
    gunBore: string;
    thickestMast: string;
}

export interface ProfileDefaults {
    scaleDenominator?: number;
    mastDiameterMm?: Partial<Record<MastId, number>>;
    bowspritDiameterMm?: number;
    hullWidthMm?: number;
    gunBoreMm?: number;
    anchor?: boolean;
    gaff?: boolean;
    spritsaill?: boolean;
}

/**
 * Какие блоки формы показывать для профиля. UI — подсказка, а не правило
 * расчёта: ядро всё равно вычисляет только правила документа.
 */
export interface ProfileUi {
    masts: boolean;
    tiers: Tier[];
    yards: boolean;
    squareSails: boolean;
    foreAndAft: SailClass[];
    lateenYard: boolean;
    gaff: boolean;
    gaffSail: boolean;
    boom: boolean;
    mainSail: boolean;
    topsail: boolean;
    headSails: boolean;
    staysail: boolean;
    flag: boolean;
    bowsprit: boolean;
    spritsaill: boolean;
    jibboom: boolean;
    martingale: boolean;
    anchor: boolean;
    hullGroup: boolean;
    gun: boolean;
    mastPoint: MeasurementPointId;
    bowspritPoint: MeasurementPointId;
    defaults?: ProfileDefaults;
}

export type BaseKind =
    | 'mast'
    | 'bowsprit'
    | 'hullWidth'
    | 'gunBore'
    | 'thickestMast'
    | 'rule';

export interface RuleBase {
    kind: BaseKind;
    /** Для kind=rule: ruleId родительской роли того же профиля. */
    ruleId?: string;
    /** Для kind=rule: тип узла родителя, если он отличается от узла правила. */
    nodeType?: NodeType;
    /** Для kind=rule: ярус родителя. */
    tier?: Tier | null;
    /** Для kind=mast: какая мачта задаёт базу. */
    scope?: 'own' | 'fore' | 'thickest' | 'supporting';
}

export interface RuleSelect {
    nodeType: NodeType;
    tier?: Tier | null;
    sailClass?: SailClass | null;
    /** Экземпляр на каждую мачту; информативно для аудита документа. */
    perMast?: boolean;
}

export interface RuleRequires {
    present?: boolean;
    sailPresent?: boolean;
    supportedGunMounting?: boolean;
}

export interface UnsupportedCondition {
    field: 'anchorConnection' | 'gunType' | 'mountingType' | 'material';
    equals: string;
    reason: ReasonCode;
}

export interface ProfileRule {
    ruleId: string;
    role: string;
    ropeId?: string;
    name: { en: string; ru: string };
    group: ResultGroup;
    select: RuleSelect;
    requires?: RuleRequires;
    base: RuleBase;
    /** Множитель базы. null — правило известно, но коэффициента нет. */
    factor: number | null;
    /** Точная подпись коэффициента (например, "3/28") для UI и трассировки. */
    factorLabel?: string;
    materials: Material[];
    /** Материал прототипа по умолчанию для результата (не ось выбора). */
    material?: Material;
    /** Геометрическая независимость материала для двух нижних стоячих ролей. */
    materialInvariance?: boolean;
    coefficientBasis: CoefficientBasis;
    calibrationStatus: CalibrationStatus;
    sources: string[];
    warnings?: string[];
    unsupportedWhen?: UnsupportedCondition[];
    alternativeGroupId?: string;
    variant?: 'compound' | 'simple';
    /** Переопределение основания по мачте (историческое происхождение строки). */
    perMastOverrides?: Partial<
        Record<MastId, { coefficientBasis?: CoefficientBasis; calibrationStatus?: CalibrationStatus }>
    >;
}

export interface ProfileMetrics {
    fittedRoles: number | null;
    mapePercent: number | null;
    maxDeviationPercent: number | null;
    crossTransferMapePercent: number | null;
    crossTransferMaxPercent: number | null;
    note: string;
    /** Короткая строка для карточки профиля; полное пояснение — в note. */
    cardNote?: string | null;
}

export interface ProfileInfo {
    profileId: string;
    profileVersion: string;
    schemaVersion: string;
    family: string;
    status: ProfilePublicationStatus;
    name: string;
    yearFrom: number | null;
    yearTo: number | null;
    bases: ProfileBases;
    baseLabels: ProfileBaseLabels;
    /** Точные подписи множителей баз, например "3/25" вместо 0,12. */
    baseFactorLabels?: Partial<Record<keyof ProfileBases, string>>;
    materialConditions: Material[];
    sources: ProfileSource[];
    warnings: string[];
    metrics?: ProfileMetrics | null;
    ui: ProfileUi;
}

export interface ProfileDocument {
    documentVersion: string;
    profile: ProfileInfo;
    rules: ProfileRule[];
}

export interface ProfileManifestVersion {
    version: string;
    status: ProfilePublicationStatus;
    document: string;
    sha256: string;
}

export interface ProfileManifestEntry {
    profileId: string;
    family: string;
    name: string;
    status: ProfilePublicationStatus;
    latest: string;
    versions: ProfileManifestVersion[];
}

export interface ProfileManifest {
    manifestVersion: string;
    schemaVersion: string;
    generatedAt: string;
    profiles: ProfileManifestEntry[];
}

const SUPPORTED_SCHEMA = new Set([SCHEMA_VERSION]);

/** Лёгкая проверка документа: без ajv и внешних зависимостей. */
export function validateProfileDocument(value: unknown): string[] {
    const issues: string[] = [];
    const document = value as Partial<ProfileDocument> | null;

    if (!document || typeof document !== 'object') {
        return ['Profile document must be a JSON object.'];
    }
    if (typeof document.documentVersion !== 'string' || document.documentVersion === '') {
        issues.push('documentVersion is required.');
    }

    const profile = document.profile as Partial<ProfileInfo> | undefined;
    if (!profile || typeof profile !== 'object') {
        issues.push('profile is required.');
        return issues;
    }

    for (const key of ['profileId', 'profileVersion', 'family', 'name'] as const) {
        if (typeof profile[key] !== 'string' || profile[key] === '') {
            issues.push(`profile.${key} is required.`);
        }
    }
    if (!SUPPORTED_SCHEMA.has(profile.schemaVersion as string)) {
        issues.push(`Unsupported schemaVersion: ${String(profile.schemaVersion)}.`);
    }
    if (!['draft', 'published', 'deprecated'].includes(profile.status as string)) {
        issues.push('profile.status must be draft, published or deprecated.');
    }

    const bases = profile.bases as Partial<ProfileBases> | undefined;
    if (!bases || typeof bases !== 'object') {
        issues.push('profile.bases is required.');
    } else {
        for (const key of ['mast', 'bowsprit', 'hullWidth', 'gunBore', 'thickestMast'] as const) {
            const value = bases[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                issues.push(`profile.bases.${key} must be a finite positive number.`);
            }
        }
    }

    const sources = profile.sources as ProfileSource[] | undefined;
    if (!Array.isArray(sources)) {
        issues.push('profile.sources must be an array.');
    }
    const sourceIds = new Set((sources ?? []).map((source) => source.id));
    for (const sourceId of sourceIds) {
        if (typeof sourceId !== 'string' || sourceId === '') {
            issues.push('Every profile source needs a non-empty id.');
        }
    }

    const rules = document.rules as ProfileRule[] | undefined;
    if (!Array.isArray(rules) || rules.length === 0) {
        issues.push('rules must be a non-empty array.');
        return issues;
    }

    const seen = new Set<string>();
    for (const rule of rules) {
        const label = rule?.ruleId ?? '(missing ruleId)';
        if (typeof rule.ruleId !== 'string' || rule.ruleId === '') {
            issues.push('Every rule needs a non-empty ruleId.');
            continue;
        }
        if (seen.has(rule.ruleId)) issues.push(`Duplicate ruleId: ${rule.ruleId}.`);
        seen.add(rule.ruleId);

        if (!rule.select || typeof rule.select.nodeType !== 'string') {
            issues.push(`Rule ${label} needs select.nodeType.`);
        }
        if (!rule.name || typeof rule.name.en !== 'string' || typeof rule.name.ru !== 'string') {
            issues.push(`Rule ${label} needs name.en and name.ru.`);
        }
        if (!Array.isArray(rule.materials) || rule.materials.length === 0) {
            issues.push(`Rule ${label} needs at least one material.`);
        }
        if (rule.factor !== null && !(typeof rule.factor === 'number' && Number.isFinite(rule.factor) && rule.factor > 0)) {
            issues.push(`Rule ${label} factor must be a positive number or null.`);
        }
        for (const sourceId of rule.sources ?? []) {
            if (!sourceIds.has(sourceId)) {
                issues.push(`Rule ${label} references unknown source ${sourceId}.`);
            }
        }
    }

    for (const rule of rules) {
        if (rule?.base?.kind !== 'rule') continue;
        if (!rule.base.ruleId || !seen.has(rule.base.ruleId)) {
            issues.push(`Rule ${rule.ruleId} references unknown base rule ${String(rule.base.ruleId)}.`);
        }
        if (rule.base.ruleId === rule.ruleId) {
            issues.push(`Rule ${rule.ruleId} cannot use itself as a base.`);
        }
    }

    return issues;
}

/** Проверяет, поддерживает ли ядро версию схемы документа. */
export function isSupportedDocument(document: ProfileDocument): boolean {
    return SUPPORTED_SCHEMA.has(document.profile.schemaVersion);
}
