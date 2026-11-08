/**
 * Чистое расчётное ядро.
 *
 * Ядро интерпретирует версионированный документ профиля: правила, базы,
 * коэффициенты, материалы и источники приходят из JSON. В коде нет ни одного
 * коэффициента профиля. Вычисления идут в миллиметрах прототипа; диаметр
 * модели получается делением на знаменатель масштаба ровно один раз.
 * Промежуточные значения не округляются — округление задача представления.
 */

import {
    MATERIAL_INVARIANCE_NOTE,
    MEASUREMENT_IDS,
    MEASUREMENT_LABELS,
    MAST_LABELS,
    POINT_PROXY_WARNING,
} from './profile.ts';
import {
    validateProfileDocument,
    type ProfileDocument,
    type ProfileRule,
    type RuleBase,
} from './document.ts';
import {
    ALGORITHM_VERSION,
    MAST_IDS,
    SCHEMA_VERSION,
    type Calculation,
    type CalculationSource,
    type CoefficientBasis,
    type MastId,
    type Material,
    type Measurement,
    type MeasurementId,
    type MeasurementPointId,
    type NodeType,
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

const KNOWN_NODE_TYPES = new Set<NodeType>([
    'lower_mast',
    'topmast',
    'topgallant',
    'yard',
    'fore_and_aft_sail',
    'gaff',
    'gaff_sail',
    'boom',
    'main_sail',
    'topsail',
    'head_lower',
    'head_upper',
    'staysail',
    'flag',
    'lateen_yard',
    'bowsprit',
    'jibboom',
    'flying_jibboom',
    'martingale',
    'spritsail_yard',
    'hull_group',
    'anchor_group',
    'gun_group',
]);

const MASTS_REQUIRING_SUPPORT = new Set<NodeType>([
    'fore_and_aft_sail',
    'gaff',
    'gaff_sail',
    'boom',
    'main_sail',
    'topsail',
    'head_lower',
    'head_upper',
    'staysail',
    'flag',
    'lateen_yard',
]);

const TIER_BY_NODE_TYPE: Partial<Record<NodeType, Tier>> = {
    lower_mast: 'lower',
    topmast: 'topmast',
    topgallant: 'topgallant',
};

const SUPPORTED_GUN_MOUNTINGS: ReadonlyArray<{
    gunType: string;
    mountingType: string;
}> = [
    { gunType: 'carriage_gun', mountingType: 'wheeled' },
    { gunType: 'carronade', mountingType: 'slide_pivot' },
];

type BaseRef =
    | {
          kind: 'measurement';
          measurementId: MeasurementId;
          label: string;
          multiplier: number;
          multiplierLabel: string;
      }
    | { kind: 'rule'; label: string };

interface ResolvedRule {
    status: RiggingResult['status'];
    reasonCode?: ReasonCode;
    missingInputIds: MeasurementId[];
    diameterPrototypeMm: number | null;
    diameterModelMm: number | null;
    measurementPointId: MeasurementPointId | null;
    formula: string | null;
    trace: string[];
    warnings: string[];
}

interface RuleSpec {
    key: string;
    node: RiggingNode;
    rule: ProfileRule;
    base: BaseRef;
    coefficientBasis: CoefficientBasis;
    calibrationStatus: 'not_calibrated' | 'training_set_only';
    material: Material;
    factorLabel: string;
    sortIndex: number;
}

const EMPTY_RESOLVED: ResolvedRule = {
    status: 'unsupported',
    reasonCode: 'dependency_unavailable',
    missingInputIds: [],
    diameterPrototypeMm: null,
    diameterModelMm: null,
    measurementPointId: null,
    formula: null,
    trace: [],
    warnings: [],
};

function resultKey(nodeId: string, ruleId: string): string {
    return `${nodeId}::${ruleId}`;
}

function fixed(value: number, digits = 3): string {
    return String(Number(value.toFixed(digits)));
}

function validPositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function mastIdOfNode(node: RiggingNode): MastId | null {
    if (node.ownerType === 'mast' && (MAST_IDS as readonly string[]).includes(node.ownerId)) {
        return node.ownerId as MastId;
    }
    if (node.supportingMastId) return node.supportingMastId;
    return null;
}

function tierOfNode(node: RiggingNode): Tier | undefined {
    return node.tier ?? TIER_BY_NODE_TYPE[node.nodeType];
}

function factorLabelOf(rule: ProfileRule): string {
    if (rule.factor === null) return '—';
    return rule.factorLabel ?? fixed(rule.factor, 4);
}

function isSupportedGunMounting(
    gunType: string | undefined,
    mountingType: string | undefined,
): boolean {
    if (!gunType || !mountingType) return false;
    return SUPPORTED_GUN_MOUNTINGS.some(
        (entry) => entry.gunType === gunType && entry.mountingType === mountingType,
    );
}

function measurementActive(input: RiggingInput, measurementId: MeasurementId): boolean {
    if (measurementId.startsWith('mast.')) {
        const mastId = measurementId.split('.')[1] as MastId;
        const lower = input.nodes.find(
            (node) => node.nodeType === 'lower_mast' && node.ownerId === mastId,
        );
        return lower ? lower.present !== false : false;
    }
    if (measurementId === 'bowsprit.diameter') {
        const node = input.nodes.find((entry) => entry.nodeType === 'bowsprit');
        return node ? node.present !== false : false;
    }
    if (measurementId === 'hull.width') {
        const node = input.nodes.find((entry) => entry.nodeType === 'anchor_group');
        return node ? node.present !== false : false;
    }
    if (measurementId === 'gun.bore') {
        const node = input.nodes.find((entry) => entry.nodeType === 'gun_group');
        return node ? node.present !== false : false;
    }
    return false;
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

function validate(input: RiggingInput, document: ProfileDocument): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!validPositive(input.scaleDenominator)) {
        issues.push({
            code: 'INVALID_SCALE',
            field: 'scaleDenominator',
            message: 'Model scale must be a finite number greater than zero (1:S, S > 0).',
        });
    }

    if (typeof input.profileId !== 'string' || input.profileId === '') {
        issues.push({
            code: 'PROFILE_REQUIRED',
            field: 'profileId',
            message: 'An explicit profileId is required; the profile is never substituted silently.',
        });
    } else if (input.profileId !== document.profile.profileId) {
        issues.push({
            code: 'PROFILE_MISMATCH',
            field: 'profileId',
            message: `Input profileId ${input.profileId} does not match the supplied document ${document.profile.profileId}.`,
        });
    }

    if (input.profileVersion && input.profileVersion !== document.profile.profileVersion) {
        issues.push({
            code: 'PROFILE_VERSION_MISMATCH',
            field: 'profileVersion',
            message: `Requested profile version ${input.profileVersion} is not ${document.profile.profileVersion}.`,
        });
    }

    for (const documentIssue of validateProfileDocument(document)) {
        issues.push({
            code: 'PROFILE_CONTRACT_VIOLATION',
            field: 'profileDocument',
            message: documentIssue,
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
            MASTS_REQUIRING_SUPPORT.has(node.nodeType) &&
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

function reasonText(reasonCode: ReasonCode | undefined): string {
    switch (reasonCode) {
        case 'node_absent':
            return 'The node is marked absent in the configuration.';
        case 'sail_not_configured':
            return 'The sail is not configured for this yard or spar.';
        case 'rule_not_supported':
            return 'No supported coefficient is defined for this role.';
        case 'material_not_supported':
            return 'The requested material or element is outside this estimation profile.';
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

/** Какие узлы попадают под правило. Порядок — порядок узлов во входе. */
function selectNodes(nodes: RiggingNode[], rule: ProfileRule): RiggingNode[] {
    return nodes.filter((node) => {
        if (node.nodeType !== rule.select.nodeType) return false;
        if (
            rule.select.tier !== undefined &&
            rule.select.tier !== null &&
            node.tier !== rule.select.tier
        ) {
            return false;
        }
        if (
            rule.select.sailClass !== undefined &&
            rule.select.sailClass !== null &&
            node.sailClass !== rule.select.sailClass
        ) {
            return false;
        }
        return true;
    });
}

function thickestMastId(
    nodes: RiggingNode[],
    normalized: Map<MeasurementId, NormalizedMeasurement>,
): MastId | null {
    let best: { mastId: MastId; modelMm: number } | null = null;
    for (const mastId of MAST_IDS) {
        const lower = nodes.find(
            (node) => node.nodeType === 'lower_mast' && node.ownerId === mastId,
        );
        if (!lower || lower.present === false) continue;
        const measurement = normalized.get(MEASUREMENT_IDS.mast(mastId));
        if (!measurement) continue;
        if (!best || measurement.modelMm > best.modelMm) {
            best = { mastId, modelMm: measurement.modelMm };
        }
    }
    return best?.mastId ?? null;
}

function mastForScope(
    base: RuleBase,
    node: RiggingNode,
    nodes: RiggingNode[],
    normalized: Map<MeasurementId, NormalizedMeasurement>,
): MastId | null {
    const scope = base.scope ?? 'own';
    if (scope === 'fore') return 'fore';
    if (scope === 'thickest') return thickestMastId(nodes, normalized);
    if (scope === 'supporting') return node.supportingMastId ?? null;
    return mastIdOfNode(node);
}

function baseForRule(
    rule: ProfileRule,
    node: RiggingNode,
    document: ProfileDocument,
    nodes: RiggingNode[],
    normalized: Map<MeasurementId, NormalizedMeasurement>,
): BaseRef {
    const base = rule.base;
    const labels = document.profile.baseLabels;
    const factorLabels = document.profile.baseFactorLabels ?? {};

    if (base.kind === 'rule') {
        return { kind: 'rule', label: base.ruleId ?? '' };
    }

    const measurementBase = (
        kind: 'mast' | 'thickestMast' | 'bowsprit' | 'hullWidth' | 'gunBore',
    ): BaseRef => {
        const multiplier = document.profile.bases[kind];
        const multiplierLabel = factorLabels[kind] ?? fixed(multiplier, 4);

        if (kind === 'mast' || kind === 'thickestMast') {
            const mastId = mastForScope(base, node, nodes, normalized) ?? 'main';
            const label =
                kind === 'thickestMast'
                    ? `${labels.thickestMast} (${MAST_LABELS[mastId].en})`
                    : `${labels.mast} (${MAST_LABELS[mastId].en})`;
            return {
                kind: 'measurement',
                measurementId: MEASUREMENT_IDS.mast(mastId),
                label,
                multiplier,
                multiplierLabel,
            };
        }
        if (kind === 'bowsprit') {
            return {
                kind: 'measurement',
                measurementId: MEASUREMENT_IDS.bowsprit,
                label: labels.bowsprit,
                multiplier,
                multiplierLabel,
            };
        }
        if (kind === 'hullWidth') {
            return {
                kind: 'measurement',
                measurementId: MEASUREMENT_IDS.hullWidth,
                label: labels.hullWidth,
                multiplier,
                multiplierLabel,
            };
        }
        return {
            kind: 'measurement',
            measurementId: MEASUREMENT_IDS.gunBore,
            label: labels.gunBore,
            multiplier,
            multiplierLabel,
        };
    };

    return measurementBase(base.kind as 'mast' | 'thickestMast' | 'bowsprit' | 'hullWidth' | 'gunBore');
}

function buildSpecs(
    input: RiggingInput,
    document: ProfileDocument,
    normalized: Map<MeasurementId, NormalizedMeasurement>,
): RuleSpec[] {
    const specs: RuleSpec[] = [];
    let sortIndex = 0;

    for (const rule of document.rules) {
        for (const node of selectNodes(input.nodes, rule)) {
            const mastId = mastIdOfNode(node);
            const override = mastId ? rule.perMastOverrides?.[mastId] : undefined;
            const base = baseForRule(rule, node, document, input.nodes, normalized);

            specs.push({
                key: resultKey(node.nodeId, rule.ruleId),
                node,
                rule,
                base,
                coefficientBasis: override?.coefficientBasis ?? rule.coefficientBasis,
                calibrationStatus: override?.calibrationStatus ?? rule.calibrationStatus,
                material: rule.material ?? rule.materials[0] ?? 'unknown',
                factorLabel: factorLabelOf(rule),
                sortIndex: sortIndex++,
            });
        }
    }

    return specs;
}

function measurementTrace(measurement: NormalizedMeasurement): string {
    return `${MEASUREMENT_LABELS[measurement.measurementId] ?? measurement.measurementId} = ${fixed(measurement.rawValue)} ${measurement.unitId} (${measurement.basis}) → ${fixed(measurement.realMm)} mm prototype`;
}

function findParentSpec(
    specs: RuleSpec[],
    child: RuleSpec,
    base: RuleBase,
): RuleSpec | undefined {
    const childMast = mastIdOfNode(child.node);
    return specs.find((candidate) => {
        if (candidate.rule.ruleId !== base.ruleId) return false;
        if (base.nodeType && candidate.node.nodeType !== base.nodeType) return false;
        if (base.tier && candidate.node.tier !== base.tier) return false;
        if (!base.nodeType && candidate.node.nodeId !== child.node.nodeId) return false;
        return mastIdOfNode(candidate.node) === childMast;
    });
}

function resolveSpecs(
    specs: RuleSpec[],
    normalized: Map<MeasurementId, NormalizedMeasurement>,
    scaleDenominator: number,
): Map<string, ResolvedRule> {
    const resolved = new Map<string, ResolvedRule>();
    const visiting = new Set<string>();

    const resolve = (spec: RuleSpec): ResolvedRule => {
        const cached = resolved.get(spec.key);
        if (cached) return cached;

        if (visiting.has(spec.key)) {
            const cycle: ResolvedRule = {
                ...EMPTY_RESOLVED,
                trace: [`Rule graph cycle at ${spec.rule.ruleId}.`],
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

        const rule = spec.rule;

        if (spec.node.present === false) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'not_applicable',
                reasonCode: 'node_absent',
                trace: [reasonText('node_absent')],
            });
        }

        for (const condition of rule.unsupportedWhen ?? []) {
            const actual = (spec.node as unknown as Record<string, unknown>)[condition.field];
            if (actual === condition.equals) {
                return finish({
                    ...EMPTY_RESOLVED,
                    status: 'unsupported',
                    reasonCode: condition.reason,
                    trace: [reasonText(condition.reason)],
                    warnings: [reasonText(condition.reason)],
                });
            }
        }

        if (
            rule.requires?.supportedGunMounting &&
            !isSupportedGunMounting(spec.node.gunType, spec.node.mountingType)
        ) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'unsupported',
                reasonCode: 'installation_not_supported',
                trace: [reasonText('installation_not_supported')],
                warnings: [reasonText('installation_not_supported')],
            });
        }

        if (rule.requires?.sailPresent && spec.node.sailPresent === false) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'not_applicable',
                reasonCode: 'sail_not_configured',
                trace: [reasonText('sail_not_configured')],
            });
        }

        if (rule.factor === null) {
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
                trace: [reasonText('configuration_required')],
                warnings: [reasonText('configuration_required')],
            });
        }

        if (rule.requires?.sailPresent && spec.node.sailPresent === null) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'needs_input',
                reasonCode: 'configuration_required',
                trace: [reasonText('configuration_required')],
                warnings: [reasonText('configuration_required')],
            });
        }

        if (spec.base.kind === 'rule') {
            const parentSpec = findParentSpec(specs, spec, rule.base);
            if (!parentSpec) {
                return finish({
                    ...EMPTY_RESOLVED,
                    status: 'unsupported',
                    reasonCode: 'dependency_unavailable',
                    trace: [`Missing dependency: ${rule.base.ruleId}.`],
                    warnings: ['A required parent role is missing from the profile.'],
                });
            }

            const parentResult = resolve(parentSpec);
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
                        `Dependency ${parentSpec.rule.name.en} is ${parentResult.status}.`,
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
                    trace: [`Dependency ${parentSpec.rule.name.en} has no diameter.`],
                });
            }

            const prototypeMm = referencePrototypeMm * rule.factor;
            const modelMm = prototypeMm / scaleDenominator;

            return finish({
                status: 'calculated',
                missingInputIds: [],
                diameterPrototypeMm: prototypeMm,
                diameterModelMm: modelMm,
                measurementPointId: parentResult.measurementPointId,
                formula: `${spec.factorLabel} × ${fixed(referenceModelMm)} = ${fixed(modelMm)} mm`,
                trace: [
                    `${parentSpec.rule.name.en} = ${fixed(referenceModelMm)} mm model`,
                    `${spec.factorLabel} × ${fixed(referenceModelMm)} = ${fixed(modelMm)} mm model`,
                    `d_model = ${fixed(prototypeMm)} / ${fixed(scaleDenominator)} = ${fixed(modelMm)} mm`,
                ],
                warnings: [...(rule.warnings ?? []), ...parentResult.warnings],
            });
        }

        const measurement = normalized.get(spec.base.measurementId);
        if (!measurement) {
            return finish({
                ...EMPTY_RESOLVED,
                status: 'needs_input',
                reasonCode: 'measurement_required',
                missingInputIds: [spec.base.measurementId],
                trace: [
                    `Missing required dimension: ${MEASUREMENT_LABELS[spec.base.measurementId] ?? spec.base.measurementId}.`,
                ],
            });
        }

        const factor = rule.factor;
        const baseMm = measurement.modelMm * spec.base.multiplier;
        const prototypeMm = measurement.realMm * spec.base.multiplier * factor;
        const modelMm = prototypeMm / scaleDenominator;

        const baseFormulaText =
            spec.base.multiplier === 1
                ? `${spec.base.label} = ${fixed(baseMm)} mm`
                : `${spec.base.label} = ${spec.base.multiplierLabel} × ${fixed(measurement.modelMm)} = ${fixed(baseMm)} mm`;

        const formula =
            factor === 1
                ? baseFormulaText
                : `${spec.factorLabel} × ${fixed(baseMm)} = ${fixed(modelMm)} mm`;

        const proxyWarnings: string[] = [];
        if (measurement.measurementPointId === 'step') {
            proxyWarnings.push(POINT_PROXY_WARNING);
        }

        return finish({
            status: 'calculated',
            missingInputIds: [],
            diameterPrototypeMm: prototypeMm,
            diameterModelMm: modelMm,
            measurementPointId: measurement.measurementPointId,
            formula,
            trace: [
                measurementTrace(measurement),
                spec.base.multiplier === 1
                    ? `${spec.base.label} = ${fixed(baseMm)} mm model`
                    : `${spec.base.label} = ${spec.base.multiplierLabel} × ${fixed(measurement.modelMm)} = ${fixed(baseMm)} mm model`,
                ...(factor === 1
                    ? [`d_model = ${fixed(prototypeMm)} / ${fixed(scaleDenominator)} = ${fixed(modelMm)} mm`]
                    : [
                          `${spec.factorLabel} × ${fixed(baseMm)} = ${fixed(modelMm)} mm model`,
                          `d_model = ${fixed(prototypeMm)} / ${fixed(scaleDenominator)} = ${fixed(modelMm)} mm`,
                      ]),
            ],
            warnings: [
                ...(rule.warnings ?? []),
                ...proxyWarnings,
                ...(rule.materialInvariance ? [MATERIAL_INVARIANCE_NOTE] : []),
            ],
        });
    };

    for (const spec of specs) {
        resolve(spec);
    }

    return resolved;
}

