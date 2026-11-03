/**
 * Чистое расчётное ядро traditional_plant v1.0.0.
 *
 * Вычисления идут в миллиметрах прототипа. Диаметр модели получается делением
 * на знаменатель масштаба ровно один раз. Промежуточные значения не
 * округляются; округление — задача представления.
 */

import {
    ANCHOR_ROLE_DEFS,
    ANCHOR_WARNING,
    BASE_FACTORS,
    BASE_FACTOR_LABELS,
    BOW_ROLE_DEFS,
    BOWSPRIT_WARNING,
    FORE_AND_AFT_FACTORS,
    FORE_AND_AFT_ROLE_DEFS,
    GAFF_ROLE_DEFS,
    GUN_ROLE_DEFS,
    GUN_WARNING,
    GROUP_LABELS,
    MAST_LABELS,
    MAST_IDS,
    MEASUREMENT_IDS,
    MEASUREMENT_LABELS,
    PRELIMINARY_FIT_WARNING,
    PROFILE_WARNINGS,
    SPRITSAIL_ROLE_DEFS,
    SPRITSAIL_UNSUPPORTED_ROLES,
    SQUARE_ROLE_DEFS,
    STANDING_ROLE_NAMES,
    TIERS,
    isSupportedGunMounting,
} from './profile.ts';
import {
    ALGORITHM_VERSION,
    PROFILE_ID,
    PROFILE_VERSION,
    SCHEMA_VERSION,
    type Calculation,
    type CoefficientBasis,
    type Measurement,
    type MeasurementId,
    type MastId,
    type NormalizedMeasurement,
    type ReasonCode,
    type RiggingInput,
    type RiggingNode,
    type RiggingResult,
    type Tier,
    type UnitId,
    type ValidationIssue,
} from './types.ts';

const UNIT_TO_MM: Record<UnitId, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
};

const KNOWN_NODE_TYPES = new Set<RiggingNode['nodeType']>([
    'lower_mast',
    'topmast',
    'topgallant',
    'yard',
    'fore_and_aft_sail',
    'gaff',
    'bowsprit',
    'jibboom',
    'flying_jibboom',
    'martingale',
    'spritsail_yard',
    'anchor_group',
    'gun_group',
]);

type BaseRef =
    | { kind: 'mast'; mastId: MastId; label: string }
    | { kind: 'bowsprit'; label: string }
    | { kind: 'hullWidth'; label: string }
    | { kind: 'gunBore'; label: string }
    | { kind: 'result'; key: string; label: string };

interface RuleSpec {
    key: string;
    node: RiggingNode;
    ruleId: string;
    ropeId: string;
    role: string;
    segmentType: 'rope';
    nameEn: string;
    nameRu: string;
    group: RiggingResult['group'];
    tier?: Tier;
    factor: number | null;
    factorLabel: string;
    base: BaseRef;
    coefficientBasis: CoefficientBasis;
    calibrationStatus: 'not_calibrated' | 'training_set_only';
    alternativeGroupId?: string;
    variant?: 'compound' | 'simple';
    sailRole?: boolean;
    unsupportedReason?: ReasonCode;
    notes: string[];
    sortIndex: number;
    referenceLabel: string;
}

interface ResolvedRule {
    status: RiggingResult['status'];
    reasonCode?: ReasonCode;
    missingInputIds: MeasurementId[];
    diameterPrototypeMm: number | null;
    diameterModelMm: number | null;
    formula: string | null;
    trace: string[];
    warnings: string[];
}

const EMPTY_RESOLVED: ResolvedRule = {
    status: 'unsupported',
    reasonCode: 'dependency_unavailable',
    missingInputIds: [],
    diameterPrototypeMm: null,
    diameterModelMm: null,
    formula: null,
    trace: [],
    warnings: [],
};

function resultKey(nodeId: string, ruleId: string): string {
    return `${nodeId}::${ruleId}`;
}

function fixed(value: number, digits = 3): string {
    const rounded = Number(value.toFixed(digits));
    return String(rounded);
}

function validPositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function measurementActive(input: RiggingInput, measurementId: MeasurementId): boolean {
    const nodes = input.nodes;

    if (measurementId.startsWith('mast.')) {
        const mastId = measurementId.split('.')[1] as MastId;
        const lower = nodes.find(
            (node) => node.nodeType === 'lower_mast' && node.ownerId === mastId,
        );
        return lower ? lower.present !== false : false;
    }
    if (measurementId === 'bowsprit.diameter') {
        const node = nodes.find((entry) => entry.nodeType === 'bowsprit');
        return node ? node.present !== false : false;
    }
    if (measurementId === 'hull.width') {
        const node = nodes.find((entry) => entry.nodeType === 'anchor_group');
        return node ? node.present !== false : false;
    }
    if (measurementId === 'gun.bore') {
        const node = nodes.find((entry) => entry.nodeType === 'gun_group');
        return node ? node.present !== false : false;
    }
    return false;
}