function sourcesOf(
    document: ProfileDocument,
    rule: ProfileRule,
): { sourceIds: string[]; sourceLocator: string | null } {
    const ids = rule.sources ?? [];
    const locators = ids
        .map((sourceId) => document.profile.sources.find((source) => source.id === sourceId))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .map((source) => `${source.id}: ${source.locator}`);
    return {
        sourceIds: [...ids],
        sourceLocator: locators.length > 0 ? locators.join(' · ') : null,
    };
}

/**
 * Расчёт по явно переданному документу профиля.
 *
 * @param input входные размеры и узлы
 * @param document версионированный документ профиля (уже разрешённый по id)
 */
export function calculate(input: RiggingInput, document: ProfileDocument): Calculation {
    if (!document || typeof document !== 'object' || !document.profile) {
        return {
            profileId: input.profileId ?? '',
            profileVersion: input.profileVersion ?? '',
            profileStatus: 'unknown',
            schemaVersion: SCHEMA_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            scaleDenominator: input.scaleDenominator,
            normalizedMeasurements: [],
            results: [],
            sources: [],
            warnings: [],
            validationErrors: [
                {
                    code: 'PROFILE_DOCUMENT_MISSING',
                    field: 'profileDocument',
                    message: 'A profile document is required to calculate diameters.',
                },
            ],
        };
    }

    const validationErrors = validate(input, document);

    if (validationErrors.length > 0) {
        return {
            profileId: document.profile.profileId,
            profileVersion: document.profile.profileVersion,
            profileStatus: document.profile.status,
            schemaVersion: document.profile.schemaVersion,
            algorithmVersion: ALGORITHM_VERSION,
            scaleDenominator: input.scaleDenominator,
            normalizedMeasurements: [],
            results: [],
            sources: document.profile.sources.map((source) => ({ ...source })),
            warnings: [...document.profile.warnings],
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

    const specs = buildSpecs(input, document, normalized);
    const resolved = resolveSpecs(specs, normalized, input.scaleDenominator);

    const results: RiggingResult[] = specs.map((spec) => {
        const value = resolved.get(spec.key) ?? EMPTY_RESOLVED;
        const rule = spec.rule;
        const sources = sourcesOf(document, rule);
        const parentRule = rule.base.kind === 'rule'
            ? document.rules.find((entry) => entry.ruleId === rule.base.ruleId)
            : undefined;

        return {
            ownerType: spec.node.ownerType,
            ownerId: spec.node.ownerId,
            nodeId: spec.node.nodeId,
            ruleId: rule.ruleId,
            ropeId: rule.ropeId ?? rule.ruleId,
            role: rule.role,
            segmentType: 'rope',
            nameEn: rule.name.en,
            nameRu: rule.name.ru,
            group: rule.group,
            tier: tierOfNode(spec.node),
            status: value.status,
            reasonCode: value.reasonCode,
            missingInputIds: unique(value.missingInputIds),
            diameterPrototypeMm: value.diameterPrototypeMm,
            diameterModelMm: value.diameterModelMm,
            method: 'proportional',
            calculationKind: 'estimate',
            material: spec.material,
            coefficientBasis: spec.coefficientBasis,
            calibrationStatus: spec.calibrationStatus,
            profileId: document.profile.profileId,
            profileVersion: document.profile.profileVersion,
            schemaVersion: document.profile.schemaVersion,
            sourceIds: sources.sourceIds,
            sourceLocator: sources.sourceLocator,
            measurementPointId: value.measurementPointId,
            formula: value.formula,
            referenceLabel:
                spec.base.kind === 'rule'
                    ? `${parentRule?.name.en ?? rule.base.ruleId} diameter`
                    : spec.base.label,
            factorLabel: spec.factorLabel,
            trace: value.trace,
            warnings: unique([
                ...(rule.warnings ?? []),
                ...value.warnings,
                ...(value.status === 'calculated' ? [] : [reasonText(value.reasonCode)]),
            ]).filter(Boolean),
            alternativeGroupId: rule.alternativeGroupId,
            variant: rule.variant,
            sortIndex: spec.sortIndex,
        };
    });

    const sources: CalculationSource[] = document.profile.sources.map((source) => ({
        ...source,
    }));

    return {
        profileId: document.profile.profileId,
        profileVersion: document.profile.profileVersion,
        profileStatus: document.profile.status,
        schemaVersion: document.profile.schemaVersion,
        algorithmVersion: ALGORITHM_VERSION,
        scaleDenominator: input.scaleDenominator,
        normalizedMeasurements: [...normalized.values()],
        results,
        sources,
        warnings: [...document.profile.warnings],
        validationErrors: [],
    };
}