function validate(input: RiggingInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!validPositive(input.scaleDenominator)) {
        issues.push({
            code: 'INVALID_SCALE',
            field: 'scaleDenominator',
            message: 'Model scale must be a finite number greater than zero (1:S, S > 0).',
        });
    }

    if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
        issues.push({
            code: 'NO_NODES',
            field: 'nodes',
            message: 'Add at least one rigging node to calculate diameters.',
        });
    }

    const seen = new Set<string>();
    for (const node of input.nodes) {
        if (seen.has(node.nodeId)) {
            issues.push({
                code: 'DUPLICATE_NODE',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}`,
                message: `Duplicate nodeId: ${node.nodeId}.`,
            });
        }
        seen.add(node.nodeId);

        if (!KNOWN_NODE_TYPES.has(node.nodeType)) {
            issues.push({
                code: 'UNKNOWN_NODE_TYPE',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}`,
                message: `Unsupported node type: ${node.nodeType}.`,
            });
        }

        if (node.sailPresent === true && node.present === false) {
            issues.push({
                code: 'SAIL_WITHOUT_NODE',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}.sailPresent`,
                message: 'A sail cannot be present when its supporting node is absent.',
            });
        }
    }

    const byId = new Map(input.nodes.map((node) => [node.nodeId, node]));

    for (const node of input.nodes) {
        if (!node.parentNodeId) continue;

        const parent = byId.get(node.parentNodeId);
        if (!parent) {
            issues.push({
                code: 'PARENT_MISSING',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}.parentNodeId`,
                message: `Parent node ${node.parentNodeId} is not in the configuration.`,
            });
            continue;
        }
        if (node.present === true && parent.present === false) {
            issues.push({
                code: 'PARENT_ABSENT',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}.parentNodeId`,
                message: `Node ${node.nodeId} is present while its parent ${parent.nodeId} is absent.`,
            });
        }

        let cursor: RiggingNode | undefined = parent;
        const chain = new Set<string>([node.nodeId]);
        while (cursor) {
            if (chain.has(cursor.nodeId)) {
                issues.push({
                    code: 'NODE_CYCLE',
                    nodeId: node.nodeId,
                    field: `node.${node.nodeId}.parentNodeId`,
                    message: `Parent chain of ${node.nodeId} contains a cycle.`,
                });
                break;
            }
            chain.add(cursor.nodeId);
            cursor = cursor.parentNodeId ? byId.get(cursor.parentNodeId) : undefined;
        }
    }

    for (const node of input.nodes) {
        if (
            (node.nodeType === 'fore_and_aft_sail' || node.nodeType === 'gaff') &&
            node.present !== false &&
            !node.supportingMastId
        ) {
            issues.push({
                code: 'MISSING_SUPPORTING_MAST',
                nodeId: node.nodeId,
                field: `node.${node.nodeId}.supportingMastId`,
                message: `Node ${node.nodeId} needs a supporting mast.`,
            });
        }
    }

    for (const [measurementId, measurement] of allMeasurements(input)) {
        if (!measurement || measurement.value === null) continue;
        if (!validPositive(measurement.value) && measurementActive(input, measurementId)) {
            issues.push({
                code: 'INVALID_MEASUREMENT',
                field: measurementId,
                message: `${MEASUREMENT_LABELS[measurementId] ?? measurementId} must be a finite number greater than zero.`,
            });
        }
    }

    return issues;
}

function* allMeasurements(
    input: RiggingInput,
): Generator<[MeasurementId, Measurement | null | undefined]> {
    yield [MEASUREMENT_IDS.mast('fore'), input.measurements.mastDiameter.fore];
    yield [MEASUREMENT_IDS.mast('main'), input.measurements.mastDiameter.main];
    yield [MEASUREMENT_IDS.mast('mizzen'), input.measurements.mastDiameter.mizzen];
    yield [MEASUREMENT_IDS.bowsprit, input.measurements.bowspritDiameter];
    yield [MEASUREMENT_IDS.hullWidth, input.measurements.hullWidth];
    yield [MEASUREMENT_IDS.gunBore, input.measurements.gunBore];
}

function normalizeMeasurement(
    measurementId: MeasurementId,
    measurement: Measurement,
    scaleDenominator: number,
): NormalizedMeasurement {
    const value = measurement.value as number;
    const unitMm = UNIT_TO_MM[measurement.unitId];
    const realMm = value * unitMm * (measurement.basis === 'model' ? scaleDenominator : 1);
    return {
        measurementId,
        rawValue: value,
        unitId: measurement.unitId,
        basis: measurement.basis,
        measurementPointId: measurement.measurementPointId,
        realMm,
        modelMm: realMm / scaleDenominator,
    };
}

function baseMeasurementId(base: BaseRef): MeasurementId | null {
    if (base.kind === 'mast') return MEASUREMENT_IDS.mast(base.mastId);
    if (base.kind === 'bowsprit') return MEASUREMENT_IDS.bowsprit;
    if (base.kind === 'hullWidth') return MEASUREMENT_IDS.hullWidth;
    if (base.kind === 'gunBore') return MEASUREMENT_IDS.gunBore;
    return null;
}

function baseLabel(base: BaseRef): string {
    if (base.kind === 'mast') return `${base.label} (${MAST_LABELS[base.mastId].en})`;
    if (base.kind === 'bowsprit') return base.label;
    if (base.kind === 'hullWidth') return base.label;
    if (base.kind === 'gunBore') return base.label;
    return base.label;
}

function baseFormula(
    base: BaseRef,
    measurement: NormalizedMeasurement | null,
): string | null {
    if (!measurement) return null;

    if (base.kind === 'mast') {
        return `B_m = ${BASE_FACTOR_LABELS.mast} × D_m = ${fixed(measurement.modelMm * BASE_FACTORS.mast)} mm`;
    }
    if (base.kind === 'bowsprit') {
        return `N = ${BASE_FACTOR_LABELS.bowsprit} × D_b = ${fixed(measurement.modelMm * BASE_FACTORS.bowsprit)} mm`;
    }
    if (base.kind === 'hullWidth') {
        return `A = ${BASE_FACTOR_LABELS.anchor} × W = ${fixed(measurement.modelMm * BASE_FACTORS.anchor)} mm`;
    }
    if (base.kind === 'gunBore') {
        return `K = ${fixed(measurement.modelMm)} mm`;
    }
    return null;
}

function baseModelMm(
    base: BaseRef,
    measurement: NormalizedMeasurement | null,
): number | null {
    if (!measurement) return null;
    if (base.kind === 'mast') return measurement.modelMm * BASE_FACTORS.mast;
    if (base.kind === 'bowsprit') return measurement.modelMm * BASE_FACTORS.bowsprit;
    if (base.kind === 'hullWidth') return measurement.modelMm * BASE_FACTORS.anchor;
    if (base.kind === 'gunBore') return measurement.modelMm;
    return null;
}

function measurementTrace(measurement: NormalizedMeasurement): string {
    const unit = measurement.unitId;
    const basis = measurement.basis;
    return `${MEASUREMENT_LABELS[measurement.measurementId] ?? measurement.measurementId} = ${fixed(measurement.rawValue)} ${unit} (${basis}) → ${fixed(measurement.realMm)} mm prototype`;
}

function reasonText(reasonCode: ReasonCode | undefined): string {
    switch (reasonCode) {
        case 'node_absent':
            return 'The node is marked absent in the configuration.';
        case 'sail_not_configured':
            return 'The sail is not configured for this yard or spar.';
        case 'rule_not_supported':
            return 'No supported coefficient is defined for this role.';
        case 'material_not_supported':
            return 'The requested chain or metal element is outside this estimation profile.';
        case 'installation_not_supported':
            return 'This gun and mounting combination is not supported by the profile.';
        case 'configuration_required':
            return 'The rigging configuration is not fully specified.';
        case 'measurement_required':
            return 'A required dimension is missing.';
        case 'dependency_unavailable':
            return 'A required parent role could not be calculated.';
        default:
            return 'The row could not be calculated.';
    }
}

function factorLabel(factor: number): string {
    return fixed(factor, 4);
}

function makeSpec(
    params: Omit<RuleSpec, 'key' | 'sortIndex' | 'factorLabel' | 'referenceLabel'> & {
        key?: string;
        sortIndex?: number;
        factorLabel?: string;
        referenceLabel?: string;
    },
    sortIndex: number,
): RuleSpec {
    return {
        ...params,
        key: params.key ?? resultKey(params.node.nodeId, params.ruleId),
        factorLabel: params.factorLabel ?? (params.factor === null ? '—' : factorLabel(params.factor)),
        referenceLabel: params.referenceLabel ?? baseLabel(params.base),
        sortIndex,
    };
}

function findMastNode(
    nodes: RiggingNode[],
    mastId: MastId,
    nodeType: 'lower_mast' | 'topmast' | 'topgallant',
): RiggingNode | undefined {
    return nodes.find((node) => node.nodeType === nodeType && node.ownerId === mastId);
}

function findYardNode(nodes: RiggingNode[], mastId: MastId, tier: Tier): RiggingNode | undefined {
    return nodes.find(
        (node) => node.nodeType === 'yard' && node.ownerId === mastId && node.tier === tier,
    );
}

function buildMastSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;

    const addStanding = (
        node: RiggingNode | undefined,
        tier: Tier,
        role: string,
        factor: number,
        base: BaseRef,
        preliminary: boolean,
    ): void => {
        if (!node) return;
        const names = STANDING_ROLE_NAMES[role] ?? { en: role, ru: role };

        specs.push(
            makeSpec(
                {
                    node,
                    ruleId: role,
                    ropeId: role,
                    role,
                    segmentType: 'rope',
                    nameEn: names.en,
                    nameRu: names.ru,
                    group: 'standing',
                    tier,
                    factor,
                    base,
                    coefficientBasis: preliminary ? 'preliminary_fit' : 'engineering_assumption',
                    calibrationStatus: preliminary ? 'training_set_only' : 'not_calibrated',
                    notes: preliminary ? [PRELIMINARY_FIT_WARNING] : [],
                },
                sortIndex++,
            ),
        );
    };

    for (const mastId of MAST_IDS) {
        const lower = findMastNode(input.nodes, mastId, 'lower_mast');
        const topmast = findMastNode(input.nodes, mastId, 'topmast');
        const topgallant = findMastNode(input.nodes, mastId, 'topgallant');

        const mastBase: BaseRef = {
            kind: 'mast',
            mastId,
            label: 'B_m',
        };

        const preliminary =
            mastId === 'fore' || mastId === 'main';

        if (lower) {
            const stayKey = resultKey(lower.nodeId, 'st.lower.stay');
            const shroudKey = resultKey(lower.nodeId, 'st.lower.shroud');
            const backstayKey = resultKey(lower.nodeId, 'st.lower.backstay');
            const preventerKey = resultKey(lower.nodeId, 'st.lower.preventer');

            addStanding(lower, 'lower', 'st.lower.stay', 1, mastBase, preliminary);
            addStanding(
                lower,
                'lower',
                'st.lower.shroud',
                0.55,
                { kind: 'result', key: stayKey, label: 'lower stay' },
                preliminary,
            );
            addStanding(lower, 'lower', 'st.lower.backstay', 0.5, mastBase, false);
            addStanding(
                lower,
                'lower',
                'st.lower.preventer',
                0.7,
                { kind: 'result', key: stayKey, label: 'lower stay' },
                false,
            );
            addStanding(
                lower,
                'lower',
                'st.lower.shroud_lanyard',
                0.5,
                { kind: 'result', key: shroudKey, label: 'lower shrouds' },
                false,
            );
            addStanding(
                lower,
                'lower',
                'st.lower.backstay_lanyard',
                0.5,
                { kind: 'result', key: backstayKey, label: 'lower backstays' },
                false,
            );
            addStanding(
                lower,
                'lower',
                'st.lower.stay_lanyard',
                0.35,
                { kind: 'result', key: stayKey, label: 'lower stay' },
                false,
            );
            addStanding(
                lower,
                'lower',
                'st.lower.preventer_lanyard',
                0.35,
                { kind: 'result', key: preventerKey, label: 'lower preventer stay' },
                false,
            );
            addStanding(
                lower,
                'lower',
                'st.lower.ratline',
                0.34,
                { kind: 'result', key: shroudKey, label: 'lower shrouds' },
                false,
            );
        }

        if (topmast) {
            const stayKey = resultKey(topmast.nodeId, 'st.topmast.stay');
            const shroudKey = resultKey(topmast.nodeId, 'st.topmast.shroud');
            const backstayKey = resultKey(topmast.nodeId, 'st.topmast.backstay');
            const preventerKey = resultKey(topmast.nodeId, 'st.topmast.preventer');

            addStanding(topmast, 'topmast', 'st.topmast.stay', 0.6, mastBase, false);
            addStanding(topmast, 'topmast', 'st.topmast.shroud', 0.33, mastBase, false);
            addStanding(topmast, 'topmast', 'st.topmast.backstay', 0.4, mastBase, false);
            addStanding(
                topmast,
                'topmast',
                'st.topmast.preventer',
                0.7,
                { kind: 'result', key: stayKey, label: 'topmast stay' },
                false,
            );
            addStanding(
                topmast,
                'topmast',
                'st.topmast.shroud_lanyard',
                0.5,
                { kind: 'result', key: shroudKey, label: 'topmast shrouds' },
                false,
            );
            addStanding(
                topmast,
                'topmast',
                'st.topmast.backstay_lanyard',
                0.5,
                { kind: 'result', key: backstayKey, label: 'topmast backstays' },
                false,
            );
            addStanding(
                topmast,
                'topmast',
                'st.topmast.stay_lanyard',
                0.35,
                { kind: 'result', key: stayKey, label: 'topmast stay' },
                false,
            );
            addStanding(
                topmast,
                'topmast',
                'st.topmast.preventer_lanyard',
                0.35,
                { kind: 'result', key: preventerKey, label: 'topmast preventer stay' },
                false,
            );
            addStanding(
                topmast,
                'topmast',
                'st.topmast.ratline',
                0.34,
                { kind: 'result', key: shroudKey, label: 'topmast shrouds' },
                false,
            );
            if (lower) {
                addStanding(
                    topmast,
                    'topmast',
                    'st.futtock.lower',
                    0.7,
                    {
                        kind: 'result',
                        key: resultKey(lower.nodeId, 'st.lower.shroud'),
                        label: 'lower shrouds',
                    },
                    false,
                );
            }
        }

        if (topgallant) {
            const stayKey = resultKey(topgallant.nodeId, 'st.topgallant.stay');
            const shroudKey = resultKey(topgallant.nodeId, 'st.topgallant.shroud');
            const backstayKey = resultKey(topgallant.nodeId, 'st.topgallant.backstay');

            addStanding(topgallant, 'topgallant', 'st.topgallant.stay', 0.35, mastBase, false);
            addStanding(topgallant, 'topgallant', 'st.topgallant.shroud', 0.2, mastBase, false);
            addStanding(topgallant, 'topgallant', 'st.topgallant.backstay', 0.25, mastBase, false);
            addStanding(
                topgallant,
                'topgallant',
                'st.topgallant.shroud_lanyard',
                0.5,
                { kind: 'result', key: shroudKey, label: 'topgallant shrouds' },
                false,
            );
            addStanding(
                topgallant,
                'topgallant',
                'st.topgallant.backstay_lanyard',
                0.5,
                { kind: 'result', key: backstayKey, label: 'topgallant backstays' },
                false,
            );
            addStanding(
                topgallant,
                'topgallant',
                'st.topgallant.stay_lanyard',
                0.35,
                { kind: 'result', key: stayKey, label: 'topgallant stay' },
                false,
            );
            addStanding(
                topgallant,
                'topgallant',
                'st.topgallant.ratline',
                0.34,
                { kind: 'result', key: shroudKey, label: 'topgallant shrouds' },
                false,
            );
            if (topmast) {
                addStanding(
                    topgallant,
                    'topgallant',
                    'st.futtock.upper',
                    0.7,
                    {
                        kind: 'result',
                        key: resultKey(topmast.nodeId, 'st.topmast.shroud'),
                        label: 'topmast shrouds',
                    },
                    false,
                );
            }
        }
    }
}

function buildSquareSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;

    for (const mastId of MAST_IDS) {
        for (const tier of TIERS) {
            const yard = findYardNode(input.nodes, mastId, tier);
            if (!yard) continue;

            const mastBase: BaseRef = { kind: 'mast', mastId, label: 'B_m' };

            for (const roleDef of SQUARE_ROLE_DEFS) {
                const factor = roleDef.factors[tier];
                specs.push(
                    makeSpec(
                        {
                            node: yard,
                            ruleId: `rn.square.${tier}.${roleDef.role}`,
                            ropeId: `rn.square.${tier}.${roleDef.role}`,
                            role: roleDef.role,
                            segmentType: 'rope',
                            nameEn: roleDef.nameEn,
                            nameRu: roleDef.nameRu,
                            group: 'running',
                            tier,
                            factor,
                            base: mastBase,
                            coefficientBasis: 'engineering_assumption',
                            calibrationStatus: 'not_calibrated',
                            alternativeGroupId: roleDef.alternativeGroupId,
                            variant: roleDef.variant,
                            sailRole: roleDef.sailRole,
                            unsupportedReason: factor === null ? 'rule_not_supported' : undefined,
                            notes: [],
                        },
                        sortIndex++,
                    ),
                );
            }
        }
    }
}

function buildForeAndAftSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;

    for (const node of input.nodes) {
        if (node.nodeType !== 'fore_and_aft_sail') continue;
        const sailClass = node.sailClass;
        if (!sailClass) continue;
        const mastId = node.supportingMastId;
        if (!mastId) continue;

        const mastBase: BaseRef = { kind: 'mast', mastId, label: 'B_m' };

        for (const roleDef of FORE_AND_AFT_ROLE_DEFS) {
            const factor = FORE_AND_AFT_FACTORS[sailClass][roleDef.role];
            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `rn.foreandaft.${sailClass}.${roleDef.role}`,
                        ropeId: `rn.foreandaft.${sailClass}.${roleDef.role}`,
                        role: roleDef.role,
                        segmentType: 'rope',
                        nameEn: roleDef.nameEn,
                        nameRu: roleDef.nameRu,
                        group: 'running',
                        factor,
                        base: mastBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        notes: [],
                    },
                    sortIndex++,
                ),
            );
        }
    }
}

function buildGaffSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;

    for (const node of input.nodes) {
        if (node.nodeType !== 'gaff') continue;
        const mastId = node.supportingMastId;
        if (!mastId) continue;

        const mastBase: BaseRef = { kind: 'mast', mastId, label: 'B_m' };

        for (const roleDef of GAFF_ROLE_DEFS) {
            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `rn.gaff.${roleDef.role}`,
                        ropeId: `rn.gaff.${roleDef.role}`,
                        role: roleDef.role,
                        segmentType: 'rope',
                        nameEn: roleDef.nameEn,
                        nameRu: roleDef.nameRu,
                        group: 'running',
                        factor: roleDef.factor,
                        base: mastBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        sailRole: roleDef.sailRole,
                        notes: [],
                    },
                    sortIndex++,
                ),
            );
        }
    }
}

function buildBowspritSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;
    const bowBase: BaseRef = { kind: 'bowsprit', label: 'N' };

    const nodeTypes: Array<'bowsprit' | 'jibboom' | 'flying_jibboom' | 'martingale'> = [
        'bowsprit',
        'jibboom',
        'flying_jibboom',
        'martingale',
    ];

    for (const nodeType of nodeTypes) {
        for (const node of input.nodes) {
            if (node.nodeType !== nodeType) continue;

            for (const def of BOW_ROLE_DEFS[nodeType]) {
                const parentKey = resultKey(node.nodeId, `bow.${def.role}`);
                specs.push(
                    makeSpec(
                        {
                            node,
                            ruleId: `bow.${def.role}`,
                            ropeId: `bow.${def.role}`,
                            role: def.role,
                            segmentType: 'rope',
                            nameEn: def.nameEn,
                            nameRu: def.nameRu,
                            group: 'bowsprit',
                            factor: def.factor,
                            base: bowBase,
                            coefficientBasis: 'engineering_assumption',
                            calibrationStatus: 'not_calibrated',
                            notes: [BOWSPRIT_WARNING],
                        },
                        sortIndex++,
                    ),
                );

                if (def.lanyard) {
                    specs.push(
                        makeSpec(
                            {
                                node,
                                ruleId: `bow.${def.role}.lanyard`,
                                ropeId: `bow.${def.role}.lanyard`,
                                role: `${def.role}_lanyard`,
                                segmentType: 'rope',
                                nameEn: `${def.nameEn} lanyard`,
                                nameRu: `Ланьяр: ${def.nameRu.toLowerCase()}`,
                                group: 'bowsprit',
                                factor: 0.35,
                                base: {
                                    kind: 'result',
                                    key: parentKey,
                                    label: `${def.nameEn.toLowerCase()} diameter`,
                                },
                                coefficientBasis: 'engineering_assumption',
                                calibrationStatus: 'not_calibrated',
                                notes: [BOWSPRIT_WARNING],
                            },
                            sortIndex++,
                        ),
                    );
                }
            }
        }
    }
}

function buildSpritsailSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;
    const bowBase: BaseRef = { kind: 'bowsprit', label: 'N' };

    for (const node of input.nodes) {
        if (node.nodeType !== 'spritsail_yard') continue;

        for (const roleDef of SPRITSAIL_ROLE_DEFS) {
            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `rn.spritsail.${roleDef.role}`,
                        ropeId: `rn.spritsail.${roleDef.role}`,
                        role: roleDef.role,
                        segmentType: 'rope',
                        nameEn: roleDef.nameEn,
                        nameRu: roleDef.nameRu,
                        group: 'bowsprit',
                        factor: roleDef.factor,
                        base: bowBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        sailRole: roleDef.sailRole,
                        notes: [BOWSPRIT_WARNING],
                    },
                    sortIndex++,
                ),
            );
        }

        const unsupportedNames: Record<string, { en: string; ru: string }> = {
            tack: { en: 'Spritsail tack', ru: 'Галс блинда-паруса' },
            bowline: { en: 'Spritsail bowline', ru: 'Булинь блинда-паруса' },
            reef_fall: { en: 'Spritsail reef fall', ru: 'Риф-тали блинда-паруса' },
        };

        for (const role of SPRITSAIL_UNSUPPORTED_ROLES) {
            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `rn.spritsail.${role}`,
                        ropeId: `rn.spritsail.${role}`,
                        role,
                        segmentType: 'rope',
                        nameEn: unsupportedNames[role].en,
                        nameRu: unsupportedNames[role].ru,
                        group: 'bowsprit',
                        factor: null,
                        base: bowBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        sailRole: true,
                        unsupportedReason: 'rule_not_supported',
                        notes: [BOWSPRIT_WARNING],
                    },
                    sortIndex++,
                ),
            );
        }
    }
}

function buildAnchorSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;
    const anchorBase: BaseRef = { kind: 'hullWidth', label: 'A' };

    for (const node of input.nodes) {
        if (node.nodeType !== 'anchor_group') continue;

        for (const roleDef of ANCHOR_ROLE_DEFS) {
            const chainCable =
                node.anchorConnection === 'chain' &&
                (roleDef.role === 'bower_cable' || roleDef.role === 'kedge_cable');

            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `anchor.${roleDef.role}`,
                        ropeId: `anchor.${roleDef.role}`,
                        role: roleDef.role,
                        segmentType: 'rope',
                        nameEn: roleDef.nameEn,
                        nameRu: roleDef.nameRu,
                        group: 'anchor',
                        factor: roleDef.factor,
                        base: anchorBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        unsupportedReason: chainCable ? 'material_not_supported' : undefined,
                        notes: [ANCHOR_WARNING],
                    },
                    sortIndex++,
                ),
            );
        }
    }
}

function buildGunSpecs(specs: RuleSpec[], input: RiggingInput): void {
    let sortIndex = specs.length;
    const gunBase: BaseRef = { kind: 'gunBore', label: 'K' };

    for (const node of input.nodes) {
        if (node.nodeType !== 'gun_group') continue;

        const supported = isSupportedGunMounting(node.gunType, node.mountingType);

        for (const roleDef of GUN_ROLE_DEFS) {
            specs.push(
                makeSpec(
                    {
                        node,
                        ruleId: `gun.${roleDef.role}`,
                        ropeId: `gun.${roleDef.role}`,
                        role: roleDef.role,
                        segmentType: 'rope',
                        nameEn: roleDef.nameEn,
                        nameRu: roleDef.nameRu,
                        group: 'gun',
                        factor: roleDef.factor,
                        base: gunBase,
                        coefficientBasis: 'engineering_assumption',
                        calibrationStatus: 'not_calibrated',
                        unsupportedReason: supported ? undefined : 'installation_not_supported',
                        notes: [GUN_WARNING],
                    },
                    sortIndex++,
                ),
            );
        }
    }
}

function buildSpecs(input: RiggingInput): RuleSpec[] {
    const specs: RuleSpec[] = [];
    buildMastSpecs(specs, input);
    buildSquareSpecs(specs, input);
    buildForeAndAftSpecs(specs, input);
    buildGaffSpecs(specs, input);
    buildBowspritSpecs(specs, input);
    buildSpritsailSpecs(specs, input);
    buildAnchorSpecs(specs, input);
    buildGunSpecs(specs, input);
    return specs;
}

function resolveSpecs(
    specs: RuleSpec[],
    normalized: Map<MeasurementId, NormalizedMeasurement>,
    scaleDenominator: number,
): Map<string, ResolvedRule> {
    const specMap = new Map(specs.map((spec) => [spec.key, spec]));
    const resolved = new Map<string, ResolvedRule>();
    const visiting = new Set<string>();

    const resolve = (spec: RuleSpec): ResolvedRule => {
        const cached = resolved.get(spec.key);
        if (cached) return cached;

        if (visiting.has(spec.key)) {
            const cycle: ResolvedRule = {
                status: 'unsupported',
                reasonCode: 'dependency_unavailable',
                missingInputIds: [],
                diameterPrototypeMm: null,
                diameterModelMm: null,
                formula: null,
                trace: [`Rule graph cycle at ${spec.ruleId}.`],
                warnings: ['The profile rule graph contains a cycle; this row is not calculated.'],
            };
            resolved.set(spec.key, cycle);
            return cycle;
        }
        visiting.add(spec.key);

        const finish = (value: ResolvedRule): ResolvedRule => {
            visiting.delete(spec.key);
            resolved.set(spec.key, value);
            return value;
        };

        if (spec.node.present === false) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'not_applicable',
                reasonCode: 'node_absent',
                trace: [reasonText('node_absent')],
            });
        }

        if (spec.sailRole && spec.node.sailPresent === false) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'not_applicable',
                reasonCode: 'sail_not_configured',
                trace: [reasonText('sail_not_configured')],
            });
        }

        if (spec.unsupportedReason) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'unsupported',
                reasonCode: spec.unsupportedReason,
                trace: [reasonText(spec.unsupportedReason)],
                warnings: [reasonText(spec.unsupportedReason)],
            });
        }

        if (spec.factor === null) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'unsupported',
                reasonCode: 'rule_not_supported',
                trace: [reasonText('rule_not_supported')],
                warnings: [reasonText('rule_not_supported')],
            });
        }

        if (spec.node.present === null) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'needs_input',
                reasonCode: 'configuration_required',
                missingInputIds: [],
                trace: [reasonText('configuration_required')],
                warnings: [reasonText('configuration_required')],
            });
        }

        if (spec.sailRole && spec.node.sailPresent === null) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'needs_input',
                reasonCode: 'configuration_required',
                trace: [reasonText('configuration_required')],
                warnings: [reasonText('configuration_required')],
            });
        }

        if (spec.base.kind === 'result') {
            const parent = specMap.get(spec.base.key);
            if (!parent) {
                return finish({
                    ...EMPTY_RESOLVED,
                    status: 'unsupported',
                    reasonCode: 'dependency_unavailable',
                    trace: [`Missing dependency: ${spec.base.label}.`],
                    warnings: ['A required parent role is missing from the profile.'],
                });
            }

            const parentResult = resolve(parent);
            if (parentResult.status !== 'calculated') {
                return finish({
                    ...EMPTY_RESOLVED,
                    status:
                        parentResult.status === 'needs_input'
                            ? 'needs_input'
                            : parentResult.status === 'not_applicable'
                                ? 'not_applicable'
                                : 'unsupported',
                    reasonCode:
                        parentResult.status === 'needs_input'
                            ? parentResult.reasonCode ?? 'measurement_required'
                            : parentResult.status === 'not_applicable'
                                ? parentResult.reasonCode
                                : 'dependency_unavailable',
                    missingInputIds: [...parentResult.missingInputIds],
                    trace: [
                        `Dependency ${parent.nameEn} is ${parentResult.status}.`,
                        ...parentResult.trace,
                    ],
                    warnings:
                        parentResult.status === 'unsupported'
                            ? [reasonText('dependency_unavailable'), ...parentResult.warnings]
                            : [...parentResult.warnings],
                });
            }

            const referenceModelMm = parentResult.diameterModelMm;
            const referencePrototypeMm = parentResult.diameterPrototypeMm;

            if (referenceModelMm === null || referencePrototypeMm === null) {
                return finish({
                    ...EMPTY_RESOLVED,
                    status: 'needs_input',
                    reasonCode: 'dependency_unavailable',
                    trace: [`Dependency ${parent.nameEn} has no diameter.`],
                });
            }

            const prototypeMm = referencePrototypeMm * spec.factor;
            const modelMm = prototypeMm / scaleDenominator;

            return finish({
                status: 'calculated',
                missingInputIds: [],
                diameterPrototypeMm: prototypeMm,
                diameterModelMm: modelMm,
                formula: `${spec.factorLabel} × ${fixed(referenceModelMm)} = ${fixed(modelMm)} mm`,
                trace: [
                    `${parent.nameEn} = ${fixed(referenceModelMm)} mm model`,
                    `${spec.factorLabel} × ${fixed(referenceModelMm)} = ${fixed(modelMm)} mm model`,
                    `d_model = ${fixed(prototypeMm)} / ${fixed(scaleDenominator)} = ${fixed(modelMm)} mm`,
                ],
                warnings: [...spec.notes, ...parentResult.warnings],
            });
        }

        const measurementId = baseMeasurementId(spec.base);
        if (!measurementId) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'unsupported',
                reasonCode: 'dependency_unavailable',
                trace: ['No base reference is defined for this rule.'],
            });
        }

        const measurement = normalized.get(measurementId);
        if (!measurement) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'needs_input',
                reasonCode: 'measurement_required',
                missingInputIds: [measurementId],
                trace: [`Missing required dimension: ${MEASUREMENT_LABELS[measurementId] ?? measurementId}.`],
            });
        }

        const baseMm = baseModelMm(spec.base, measurement);
        if (baseMm === null) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'unsupported',
                reasonCode: 'dependency_unavailable',
                trace: ['The base reference has no value.'],
            });
        }

        const prototypeMm = measurement.realMm * baseFactorFor(spec.base) * spec.factor;
        const modelMm = prototypeMm / scaleDenominator;
        const baseFormulaText = baseFormula(spec.base, measurement);

        const formula =
            spec.factor === 1
                ? baseFormulaText
                : `${spec.factorLabel} × ${fixed(baseMm)} = ${fixed(modelMm)} mm`;

        return finish({
            status: 'calculated',
            missingInputIds: [],
            diameterPrototypeMm: prototypeMm,
            diameterModelMm: modelMm,
            formula,
            trace: [
                measurementTrace(measurement),
                baseFormulaText ?? 'Base value is defined by the profile.',
                `${spec.factorLabel} × ${fixed(baseMm)} = ${fixed(modelMm)} mm model`,
                `d_model = ${fixed(prototypeMm)} / ${fixed(scaleDenominator)} = ${fixed(modelMm)} mm`,
            ],
            warnings: [...spec.notes],
        });
    };

    for (const spec of specs) {
        resolve(spec);
    }

    return resolved;
}

function baseFactorFor(base: BaseRef): number {
    if (base.kind === 'mast') return BASE_FACTORS.mast;
    if (base.kind === 'bowsprit') return BASE_FACTORS.bowsprit;
    if (base.kind === 'hullWidth') return BASE_FACTORS.anchor;
    if (base.kind === 'gunBore') return 1;
    return 1;
}

function nodeStatusReason(result: ResolvedRule): string {
    return result.reasonCode ? reasonText(result.reasonCode) : '';
}

export function calculate(input: RiggingInput): Calculation {
    const validationErrors = validate(input);

    if (validationErrors.length > 0) {
        return {
            profileId: PROFILE_ID,
            profileVersion: PROFILE_VERSION,
            schemaVersion: SCHEMA_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            scaleDenominator: input.scaleDenominator,
            normalizedMeasurements: [],
            results: [],
            warnings: [...PROFILE_WARNINGS],
            validationErrors,
        };
    }

    const normalized = new Map<MeasurementId, NormalizedMeasurement>();
    for (const [measurementId, measurement] of allMeasurements(input)) {
        if (!measurement || measurement.value === null) continue;
        normalized.set(
            measurementId,
            normalizeMeasurement(measurementId, measurement, input.scaleDenominator),
        );
    }

    const specs = buildSpecs(input);
    const resolved = resolveSpecs(specs, normalized, input.scaleDenominator);

    const results: RiggingResult[] = specs.map((spec) => {
        const value = resolved.get(spec.key) ?? EMPTY_RESOLVED;

        return {
            ownerType: spec.node.ownerType,
            ownerId: spec.node.ownerId,
            nodeId: spec.node.nodeId,
            ruleId: spec.ruleId,
            ropeId: spec.ropeId,
            role: spec.role,
            segmentType: spec.segmentType,
            nameEn: spec.nameEn,
            nameRu: spec.nameRu,
            group: spec.group,
            tier: spec.tier,
            status: value.status,
            reasonCode: value.reasonCode,
            missingInputIds: unique(value.missingInputIds),
            diameterPrototypeMm: value.diameterPrototypeMm,
            diameterModelMm: value.diameterModelMm,
            method: 'proportional',
            calculationKind: 'estimate',
            coefficientBasis: spec.coefficientBasis,
            calibrationStatus: spec.calibrationStatus,
            profileId: PROFILE_ID,
            profileVersion: PROFILE_VERSION,
            schemaVersion: SCHEMA_VERSION,
            formula: value.formula,
            referenceLabel: spec.referenceLabel,
            factorLabel: spec.factorLabel,
            trace: value.trace,
            warnings: unique([
                ...spec.notes,
                ...value.warnings,
                ...(value.status === 'calculated' ? [] : [nodeStatusReason(value)]),
            ]).filter(Boolean),
            alternativeGroupId: spec.alternativeGroupId,
            variant: spec.variant,
            sortIndex: spec.sortIndex,
        };
    });

    return {
        profileId: PROFILE_ID,
        profileVersion: PROFILE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        scaleDenominator: input.scaleDenominator,
        normalizedMeasurements: [...normalized.values()],
        results,
        warnings: [...PROFILE_WARNINGS],
        validationErrors: [],
    };
}

/** Экспорт для UI: подпись группы без обращения к внутренним таблицам. */
export { GROUP_LABELS };
