/**
 * Клиентский контроллер калькулятора толщин такелажа.
 *
 * Читает форму, собирает компактную конфигурацию, отправляет её в Worker и
 * рисует ведомость. Формул и коэффициентов здесь нет: расчёт выполняет
 * https://rigging-api.glushkov-modelling.com по выбранному документу профиля.
 */

import {
    SAIL_NODE_KINDS,
    buildInput,
    sailNodeKindsForUi,
    type RiggingSettings,
    type SailNodeKind,
} from '../lib/rigging/settings.ts';
import { toCsv, toProjectJson } from '../lib/rigging/export.ts';
import { formatDiameter, formatMm } from '../lib/rigging/format.ts';
import { sailSelectable, tierAvailability } from '../lib/rigging/formRules.ts';
import { parsePreset } from '../lib/rigging/preset.ts';
import {
    PREFILL_FIELDS,
    PREFILL_FIELD_LABELS,
    mapModelMeasurements,
    measurementFromPrefill,
    parseModelScale,
    type MeasurementSource,
    type PrefillField,
} from '../lib/rigging/modelMeasurements.ts';
import {
    switchProfileSettings,
    type DimensionKey,
} from '../lib/rigging/profileSwitch.ts';
import type { ProfileRequirements } from '../lib/rigging/profiles.ts';
import {
    CALIBRATION_LABELS,
    GROUP_LABELS,
    MAST_IDS,
    MATERIAL_LABELS,
    MEASUREMENT_LABELS,
    MEASUREMENT_POINT_LABELS,
    ORIGIN_LABELS,
    ORIGIN_SHORT_LABELS,
    REASON_LABELS,
    SAIL_CLASSES,
    STATUS_LABELS,
    TIER_LABELS,
} from '../lib/rigging/profile.ts';
import type { ProfileUi } from '../lib/rigging/document.ts';
import {
    activeConditions,
    buildFacets,
    buildLedgerRows,
    groupedLedger,
    hasActiveConditions,
    highlightSegments,
    nodeLabel,
    selectLedgerRows,
    sortLedgerRows,
    type LedgerFacets,
    type LedgerMode,
    type LedgerNodeSection,
    type LedgerRow,
    type LedgerSelection,
    type LedgerSort,
    type LedgerType,
} from '../lib/rigging/ledgerView.ts';
import {
    clearFilters,
    initialLedgerState,
    reconcileState,
    setAllSections,
    setMode,
    setNode,
    setQuery,
    setSectionOpen,
    setExportScope,
    setShowNotApplicable,
    setSort,
    setStatus,
    setTier,
    setType,
    tierFilterDisabled,
    tierFilterNote,
    type ExportScope,
    type LedgerState,
} from '../lib/rigging/ledgerState.ts';
import {
    loadLedgerState,
    saveLedgerState,
} from '../lib/rigging/ledgerPersistence.ts';
import {
    makeThreadPick,
    threadPickDetails,
    threadPickLabel,
    threadPickNeedsReview,
    threadPickReviewNote,
    type ThreadMatch,
    type ThreadPick,
} from '../lib/rigging/threadPick.ts';
import type {
    AnchorConnection,
    Basis,
    Calculation,
    GunType,
    MastId,
    Measurement,
    MeasurementId,
    MeasurementPointId,
    MountingType,
    NormalizedMeasurement,
    ResultStatus,
    RiggingResult,
    SailClass,
    Tier,
    UnitId,
} from '../lib/rigging/types.ts';
import { DEFAULT_PROFILE_ID } from '../lib/rigging/types.ts';

const MAST_IDS_LIST = MAST_IDS as readonly MastId[];
const SAIL_CLASSES_LIST = SAIL_CLASSES as readonly SailClass[];
const SAIL_NODE_KINDS_LIST = SAIL_NODE_KINDS as readonly SailNodeKind[];

const DEFAULT_API_BASE = 'https://rigging-api.glushkov-modelling.com';

/**
 * База API. `?api=http://localhost:8787` удобно для локального wrangler dev;
 * в продакшене параметр не нужен.
 */
const API_BASE = (() => {
    const override = new URLSearchParams(window.location.search).get('api');
    return (override?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
})();

interface ProfileCardData {
    profileId: string;
    version: string;
    ui: ProfileUi;
    requirements: ProfileRequirements;
    defaults: RiggingSettings;
    name: string;
}

async function postCalculate(
    input: ReturnType<typeof buildInput>,
    signal: AbortSignal,
): Promise<Calculation> {
    const response = await fetch(`${API_BASE}/api/rigging/v1/calculate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal,
    });

    if (!response.ok) {
        let message = `Calculation service returned ${response.status}.`;
        try {
            const body = (await response.json()) as { error?: { message?: string } };
            if (body?.error?.message) message = body.error.message;
        } catch {
            // тело ошибки может быть не JSON — используем статус
        }
        throw new Error(message);
    }

    return (await response.json()) as Calculation;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Rigging calculator: missing #${id}`);
    }
    return element as T;
}

function input(id: string): HTMLInputElement {
    return byId<HTMLInputElement>(id);
}

function select(id: string): HTMLSelectElement {
    return byId<HTMLSelectElement>(id);
}

function checked(id: string): boolean {
    const element = document.getElementById(id) as HTMLInputElement | null;
    return element ? element.checked : false;
}

function readNumberOrNull(id: string): number | null {
    const raw = input(id).value.trim().replace(',', '.');
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
}

const UNIT_TO_MM: Record<UnitId, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
};

const DIM_PREFIXES = [
    'mast-fore',
    'mast-main',
    'mast-mizzen',
    'bowsprit',
    'hull-width',
    'gun-bore',
] as const;

type DimPrefix = (typeof DIM_PREFIXES)[number];

interface DimState {
    unit: UnitId;
    basis: Basis;
    value: number | null;
}

const dimState = new Map<DimPrefix, DimState>();

function roundTo2(value: number): number {
    return Math.round(value * 100) / 100;
}

function parseScale(): number {
    return Number(input('scale').value.trim().replace(',', '.'));
}

function parseValueInput(prefix: DimPrefix): number | null {
    const raw = input(`${prefix}-value`).value.trim().replace(',', '.');
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function readUnitBasis(prefix: DimPrefix): { unit: UnitId; basis: Basis } {
    return {
        unit: select(`${prefix}-unit`).value as UnitId,
        basis: select(`${prefix}-basis`).value as Basis,
    };
}

function initDimState(): void {
    dimState.clear();
    for (const prefix of DIM_PREFIXES) {
        dimState.set(prefix, { ...readUnitBasis(prefix), value: parseValueInput(prefix) });
    }
}

/**
 * При смене единиц или режима «model / full-size vessel» физический размер
 * сохраняется, а число пересчитывается с полной точностью.
 */
function onDimensionUnitOrBasisChange(prefix: DimPrefix): void {
    const previous = dimState.get(prefix);
    const next = readUnitBasis(prefix);

    if (!previous) {
        dimState.set(prefix, { ...next, value: parseValueInput(prefix) });
        return;
    }

    if (previous.unit === next.unit && previous.basis === next.basis) return;

    if (previous.value === null) {
        dimState.set(prefix, { ...next, value: null });
        return;
    }

    const scale = parseScale();
    if (!Number.isFinite(scale) || scale <= 0) {
        dimState.set(prefix, { ...next, value: previous.value });
        return;
    }

    const previousFactor = UNIT_TO_MM[previous.unit];
    const nextFactor = UNIT_TO_MM[next.unit];
    const physicalPrototypeMm =
        previous.value * previousFactor * (previous.basis === 'model' ? scale : 1);
    const nextValue = physicalPrototypeMm / (nextFactor * (next.basis === 'model' ? scale : 1));

    dimState.set(prefix, { ...next, value: nextValue });
    input(`${prefix}-value`).value = String(roundTo2(nextValue));
}

function readMeasurement(prefix: string, point: MeasurementPointId): Measurement {
    return {
        value: readNumberOrNull(`${prefix}-value`),
        unitId: select(`${prefix}-unit`).value as UnitId,
        basis: select(`${prefix}-basis`).value as Measurement['basis'],
        measurementPointId: point,
    };
}

const DIMENSION_KEYS: Record<DimPrefix, DimensionKey> = {
    'mast-fore': 'mast.fore',
    'mast-main': 'mast.main',
    'mast-mizzen': 'mast.mizzen',
    bowsprit: 'bowsprit',
    'hull-width': 'hullWidth',
    'gun-bore': 'gunBore',
};

function dimensionPoint(prefix: DimPrefix): MeasurementPointId {
    if (prefix.startsWith('mast-')) {
        return select(`${prefix}-point`).value as MeasurementPointId;
    }
    if (prefix === 'hull-width') return 'unknown';
    return 'working_section';
}

function readDimension(prefix: DimPrefix): Measurement {
    return readMeasurement(prefix, dimensionPoint(prefix));
}

/**
 * Сохраняет размеры, которые сейчас видны в форме, в черновик. Черновик
 * переживает переключение профиля и позволяет вернуть значение, даже если
 * новый профиль это поле временно скрывает.
 */
function captureDimensionDraft(profile: ProfileCardData | null): void {
    if (!profile) return;
    for (const prefix of DIM_PREFIXES) {
        const row = document.querySelector<HTMLElement>(`[data-dim="${prefix}"]`);
        if (!row || row.hidden) continue;
        state.dimensionDraft[DIMENSION_KEYS[prefix]] = readDimension(prefix);
    }
}

function dimensionActive(prefix: DimPrefix): boolean {
    if (prefix.startsWith('mast-')) {
        return checked(`mast-${prefix.slice('mast-'.length)}-present`);
    }
    if (prefix === 'bowsprit') return checked('bowsprit-present');
    if (prefix === 'hull-width') return checked('anchor-present');
    return checked('gun-present');
}

function dimensionUsed(prefix: DimPrefix, requirements: ProfileRequirements): boolean {
    if (prefix.startsWith('mast-')) return requirements.mast;
    if (prefix === 'bowsprit') return requirements.bowsprit;
    if (prefix === 'hull-width') return requirements.hullWidth;
    return requirements.gunBore;
}

function setDimensionRequired(prefix: DimPrefix, required: boolean): void {
    const row = document.querySelector<HTMLElement>(`[data-dim="${prefix}"]`);
    const valueInput = document.getElementById(`${prefix}-value`) as HTMLInputElement | null;
    if (!row || !valueInput) return;

    row.classList.toggle('is-required', required);
    if (required) {
        valueInput.setAttribute('aria-required', 'true');
    } else {
        valueInput.removeAttribute('aria-required');
    }

    const label = row.querySelector<HTMLElement>('.rig-label');
    const existing = label?.querySelector<HTMLElement>('.rig-dim__required');
    if (required && label && !existing) {
        const badge = document.createElement('span');
        badge.className = 'rig-dim__required';
        badge.textContent = 'Input required';
        label.appendChild(badge);
    } else if (!required) {
        existing?.remove();
    }
}

/**
 * Помечает видимые и активные размеры, которые профиль реально использует,
 * но значение которых пустое. Так новое поле после смены профиля явно
 * требует ввода, а не подставляет пример незаметно.
 */
function syncRequiredDimensions(): void {
    const profile = state.activeProfile;
    if (!profile) return;
    for (const prefix of DIM_PREFIXES) {
        const row = document.querySelector<HTMLElement>(`[data-dim="${prefix}"]`);
        const visible = Boolean(row && !row.hidden);
        const required =
            visible &&
            dimensionUsed(prefix, profile.requirements) &&
            dimensionActive(prefix) &&
            parseValueInput(prefix) === null;
        setDimensionRequired(prefix, required);
    }
}

function dimensionKeyForTarget(target: HTMLElement): DimensionKey | null {
    const match = target.id.match(
        /^(mast-fore|mast-main|mast-mizzen|bowsprit|hull-width|gun-bore)-(value|unit|basis|point)$/,
    );
    if (!match) return null;
    return DIMENSION_KEYS[match[1] as DimPrefix] ?? null;
}

function requiredDimensionRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.rig-dim.is-required')].filter(
        (row) => !row.hidden,
    );
}

function requiredDimensionLabels(): string[] {
    return requiredDimensionRows()
        .map(
            (row) =>
                row
                    .querySelector('.rig-label')
                    ?.textContent?.replace('Input required', '')
                    .trim() ?? 'dimension',
        )
        .filter(Boolean);
}

/* ------------------------------ profile state ----------------------------- */

const PROFILE_DATA = new Map<string, ProfileCardData>();

document.querySelectorAll<HTMLElement>('[data-profile-card]').forEach((card) => {
    const radio = card.querySelector<HTMLInputElement>('input[name="profile"]');
    if (!radio) return;
    const ui = JSON.parse(card.dataset.ui ?? '{}') as ProfileUi;
    const requirements = JSON.parse(
        card.dataset.requirements ??
            '{"mast":true,"bowsprit":true,"hullWidth":true,"gunBore":true}',
    ) as ProfileRequirements;
    const defaults = JSON.parse(card.dataset.defaults ?? '{}') as RiggingSettings;
    const name = card.querySelector('strong')?.textContent?.trim() ?? radio.value;
    PROFILE_DATA.set(radio.value, {
        profileId: radio.value,
        version: card.dataset.version ?? '',
        ui,
        requirements,
        defaults,
        name,
    });
});

const PROFILE_VERSIONS = new Map(
    [...PROFILE_DATA.values()].map((profile) => [profile.profileId, profile.version]),
);

function selectedProfileId(): string {
    const element = document.querySelector<HTMLInputElement>('input[name="profile"]:checked');
    return element?.value ?? DEFAULT_PROFILE_ID;
}

function selectedProfile(): ProfileCardData | null {
    return PROFILE_DATA.get(selectedProfileId()) ?? null;
}

/* -------------------------------- settings -------------------------------- */

function readMast(mastId: MastId): RiggingSettings['masts'][MastId] {
    const present = checked(`mast-${mastId}-present`);
    return {
        present,
        diameter: readMeasurement(
            `mast-${mastId}`,
            select(`mast-${mastId}-point`).value as MeasurementPointId,
        ),
        topmast: present && checked(`mast-${mastId}-topmast`),
        topgallant: present && checked(`mast-${mastId}-topgallant`),
        yards: {
            lower: present && checked(`mast-${mastId}-yard-lower`),
            topmast: present && checked(`mast-${mastId}-yard-topmast`),
            topgallant: present && checked(`mast-${mastId}-yard-topgallant`),
        },
        sails: {
            lower: present && checked(`mast-${mastId}-sail-lower`),
            topmast: present && checked(`mast-${mastId}-sail-topmast`),
            topgallant: present && checked(`mast-${mastId}-sail-topgallant`),
        },
    };
}

function readSettings(): RiggingSettings {
    const profile = selectedProfile();
    const masts = {
        fore: readMast('fore'),
        main: readMast('main'),
        mizzen: readMast('mizzen'),
    } as RiggingSettings['masts'];

    const sailNodes = {} as RiggingSettings['sailNodes'];
    for (const kind of SAIL_NODE_KINDS_LIST) {
        sailNodes[kind] = { fore: false, main: false, mizzen: false };
        for (const mastId of MAST_IDS_LIST) {
            sailNodes[kind][mastId] =
                masts[mastId].present && checked(`sailnode-${kind}-${mastId}`);
        }
    }

    return {
        profileId: selectedProfileId(),
        profileVersion: profile?.version ?? null,
        scaleDenominator: Number(input('scale').value.trim().replace(',', '.')),
        masts,
        bowsprit: {
            present: checked('bowsprit-present'),
            diameter: readMeasurement('bowsprit', 'working_section'),
            jibboom: checked('jibboom-present'),
            flyingJibboom: checked('flying-jibboom-present'),
            martingale: checked('martingale-present'),
            spritsailYard: checked('spritsail-yard-present'),
            spritsailSail: checked('spritsail-sail'),
        },
        hullWidth: readMeasurement('hull-width', 'unknown'),
        anchor: {
            present: checked('anchor-present'),
            connection: select('anchor-connection').value as AnchorConnection,
        },
        gun: {
            present: checked('gun-present'),
            gunType: select('gun-type').value as GunType,
            mountingType: select('gun-mounting').value as MountingType,
            bore: readMeasurement('gun-bore', 'working_section'),
        },
        foreAndAft: {
            head_lower: {
                present: checked('foreaft-head_lower-present'),
                supportingMastId: select('foreaft-head_lower-mast').value as MastId,
            },
            head_upper: {
                present: checked('foreaft-head_upper-present'),
                supportingMastId: select('foreaft-head_upper-mast').value as MastId,
            },
            staysail_lower: {
                present: checked('foreaft-staysail_lower-present'),
                supportingMastId: select('foreaft-staysail_lower-mast').value as MastId,
            },
            staysail_upper: {
                present: checked('foreaft-staysail_upper-present'),
                supportingMastId: select('foreaft-staysail_upper-mast').value as MastId,
            },
        },
        gaff: {
            present: checked('gaff-present'),
            sailPresent: checked('gaff-sail'),
            supportingMastId: select('gaff-mast').value as MastId,
        },
        sailNodes,
        lateenYard: {
            present: checked('lateen-present'),
            sailPresent: checked('lateen-sail'),
            supportingMastId: select('lateen-mast').value as MastId,
        },
        hullGroup: checked('hull-group-present'),
    };
}

/* -------------------------- apply settings to form ------------------------ */

function setCheck(id: string, value: boolean): void {
    const element = document.getElementById(id) as HTMLInputElement | null;
    if (element) element.checked = value;
}

function setValue(id: string, value: number | null): void {
    const element = document.getElementById(id) as HTMLInputElement | null;
    if (element) element.value = value === null ? '' : String(value);
}

function setSelect(id: string, value: string): void {
    const element = document.getElementById(id) as HTMLSelectElement | null;
    if (element) element.value = value;
}

function applyMeasurement(prefix: string, measurement: Measurement): void {
    setValue(`${prefix}-value`, measurement.value);
    setSelect(`${prefix}-unit`, measurement.unitId);
    setSelect(`${prefix}-basis`, measurement.basis);
}

function applySettingsToForm(settings: RiggingSettings): void {
    const radio = document.querySelector<HTMLInputElement>(
        `input[name="profile"][value="${settings.profileId}"]`,
    );
    if (radio) radio.checked = true;

    setValue('scale', settings.scaleDenominator);

    for (const mastId of MAST_IDS_LIST) {
        const mast = settings.masts[mastId];
        applyMeasurement(`mast-${mastId}`, mast.diameter);
        setSelect(`mast-${mastId}-point`, mast.diameter.measurementPointId);
        setCheck(`mast-${mastId}-present`, mast.present);
        setCheck(`mast-${mastId}-topmast`, mast.topmast);
        setCheck(`mast-${mastId}-topgallant`, mast.topgallant);
        for (const tier of ['lower', 'topmast', 'topgallant'] as Tier[]) {
            setCheck(`mast-${mastId}-yard-${tier}`, mast.yards[tier]);
            setCheck(`mast-${mastId}-sail-${tier}`, mast.sails[tier]);
        }
    }

    applyMeasurement('bowsprit', settings.bowsprit.diameter);
    setCheck('bowsprit-present', settings.bowsprit.present);
    setCheck('jibboom-present', settings.bowsprit.jibboom);
    setCheck('flying-jibboom-present', settings.bowsprit.flyingJibboom);
    setCheck('martingale-present', settings.bowsprit.martingale);
    setCheck('spritsail-yard-present', settings.bowsprit.spritsailYard);
    setCheck('spritsail-sail', settings.bowsprit.spritsailSail);

    applyMeasurement('hull-width', settings.hullWidth);
    applyMeasurement('gun-bore', settings.gun.bore);

    setCheck('anchor-present', settings.anchor.present);
    setSelect('anchor-connection', settings.anchor.connection);
    setCheck('gun-present', settings.gun.present);
    setSelect('gun-type', settings.gun.gunType);
    setSelect('gun-mounting', settings.gun.mountingType);

    for (const sailClass of SAIL_CLASSES_LIST) {
        setCheck(`foreaft-${sailClass}-present`, settings.foreAndAft[sailClass].present);
        setSelect(`foreaft-${sailClass}-mast`, settings.foreAndAft[sailClass].supportingMastId);
    }

    setCheck('gaff-present', settings.gaff.present);
    setCheck('gaff-sail', settings.gaff.sailPresent);
    setSelect('gaff-mast', settings.gaff.supportingMastId);

    setCheck('lateen-present', settings.lateenYard.present);
    setCheck('lateen-sail', settings.lateenYard.sailPresent);
    setSelect('lateen-mast', settings.lateenYard.supportingMastId);

    for (const kind of SAIL_NODE_KINDS_LIST) {
        for (const mastId of MAST_IDS_LIST) {
            setCheck(`sailnode-${kind}-${mastId}`, settings.sailNodes[kind][mastId]);
        }
    }

    setCheck('hull-group-present', settings.hullGroup);
}

/* ------------------------------- profile UI ------------------------------- */

function visibleSteps(): HTMLDetailsElement[] {
    return [...document.querySelectorAll<HTMLDetailsElement>('.rig-step')].filter(
        (step) => !step.hidden,
    );
}

function updateStepsToggle(): void {
    const steps = visibleSteps();
    const allOpen = steps.length > 0 && steps.every((step) => step.open);
    expandStepsButton.textContent = allOpen ? 'Collapse all steps' : 'Expand all steps';
    expandStepsButton.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
}

function updateStepSummaries(): void {
    const checked = document.querySelector<HTMLInputElement>('input[name="profile"]:checked');
    const card = checked?.closest<HTMLElement>('[data-profile-card]');
    const profileName = card?.querySelector('strong')?.textContent?.trim() ?? 'Profile';
    const version = card?.dataset.version ? ` · v${card.dataset.version}` : '';
    stepProfileMeta.textContent = `${profileName}${version}`;

    const scale = document.getElementById('scale') as HTMLInputElement | null;
    const scaleValue = scale?.value.trim() ?? '';
    stepScaleMeta.textContent = scaleValue ? `1 : ${scaleValue}` : 'Scale not set';
}

function applyProfileUi(profile: ProfileCardData): void {
    const ui = profile.ui;
    const requirements = profile.requirements;
    const sailKinds = new Set(sailNodeKindsForUi(ui));
    const blocks: Record<string, boolean> = {
        masts: ui.masts,
        square: ui.yards || ui.squareSails,
        foreaft: ui.foreAndAft.length > 0,
        gaff: ui.gaff && !ui.gaffSail,
        lateen: ui.lateenYard,
        sailnodes: sailKinds.size > 0,
        bowsprit: ui.bowsprit,
        hull: ui.hullGroup,
        anchor: ui.anchor,
        gun: ui.gun,
    };

    document.querySelectorAll<HTMLElement>('[data-ui-block]').forEach((element) => {
        const key = element.dataset.uiBlock ?? '';
        element.hidden = !blocks[key];
    });

    const sparsFieldset = document.querySelector<HTMLElement>('[data-spars-fieldset]');
    if (sparsFieldset) {
        sparsFieldset.hidden = !(ui.bowsprit || ui.hullGroup || ui.anchor || ui.gun);
    }

    document.querySelectorAll<HTMLElement>('[data-mast-tier]').forEach((cell) => {
        const tier = cell.dataset.mastTier as Tier;
        cell.hidden = !ui.tiers.includes(tier);
    });
    document.querySelectorAll<HTMLElement>('[data-tier-row]').forEach((row) => {
        const tier = row.dataset.tierRow as Tier;
        row.hidden = !ui.tiers.includes(tier);
    });
    document.querySelectorAll<HTMLElement>('[data-sail-class]').forEach((row) => {
        const sailClass = row.dataset.sailClass as SailClass;
        row.hidden = !ui.foreAndAft.includes(sailClass);
    });
    document.querySelectorAll<HTMLElement>('[data-sailnode-row]').forEach((row) => {
        const kind = row.dataset.sailnodeRow as SailNodeKind;
        row.hidden = !sailKinds.has(kind);
    });
    document.querySelectorAll<HTMLElement>('[data-ui-flag]').forEach((element) => {
        const flag = element.dataset.uiFlag;
        const visible =
            (flag === 'jibboom' && ui.jibboom) ||
            (flag === 'martingale' && ui.martingale) ||
            (flag === 'spritsaill' && ui.spritsaill);
        element.hidden = !visible;
    });

    const dimensionVisibility: Record<string, boolean> = {
        // Показываем только те размеры, которые профиль действительно
        // использует в правилах, а не просто упоминает в блоке формы.
        bowsprit: ui.bowsprit && requirements.bowsprit,
        'hull-width': ui.anchor && requirements.hullWidth,
        'gun-bore': ui.gun && requirements.gunBore,
    };
    for (const [key, visible] of Object.entries(dimensionVisibility)) {
        const element = document.querySelector<HTMLElement>(`[data-dim="${key}"]`);
        if (element) element.hidden = !visible;
    }
    for (const mastId of MAST_IDS_LIST) {
        const element = document.querySelector<HTMLElement>(`[data-dim="mast-${mastId}"]`);
        if (element) element.hidden = !(ui.masts && requirements.mast);
    }

    const mastsStep = document.querySelector<HTMLDetailsElement>('.rig-step--masts');
    if (mastsStep) {
        const hasVisibleBlock = [...mastsStep.querySelectorAll<HTMLElement>('[data-ui-block]')].some(
            (element) => !element.hidden,
        );
        mastsStep.hidden = !hasVisibleBlock;
    }

    const gearStep = document.querySelector<HTMLDetailsElement>('.rig-step--gear');
    if (gearStep) gearStep.hidden = sparsFieldset?.hidden ?? false;

    updateStepSummaries();
    updateStepsToggle();
}

/* ----------------------------- form dependencies -------------------------- */

function setDisabled(id: string, disabled: boolean): void {
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (element) element.disabled = disabled;
}

function syncDisabled(): void {
    for (const mastId of MAST_IDS_LIST) {
        const present = checked(`mast-${mastId}-present`);
        const topmast = present && checked(`mast-${mastId}-topmast`);
        const mastState = {
            present,
            topmast,
            topgallant: topmast && checked(`mast-${mastId}-topgallant`),
        };
        const available = tierAvailability(mastState);

        for (const suffix of ['-value', '-unit', '-basis', '-point']) {
            setDisabled(`mast-${mastId}${suffix}`, !present);
        }
        setDisabled(`mast-${mastId}-topmast`, !present);
        setDisabled(`mast-${mastId}-topgallant`, !topmast);

        for (const tier of ['lower', 'topmast', 'topgallant'] as Tier[]) {
            setDisabled(`mast-${mastId}-yard-${tier}`, !available[tier]);
            setDisabled(
                `mast-${mastId}-sail-${tier}`,
                !sailSelectable(mastState, tier, checked(`mast-${mastId}-yard-${tier}`)),
            );
        }

        for (const kind of SAIL_NODE_KINDS_LIST) {
            setDisabled(`sailnode-${kind}-${mastId}`, !present);
        }
    }

    const bowsprit = checked('bowsprit-present');
    for (const suffix of ['-value', '-unit', '-basis']) {
        setDisabled(`bowsprit${suffix}`, !bowsprit);
    }
    setDisabled('jibboom-present', !bowsprit);
    setDisabled('flying-jibboom-present', !bowsprit || !checked('jibboom-present'));
    setDisabled('martingale-present', !bowsprit);
    setDisabled('spritsail-yard-present', !bowsprit);
    setDisabled('spritsail-sail', !checked('spritsail-yard-present'));

    const anchor = checked('anchor-present');
    for (const suffix of ['-value', '-unit', '-basis']) {
        setDisabled(`hull-width${suffix}`, !anchor);
    }
    setDisabled('anchor-connection', !anchor);

    const gun = checked('gun-present');
    for (const suffix of ['-value', '-unit', '-basis']) {
        setDisabled(`gun-bore${suffix}`, !gun);
    }
    setDisabled('gun-type', !gun);
    setDisabled('gun-mounting', !gun);

    for (const sailClass of SAIL_CLASSES_LIST) {
        const sailPresent = checked(`foreaft-${sailClass}-present`);
        const supportingMast = select(`foreaft-${sailClass}-mast`).value as MastId;
        setDisabled(`foreaft-${sailClass}-present`, !checked(`mast-${supportingMast}-present`));
        setDisabled(`foreaft-${sailClass}-mast`, !sailPresent);
    }

    const gaff = checked('gaff-present');
    const gaffMast = select('gaff-mast').value as MastId;
    setDisabled('gaff-present', !checked(`mast-${gaffMast}-present`));
    setDisabled('gaff-mast', !gaff);
    setDisabled('gaff-sail', !gaff);

    const lateen = checked('lateen-present');
    const lateenMast = select('lateen-mast').value as MastId;
    setDisabled('lateen-present', !checked(`mast-${lateenMast}-present`));
    setDisabled('lateen-mast', !lateen);
    setDisabled('lateen-sail', !lateen);
}

/* --------------------------------- state ---------------------------------- */

function safeSessionStorage(): Storage | null {
    try {
        const storage = window.sessionStorage;
        const probe = '__rigging_view_probe__';
        storage.setItem(probe, '1');
        storage.removeItem(probe);
        return storage;
    } catch {
        return null;
    }
}

const ledgerStorage = safeSessionStorage();

const state = {
    calculation: null as Calculation | null,
    settings: null as RiggingSettings | null,
    ledgerRows: [] as LedgerRow[],
    ledger: (loadLedgerState(ledgerStorage) ?? initialLedgerState()) as LedgerState,
    searchExpansion: 'auto' as 'auto' | 'expanded' | 'collapsed',
    currentSelection: null as LedgerSelection | null,
    facets: null as LedgerFacets | null,
    optionsSignature: '',
    threadPicks: new Map<string, ThreadPick>(),
    rowsByKey: new Map<string, LedgerRow>(),
    modalRowKey: null as string | null,
    lastFocused: null as HTMLElement | null,
    notice: null as string | null,
    dirty: false,
    formVersion: 0,
    requestSeq: 0,
    abort: undefined as AbortController | undefined,
    activeProfile: null as ProfileCardData | null,
    profileUndo: null as RiggingSettings | null,
    dimensionDraft: {} as Partial<Record<DimensionKey, Measurement>>,
    editedDimensions: new Set<DimensionKey>(),
};

const form = byId<HTMLFormElement>('rigging-form');
const actionsBar = byId('rig-actions');

// Панель действий закреплена внизу, пока форма ввода в кадре; на результатах
// она скрывается на результатах и не занимает места в потоке формы.
const actionsObserver = new IntersectionObserver(
    (entries) => {
        actionsBar.hidden = !entries.some((entry) => entry.isIntersecting);
    },
    { threshold: 0 },
);
actionsObserver.observe(form);
const errorsBox = byId('form-errors');
const resultsStatus = byId('results-status');
const resultsSection = byId('rig-results');
const resultsState = byId('results-state');
const summary = byId('summary');
const resultsList = byId('results-list');
const calculationError = byId('calculation-error');
const calculationErrorText = byId('calculation-error-text');
const staleNotice = byId('stale-notice');
const staleText = byId('stale-text');
const staleRecalculate = byId<HTMLButtonElement>('stale-recalculate');
const calculationRetry = byId<HTMLButtonElement>('calculation-retry');
const showNaInput = input('show-na');
const exportCsv = byId<HTMLButtonElement>('export-csv');
const exportJson = byId<HTMLButtonElement>('export-json');
const exportScopeSelect = select('export-scope');
const calculateButton = byId<HTMLButtonElement>('calculate');
const stepProfileMeta = byId('step-profile-meta');
const stepScaleMeta = byId('step-scale-meta');
const expandStepsButton = byId<HTMLButtonElement>('expand-steps');
const loadPresetButton = byId<HTMLButtonElement>('load-preset');
const presetFile = byId<HTMLInputElement>('preset-file');
const modelPrefillSelect = select('model-prefill-select');
const applyModelPrefillButton = byId<HTMLButtonElement>('apply-model-prefill');
const modelPrefillStatus = byId('model-prefill-status');
const modelPrefillData = byId('model-prefill-data');

interface PrefillModelData {
    slug: string;
    title: string;
    scale: string | null;
    measurements: MeasurementSource[];
}

function readPrefillModels(): PrefillModelData[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(modelPrefillData.textContent ?? '[]');
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const models: PrefillModelData[] = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.slug !== 'string' || typeof candidate.title !== 'string') continue;
        if (!Array.isArray(candidate.measurements)) continue;
        models.push({
            slug: candidate.slug,
            title: candidate.title,
            scale: typeof candidate.scale === 'string' ? candidate.scale : null,
            measurements: candidate.measurements as MeasurementSource[],
        });
    }
    return models;
}

const PREFILL_MODELS = readPrefillModels();
const PREFILL_BY_SLUG = new Map(PREFILL_MODELS.map((model) => [model.slug, model]));

const PREFILL_PREFIX_BY_FIELD: Record<PrefillField, DimPrefix> = {
    'mastDiameter.fore': 'mast-fore',
    'mastDiameter.main': 'mast-main',
    'mastDiameter.mizzen': 'mast-mizzen',
    bowspritDiameter: 'bowsprit',
    hullWidth: 'hull-width',
    gunBore: 'gun-bore',
};

const ropeModal = byId('rope-modal');
const ropeModalTarget = byId('rope-modal-target');
const ropeWidget = ropeModal.querySelector('[data-rope-calculator]') as HTMLElement | null;

/**
 * Локальная разработка: каталог нитей на отдельном хосте и не разрешает
 * CORS для localhost. Параметр `?rope-api=` позволяет направить виджет на
 * локальный прокси, как `?api=` для расчётного API.
 */
const ROPE_API_OVERRIDE = new URLSearchParams(window.location.search)
    .get('rope-api')
    ?.trim();
if (ROPE_API_OVERRIDE && ropeWidget) {
    ropeWidget.setAttribute('api-base', ROPE_API_OVERRIDE.replace(/\/+$/, ''));
}

const ledgerSearch = input('ledger-search');
const ledgerControls = byId('ledger-controls');
const ledgerCount = byId('ledger-count');
const filtersToggle = byId<HTMLButtonElement>('ledger-filters-toggle');
const filtersPanel = byId('ledger-filters');
const filterSummary = byId('ledger-filter-summary');
const sortMeta = byId('ledger-sort-meta');
const groupingMeta = byId('ledger-grouping-meta');
const groupedToolbar = byId('ledger-grouped-toolbar');
const groupedMeta = byId('ledger-grouped-meta');
const filterNode = select('filter-node');
const filterTier = select('filter-tier');
const filterType = select('filter-type');
const filterStatus = select('filter-status');
const filterBadge = byId('ledger-filter-badge');
const tierDisabledNote = byId('tier-disabled-note');
const clearFiltersButton = byId<HTMLButtonElement>('clear-filters');
const ledgerActive = byId('ledger-active');
const ledgerNotice = byId('ledger-notice');
const modeGrouped = byId<HTMLButtonElement>('ledger-mode-grouped');
const modeFlat = byId<HTMLButtonElement>('ledger-mode-flat');
const sortSelect = select('ledger-sort');
const expandAllButton = byId<HTMLButtonElement>('expand-all');
const collapseAllButton = byId<HTMLButtonElement>('collapse-all');
const recalculateButton = byId<HTMLButtonElement>('recalculate');
const undoProfileButton = byId<HTMLButtonElement>('undo-profile');

const FIELD_TO_ID: Record<string, string> = {
    scaleDenominator: 'scale',
    'mast.fore.diameter': 'mast-fore-value',
    'mast.main.diameter': 'mast-main-value',
    'mast.mizzen.diameter': 'mast-mizzen-value',
    'bowsprit.diameter': 'bowsprit-value',
    'hull.width': 'hull-width-value',
    'gun.bore': 'gun-bore-value',
};

type ResultsState = 'idle' | 'calculating' | 'ready' | 'stale' | 'error';

const RESULTS_STATE_LABELS: Record<ResultsState, string> = {
    idle: 'Not calculated',
    calculating: 'Calculating…',
    ready: 'Current',
    stale: 'Out of date',
    error: 'Error',
};

/**
 * Явное состояние результатов: не рассчитано, идёт расчёт, актуально,
 * устарело или ошибка. Отдельный ярлык рядом с заголовком не даёт спутать
 * старую ведомость с новой.
 */
function setResultsState(next: ResultsState): void {
    resultsSection.dataset.state = next;
    resultsState.dataset.state = next;
    resultsState.textContent = RESULTS_STATE_LABELS[next];
}

const STALE_MESSAGE =
    'Inputs changed. The ledger below is from the previous calculation.';
const FAILED_RECALC_MESSAGE =
    'The latest calculation failed. The ledger below is from the previous successful calculation.';

function showStale(message: string = STALE_MESSAGE): void {
    staleText.textContent = message;
    staleNotice.hidden = false;
}

function hideStale(): void {
    staleNotice.hidden = true;
}

function saveLedgerView(): void {
    saveLedgerState(state.ledger, ledgerStorage);
}

function selectedResults(): RiggingResult[] {
    return (state.currentSelection?.visible ?? []).map((row) => row.result);
}

function exportConditions(): string[] {
    return activeConditions({
        filters: state.ledger.filters,
        query: state.ledger.query,
        showNotApplicable: state.ledger.showNotApplicable,
    }).map((condition) => condition.label);
}

/**
 * Экспорт доступен только для актуального расчёта и непустой области.
 * Для области «текущая выборка» используется та же selection, что счётчик
 * N of M и неприменимые строки.
 */
function updateExportAvailability(): void {
    const calc = state.calculation;
    if (!calc || state.dirty) {
        exportCsv.disabled = true;
        exportJson.disabled = true;
        return;
    }

    const count =
        state.ledger.exportScope === 'selection'
            ? (state.currentSelection?.visible.length ?? 0)
            : calc.results.length;
    const exportable = calc.validationErrors.length === 0 && count > 0;
    exportCsv.disabled = !exportable;
    exportJson.disabled = !exportable;
}

function threadReviewCount(): number {
    let count = 0;
    for (const [key, pick] of state.threadPicks) {
        const row = state.rowsByKey.get(key);
        if (row && threadPickNeedsReview(pick, row.result.diameterModelMm)) count += 1;
    }
    return count;
}

function renderErrors(errors: Calculation['validationErrors']): void {
    if (errors.length === 0) {
        errorsBox.hidden = true;
        errorsBox.replaceChildren();
        return;
    }

    const list = document.createElement('ul');
    for (const issue of errors) {
        const item = document.createElement('li');
        item.textContent = issue.message;
        list.appendChild(item);
    }

    errorsBox.replaceChildren(list);
    errorsBox.hidden = false;

    for (const issue of errors) {
        const targetId = issue.field ? FIELD_TO_ID[issue.field] : undefined;
        const target = targetId ? document.getElementById(targetId) : null;
        if (target) {
            target.focus();
            return;
        }
    }
    form.focus();
}

function tierLabel(tier: Tier | null): string {
    return tier ? TIER_LABELS[tier].en : 'No tier';
}

function rowContext(row: LedgerRow): string {
    const parts = [nodeLabel(row.nodeId)];
    if (row.nodeKind === 'mast') parts.push(tierLabel(row.tier));
    if (row.type) parts.push(GROUP_LABELS[row.type]);
    return parts.join(' · ');
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
}

function definitionTerm(dl: HTMLDListElement, term: string): HTMLDListElement {
    const dt = el('dt', 'rig-details__term');
    dt.textContent = term;
    dl.appendChild(dt);
    return dl;
}

function definitionText(dl: HTMLDListElement, term: string, text: string | null): void {
    definitionTerm(dl, term);
    const dd = el('dd', 'rig-details__def');
    dd.textContent = text ?? '—';
    dl.appendChild(dd);
}

function actionButton(
    label: string,
    action: string,
    key: string | null = null,
    className = 'rig-link',
): HTMLButtonElement {
    const button = el('button', className);
    button.type = 'button';
    button.dataset.action = action;
    if (key !== null) button.dataset.key = key;
    button.textContent = label;
    return button;
}

function appendHighlighted(container: HTMLElement, text: string, tokens: string[]): void {
    for (const segment of highlightSegments(text, tokens)) {
        if (!segment.match) {
            container.appendChild(document.createTextNode(segment.text));
            continue;
        }
        const mark = el('mark', 'rig-mark');
        mark.textContent = segment.text;
        container.appendChild(mark);
    }
}

function statusBadge(status: ResultStatus, withLabel = true): HTMLElement {
    const badge = el('span', `rig-row__badge rig-row__badge--${status}`);
    badge.textContent = STATUS_LABELS[status];
    if (withLabel) {
        const badgeLabel = el('span', 'rig-sr-only');
        badgeLabel.textContent = 'Status: ';
        badge.prepend(badgeLabel);
    }
    return badge;
}

/** FIT / ENG видимы в строке, а не только в резюме. */
function originBadge(result: RiggingResult): HTMLElement | null {
    if (result.status !== 'calculated') return null;
    const badge = el('span', `rig-row__basis rig-row__basis--${result.coefficientBasis}`);
    badge.textContent = ORIGIN_SHORT_LABELS[result.coefficientBasis];
    badge.title = ORIGIN_LABELS[result.coefficientBasis];
    badge.setAttribute(
        'aria-label',
        `Coefficient origin: ${ORIGIN_LABELS[result.coefficientBasis]}`,
    );
    return badge;
}

function threadControl(row: LedgerRow): HTMLElement {
    const pick = state.threadPicks.get(row.key);
    const button = el('button', 'rig-thread');
    button.type = 'button';
    button.dataset.action = 'pick-thread';
    button.dataset.key = row.key;

    const reviewNote = pick
        ? threadPickReviewNote(pick, row.result.diameterModelMm)
        : null;

    if (pick) {
        button.classList.add('rig-thread--picked');
        if (reviewNote) button.classList.add('rig-thread--review');
        const label = el('span', 'rig-thread__label');
        label.textContent = threadPickLabel(pick);
        const meta = el('span', 'rig-thread__meta');
        meta.textContent = reviewNote
            ? `Review · Ø ${pick.diameterMm.toFixed(3)} mm`
            : `Ø ${pick.diameterMm.toFixed(3)} mm`;
        button.append(label, meta);
        button.title = reviewNote
            ? `${threadPickDetails(pick)} ${reviewNote}`
            : threadPickDetails(pick);
        button.setAttribute(
            'aria-label',
            `${
                reviewNote ? 'Review thread' : 'Change thread'
            } for ${row.result.nameEn}: ${threadPickLabel(pick)}, ${threadPickDetails(pick)}${
                reviewNote ? `. ${reviewNote}` : ''
            }`,
        );
    } else {
        const label = el('span', 'rig-thread__label');
        label.textContent = 'Pick thread';
        button.appendChild(label);
        button.setAttribute('aria-label', `Pick a model thread for ${row.result.nameEn}`);
    }

    return button;
}

function measurementsForResult(result: RiggingResult): NormalizedMeasurement[] {
    const all = state.calculation?.normalizedMeasurements ?? [];
    if (all.length === 0) return [];

    let measurementId: MeasurementId | null = null;
    if (result.ownerType === 'mast') {
        measurementId = `mast.${result.ownerId}.diameter` as MeasurementId;
    } else if (result.ownerType === 'bowsprit') {
        measurementId = 'bowsprit.diameter';
    } else if (result.ownerType === 'hull') {
        measurementId = 'hull.width';
    } else if (result.ownerType === 'gun_group') {
        measurementId = 'gun.bore';
    }

    // Якорная группа может опираться на ширину корпуса или самую толстую
    // мачту; показываем все размеры, которые реально вошли в расчёт.
    if (measurementId === null) return all;
    return all.filter((measurement) => measurement.measurementId === measurementId);
}

function measurementLine(measurement: NormalizedMeasurement): string {
    const basis = measurement.basis === 'model' ? 'the model' : 'full-size';
    return (
        `${measurement.rawValue} ${measurement.unitId} (${basis}) → ` +
        `${measurement.modelMm.toFixed(3)} mm model · ` +
        `${measurement.realMm.toFixed(1)} mm prototype`
    );
}

/** Переход из строки к исходному полю формы; подсвечивает строку размера. */
function focusMeasurementFields(ids: readonly string[]): void {
    for (const id of ids) {
        const fieldId = FIELD_TO_ID[id];
        const element = fieldId ? document.getElementById(fieldId) : null;
        if (!element) continue;

        const step = element.closest<HTMLDetailsElement>('.rig-step');
        if (step) step.open = true;
        const row = element.closest<HTMLElement>('.rig-dim, .rig-field');
        row?.classList.add('is-highlighted');
        window.setTimeout(() => row?.classList.remove('is-highlighted'), 1600);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (element as HTMLInputElement).focus({ preventScroll: true });
        return;
    }

    form.querySelector<HTMLInputElement>('input')?.focus();
}

function buildDetailsBody(result: RiggingResult, row: LedgerRow): HTMLDListElement {
    const dl = el('dl', 'rig-details');
    const pick = state.threadPicks.get(row.key);

    definitionText(dl, 'Node', nodeLabel(result.ownerId));
    definitionText(
        dl,
        'Tier',
        result.tier ? TIER_LABELS[result.tier].en : row.nodeKind === 'mast' ? 'No tier' : '—',
    );
    definitionText(dl, 'Rigging type', row.type ? GROUP_LABELS[row.type] : '—');

    const baseMeasurements = measurementsForResult(result);
    if (baseMeasurements.length > 0) {
        definitionTerm(dl, 'Base dimensions');
        const dd = el('dd', 'rig-details__def');
        const list = el('ul', 'rig-details__list');
        for (const measurement of baseMeasurements) {
            const item = el('li');
            item.textContent =
                `${MEASUREMENT_LABELS[measurement.measurementId] ?? measurement.measurementId}: ` +
                measurementLine(measurement);
            list.appendChild(item);
        }
        dd.appendChild(list);

        const edit = el('button', 'rig-link');
        edit.type = 'button';
        edit.textContent =
            baseMeasurements.length === 1 ? 'Edit base dimension' : 'Edit base dimensions';
        edit.addEventListener('click', () =>
            focusMeasurementFields(baseMeasurements.map((measurement) => measurement.measurementId)),
        );
        dd.appendChild(edit);
        dl.appendChild(dd);
    }

    definitionText(dl, 'Formula', result.formula);
    definitionText(dl, 'Base reference', result.referenceLabel);
    definitionText(dl, 'Coefficient', result.factorLabel);
    if (result.variant) definitionText(dl, 'Variant', result.variant);
    if (result.alternativeGroupId) {
        definitionText(dl, 'Alternative group', result.alternativeGroupId);
    }
    definitionText(
        dl,
        'Origin',
        `${ORIGIN_LABELS[result.coefficientBasis]} · ${CALIBRATION_LABELS[result.calibrationStatus]}`,
    );
    definitionText(dl, 'Material', MATERIAL_LABELS[result.material]);
    definitionText(
        dl,
        'Measurement point',
        result.measurementPointId
            ? (MEASUREMENT_POINT_LABELS[result.measurementPointId] ?? result.measurementPointId)
            : null,
    );
    definitionText(
        dl,
        'Prototype Ø',
        result.diameterPrototypeMm === null ? null : formatMm(result.diameterPrototypeMm, 3),
    );
    definitionText(dl, 'Profile', `${result.profileId} v${result.profileVersion}`);
    definitionText(
        dl,
        'Sources',
        result.sourceIds.length > 0
            ? `${result.sourceIds.join(', ')}${result.sourceLocator ? ` · ${result.sourceLocator}` : ''}`
            : null,
    );

    definitionTerm(dl, 'Thread');
    const threadDef = el('dd', 'rig-details__def');
    if (pick) {
        threadDef.append(
            document.createTextNode(`${threadPickLabel(pick)} — ${threadPickDetails(pick)}`),
            el('br'),
        );
        const reviewNote = threadPickReviewNote(pick, result.diameterModelMm);
        if (reviewNote) {
            const note = el('span', 'rig-thread-review');
            note.textContent = reviewNote;
            threadDef.append(note, el('br'));
        }
        threadDef.appendChild(actionButton('Change thread', 'pick-thread', row.key));
    } else if (result.status === 'calculated' && result.diameterModelMm !== null) {
        threadDef.appendChild(
            actionButton(
                `Find a model rope for Ø ${result.diameterModelMm.toFixed(3)} mm`,
                'pick-thread',
                row.key,
            ),
        );
    } else {
        threadDef.textContent = '—';
    }
    dl.appendChild(threadDef);

    if (result.status !== 'calculated' && result.reasonCode) {
        definitionText(dl, 'Status', REASON_LABELS[result.reasonCode]);
    }

    if (result.missingInputIds.length > 0) {
        definitionTerm(dl, 'Missing');
        const dd = el('dd', 'rig-details__def');
        const items = result.missingInputIds.map(
            (measurementId) => MEASUREMENT_LABELS[measurementId] ?? measurementId,
        );
        dd.textContent = items.join('; ');
        const goToInput = el('button', 'rig-link');
        goToInput.type = 'button';
        goToInput.textContent = 'Go to the required input';
        goToInput.addEventListener('click', () =>
            focusMeasurementFields(result.missingInputIds),
        );
        dd.append(el('br'), goToInput);
        dl.appendChild(dd);
    }

    const uniqueWarnings = [...new Set(result.warnings.filter(Boolean))];
    if (uniqueWarnings.length > 0) {
        definitionTerm(dl, 'Notes');
        const dd = el('dd', 'rig-details__def');
        const ul = el('ul', 'rig-details__list');
        for (const warning of uniqueWarnings) {
            const item = el('li');
            item.textContent = warning;
            ul.appendChild(item);
        }
        dd.appendChild(ul);
        dl.appendChild(dd);
    }

    definitionText(dl, 'IDs', `${result.ruleId} · ${result.ropeId} · ${result.nodeId}`);

    return dl;
}

function createRow(row: LedgerRow, tokens: string[], showContext: boolean): HTMLElement {
    const result = row.result;
    const container = el('div', 'rig-row');
    container.dataset.status = result.status;
    container.dataset.group = result.group;
    container.dataset.key = row.key;

    const summaryEl = el('div', 'rig-row__summary');

    const identity = el('span', 'rig-row__identity');
    const name = el('span', 'rig-row__name');
    appendHighlighted(name, result.nameEn, tokens);
    const nameRu = el('span', 'rig-row__ru');
    appendHighlighted(nameRu, result.nameRu, tokens);
    identity.append(name, nameRu);
    const origin = originBadge(result);
    if (origin) identity.appendChild(origin);
    if (showContext) {
        const context = el('span', 'rig-row__context');
        context.textContent = rowContext(row);
        identity.appendChild(context);
    }

    const diameter = el('span', 'rig-row__diameter');
    const diameterLabel = el('span', 'rig-sr-only');
    diameterLabel.textContent = 'Model diameter: ';
    diameter.append(diameterLabel, document.createTextNode(formatDiameter(result.diameterModelMm)));

    const material = el('span', 'rig-row__material');
    const materialLabel = el('span', 'rig-sr-only');
    materialLabel.textContent = 'Material: ';
    material.append(materialLabel, document.createTextNode(MATERIAL_LABELS[result.material]));

    const badge = statusBadge(result.status, true);
    const thread = el('span', 'rig-row__thread');
    thread.appendChild(threadControl(row));

    const detailsCell = el('span', 'rig-row__details');
    const bodyId = `rig-row-body-${row.order}`;
    const toggle = el('button', 'rig-button rig-button--ghost rig-details-toggle');
    toggle.type = 'button';
    toggle.textContent = 'Details';
    toggle.dataset.action = 'toggle-grouped-details';
    toggle.dataset.key = row.key;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', bodyId);
    toggle.dataset.detailContext = `${result.nameEn} — ${rowContext(row)}`;
    toggle.setAttribute('aria-label', `Details for ${toggle.dataset.detailContext}`);
    detailsCell.appendChild(toggle);

    summaryEl.append(identity, diameter, material, badge, thread, detailsCell);

    const body = el('div', 'rig-row__body');
    body.id = bodyId;
    body.dataset.built = 'false';
    body.hidden = true;

    container.append(summaryEl, body);
    return container;
}

function sectionIsOpen(nodeId: string, selection: LedgerSelection): boolean {
    if (state.ledger.query.trim() === '') {
        return !state.ledger.collapsedNodes.has(nodeId);
    }
    if (state.searchExpansion === 'expanded') return true;
    if (state.searchExpansion === 'collapsed') return false;
    return selection.matchingNodes.has(nodeId);
}

function createGroupedSection(
    section: LedgerNodeSection,
    tokens: string[],
    selection: LedgerSelection,
): HTMLElement {
    const wrapper = el('section', 'rig-node');
    wrapper.dataset.node = section.nodeId;

    const details = el('details', 'rig-node__details');
    details.dataset.node = section.nodeId;
    details.open = sectionIsOpen(section.nodeId, selection);

    const summaryEl = el('summary', 'rig-node__summary');
    const title = el('span', 'rig-node__title');
    title.setAttribute('role', 'heading');
    title.setAttribute('aria-level', '3');
    title.textContent = section.label;
    const meta = el('span', 'rig-node__meta');
    const tierCount = section.tiers.filter((tier) => tier.tier !== null).length;
    meta.textContent =
        `${section.count} ${section.count === 1 ? 'row' : 'rows'}` +
        (tierCount > 0 ? ` · ${tierCount} ${tierCount === 1 ? 'tier' : 'tiers'}` : '');
    summaryEl.append(title, meta);

    const body = el('div', 'rig-node__body');
    const showContext = state.ledger.query.trim() !== '';

    for (const tier of section.tiers) {
        const tierEl = el('section', 'rig-tier');
        if (tier.label) {
            const heading = el('h4', 'rig-tier__title');
            const headingText = el('span');
            headingText.textContent = tier.label;
            const count = el('span', 'rig-tier__count');
            count.textContent = `${tier.count} ${tier.count === 1 ? 'row' : 'rows'}`;
            heading.append(headingText, count);
            tierEl.appendChild(heading);
        }

        for (const type of tier.types) {
            const typeEl = el('section', 'rig-type');
            if (type.label) {
                const heading = el('h5', 'rig-type__title');
                heading.textContent = type.label;
                typeEl.appendChild(heading);
            }

            const rowsEl = el('div', 'rig-type__rows');
            for (const row of type.rows) {
                rowsEl.appendChild(createRow(row, tokens, showContext));
            }
            typeEl.appendChild(rowsEl);
            tierEl.appendChild(typeEl);
        }

        body.appendChild(tierEl);
    }

    details.append(summaryEl, body);
    wrapper.appendChild(details);
    return wrapper;
}

function createFlatTable(selection: LedgerSelection): HTMLElement {
    const tokens = selection.tokens;
    const rows = sortLedgerRows(selection.visible, state.ledger.sort);

    const wrap = el('div', 'rig-table-wrap');
    const table = el('table', 'rig-table');
    const caption = el('caption', 'rig-sr-only');
    caption.textContent = 'Rigging ledger';
    table.appendChild(caption);

    const thead = el('thead');
    const headRow = el('tr');
    for (const label of [
        'Rope',
        'Node',
        'Tier',
        'Model Ø (mm)',
        'Material',
        'Status',
        'Thread',
        'Details',
    ]) {
        const th = el('th');
        th.scope = 'col';
        th.textContent = label;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');

    rows.forEach((row, index) => {
        const result = row.result;
        const tableRow = el('tr', 'rig-table__row');
        tableRow.dataset.key = row.key;

        const ropeCell = el('td');
        ropeCell.dataset.label = 'Rope';
        const name = el('span', 'rig-table__name');
        appendHighlighted(name, result.nameEn, tokens);
        const nameRu = el('span', 'rig-table__ru');
        appendHighlighted(nameRu, result.nameRu, tokens);
        ropeCell.append(name, nameRu);
        const origin = originBadge(result);
        if (origin) ropeCell.appendChild(origin);

        const nodeCell = el('td', 'rig-table__node');
        nodeCell.dataset.label = 'Node';
        nodeCell.textContent = nodeLabel(row.nodeId);

        const tierCell = el('td', 'rig-table__tier');
        tierCell.dataset.label = 'Tier';
        tierCell.textContent = row.tier
            ? TIER_LABELS[row.tier].en
            : row.nodeKind === 'mast'
              ? 'No tier'
              : '—';

        const diameterCell = el('td', 'rig-table__diameter');
        diameterCell.dataset.label = 'Model Ø (mm)';
        diameterCell.textContent = formatDiameter(result.diameterModelMm);

        const materialCell = el('td');
        materialCell.dataset.label = 'Material';
        materialCell.textContent = MATERIAL_LABELS[result.material];

        const statusCell = el('td');
        statusCell.dataset.label = 'Status';
        statusCell.appendChild(statusBadge(result.status, false));

        const threadCell = el('td');
        threadCell.dataset.label = 'Thread';
        threadCell.appendChild(threadControl(row));

        const detailsCell = el('td');
        detailsCell.dataset.label = 'Details';
        const detailsId = `rig-flat-details-${index}`;
        const toggle = actionButton(
            'Details',
            'toggle-details',
            row.key,
            'rig-button rig-button--ghost rig-details-toggle',
        );
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', detailsId);
        toggle.setAttribute(
            'aria-label',
            `Details for ${result.nameEn} — ${nodeLabel(row.nodeId)}${
                row.tier ? `, ${TIER_LABELS[row.tier].en}` : ''
            }`,
        );
        detailsCell.appendChild(toggle);

        tableRow.append(
            ropeCell,
            nodeCell,
            tierCell,
            diameterCell,
            materialCell,
            statusCell,
            threadCell,
            detailsCell,
        );

        const detailsRow = el('tr', 'rig-table__details');
        detailsRow.id = detailsId;
        detailsRow.hidden = true;
        const detailsCellFull = el('td');
        detailsCellFull.colSpan = 8;
        detailsCellFull.dataset.built = 'false';
        detailsRow.appendChild(detailsCellFull);

        tbody.append(tableRow, detailsRow);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function renderEmpty(calc: Calculation, selection: LedgerSelection): void {
    const wrap = el('div', 'rig-empty');
    const title = el('p', 'rig-empty__title');
    const text = el('p', 'rig-empty__text');

    if (calc.results.length === 0) {
        title.textContent = 'No rows for this configuration';
        text.textContent =
            'Add a mast, spar, anchor or gun group in the form and calculate again.';
        wrap.append(title, text);
        resultsList.appendChild(wrap);
        return;
    }

    if (
        selection.totalM === 0 &&
        !hasActiveConditions({
            filters: state.ledger.filters,
            query: state.ledger.query,
            showNotApplicable: false,
        })
    ) {
        title.textContent = 'Only not-applicable rows are hidden';
        text.textContent =
            'This configuration has no applicable rows. Show not-applicable rows to see the ledger.';
        wrap.append(title, text, actionButton('Show not applicable', 'show-na'));
        resultsList.appendChild(wrap);
        return;
    }

    title.textContent = 'No rows match the current conditions';
    text.textContent = `${selection.totalM} ${
        selection.totalM === 1 ? 'row is' : 'rows are'
    } in this calculation. Change the search or clear the filters.`;
    wrap.append(title, text, actionButton('Clear filters', 'clear-filters'));
    resultsList.appendChild(wrap);
}

function fillSelect(
    element: HTMLSelectElement,
    options: Array<{ value: string; label: string }>,
): void {
    const previous = element.value;
    element.replaceChildren(
        ...options.map(({ value, label }) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }),
    );
    if (options.some((option) => option.value === previous)) element.value = previous;
}

function renderFilterOptions(facets: LedgerFacets): void {
    const signature = [
        facets.nodes.map((node) => node.value).join(','),
        facets.tiers.join(','),
        facets.statuses.join(','),
    ].join('|');

    if (signature !== state.optionsSignature) {
        state.optionsSignature = signature;
        fillSelect(filterNode, [
            { value: 'all', label: 'All nodes' },
            ...facets.nodes.map((node) => ({ value: node.value, label: node.label })),
        ]);
        fillSelect(filterTier, [
            { value: 'all', label: 'All tiers' },
            ...facets.tiers.map((tier) => ({ value: tier, label: TIER_LABELS[tier].en })),
        ]);
        fillSelect(filterStatus, [
            { value: 'all', label: 'All' },
            ...facets.statuses.map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
            })),
        ]);
    }

    filterNode.value = state.ledger.filters.node;
    filterTier.value = state.ledger.filters.tier;
    filterType.value = state.ledger.filters.type;
    filterStatus.value = state.ledger.filters.status;

    const tiers = state.facets?.nodes.find(
        (node) => node.value === state.ledger.filters.node,
    )?.tiers;
    const disabled = tierFilterDisabled(state.ledgerRows, state.ledger.filters.node);
    filterTier.disabled = disabled;
    tierDisabledNote.hidden = !disabled;
    tierDisabledNote.textContent = tierFilterNote(state.ledgerRows, state.ledger.filters.node);

    for (const option of filterTier.options) {
        if (option.value === 'all') continue;
        option.disabled =
            state.ledger.filters.node !== 'all' &&
            !(tiers ?? []).includes(option.value as Tier);
    }
}

function renderActiveConditions(): void {
    const conditions = activeConditions({
        filters: state.ledger.filters,
        query: state.ledger.query,
        showNotApplicable: state.ledger.showNotApplicable,
    });

    ledgerActive.replaceChildren();
    ledgerActive.hidden = conditions.length === 0;

    conditions.forEach((condition, index) => {
        const chip = el('span', 'rig-condition');
        chip.setAttribute('role', 'listitem');
        chip.appendChild(document.createTextNode(condition.label));

        const remove = el('button', 'rig-condition__remove');
        remove.type = 'button';
        remove.dataset.action = 'remove-condition';
        remove.dataset.kind = condition.kind;
        remove.dataset.index = String(index);
        remove.setAttribute('aria-label', `Remove ${condition.label}`);
        remove.textContent = '×';
        chip.appendChild(remove);
        ledgerActive.appendChild(chip);
    });

    const filterCount =
        (state.ledger.filters.node !== 'all' ? 1 : 0) +
        (state.ledger.filters.tier !== 'all' ? 1 : 0) +
        (state.ledger.filters.type !== 'all' ? 1 : 0) +
        (state.ledger.filters.status !== 'all' ? 1 : 0) +
        (state.ledger.showNotApplicable ? 1 : 0);
    filterBadge.hidden = filterCount === 0;
    filterBadge.textContent = String(filterCount);

    clearFiltersButton.disabled = conditions.length === 0;
    ledgerNotice.textContent = state.notice ?? '';
    ledgerNotice.hidden = !state.notice;
}

function filterSummaryText(): string {
    const parts: string[] = [];
    if (state.ledger.filters.node !== 'all') {
        parts.push(nodeLabel(state.ledger.filters.node));
    }
    if (state.ledger.filters.tier !== 'all') {
        parts.push(TIER_LABELS[state.ledger.filters.tier].en);
    }
    if (state.ledger.filters.type !== 'all') {
        parts.push(state.ledger.filters.type === 'standing' ? 'Standing' : 'Running');
    }
    if (state.ledger.filters.status !== 'all') {
        parts.push(STATUS_LABELS[state.ledger.filters.status]);
    }
    if (state.ledger.showNotApplicable) parts.push('+ Not applicable');
    return parts.length > 0 ? parts.join(' · ') : 'All rows';
}

function renderLedgerToolbar(
    calc: Calculation,
    selection: LedgerSelection,
    facets: LedgerFacets,
): void {
    renderFilterOptions(facets);
    renderActiveConditions();

    showNaInput.checked = state.ledger.showNotApplicable;
    sortSelect.value = state.ledger.sort;
    exportScopeSelect.value = state.ledger.exportScope;
    modeGrouped.setAttribute('aria-pressed', state.ledger.mode === 'grouped' ? 'true' : 'false');
    modeFlat.setAttribute('aria-pressed', state.ledger.mode === 'flat' ? 'true' : 'false');

    // Восстановленный из sessionStorage поиск должен появиться в поле, но
    // нельзя перезаписывать ввод, пока пользователь печатает.
    if (document.activeElement !== ledgerSearch && ledgerSearch.value !== state.ledger.query) {
        ledgerSearch.value = state.ledger.query;
    }

    const filterText = filterSummaryText();
    filterSummary.textContent = filterText;
    filterSummary.title = filterText;
    sortMeta.textContent =
        state.ledger.mode === 'grouped' ? 'Within each group' : 'Whole table';
    groupingMeta.textContent =
        state.ledger.mode === 'grouped'
            ? 'Tiers and types as subheadings'
            : 'No grouping';

    const total = selection.totalM;
    ledgerCount.textContent =
        calc.results.length === 0
            ? 'No rows in this calculation.'
            : `${selection.visible.length} of ${total} ${total === 1 ? 'row' : 'rows'}`;

    const reviewCount = threadReviewCount();
    const reviewNote =
        reviewCount > 0
            ? ` ${reviewCount} thread ${reviewCount === 1 ? 'pick needs' : 'picks need'} review.`
            : '';
    resultsStatus.textContent =
        calc.results.length === 0
            ? 'No rows produced for this configuration.'
            : `Showing ${selection.visible.length} of ${total} rows.${reviewNote}`;
}

function renderResults(calc: Calculation): void {
    const rows = state.ledgerRows;
    const facets = buildFacets(rows);
    const selection = selectLedgerRows(rows, {
        filters: state.ledger.filters,
        query: state.ledger.query,
        showNotApplicable: state.ledger.showNotApplicable,
    });

    state.facets = facets;
    state.rowsByKey = new Map(rows.map((row) => [row.key, row]));
    state.currentSelection = selection;

    renderLedgerToolbar(calc, selection, facets);
    resultsList.replaceChildren();
    groupedToolbar.hidden = true;

    if (rows.length === 0 || selection.visible.length === 0) {
        renderEmpty(calc, selection);
        updateExportAvailability();
        return;
    }

    if (state.ledger.mode === 'flat') {
        resultsList.appendChild(createFlatTable(selection));
        updateExportAvailability();
        return;
    }

    const sections = groupedLedger(selection.visible, state.ledger.sort);
    groupedToolbar.hidden = false;
    groupedMeta.textContent =
        `${sections.length} ${sections.length === 1 ? 'node group' : 'node groups'}`;

    const head = el('div', 'rig-ledger__head');
    for (const label of ['Rope', 'Model Ø', 'Material', 'Status', 'Thread', 'Details']) {
        const cell = el('span');
        cell.textContent = label;
        head.appendChild(cell);
    }
    head.setAttribute('aria-hidden', 'true');
    resultsList.appendChild(head);

    for (const section of sections) {
        resultsList.appendChild(createGroupedSection(section, selection.tokens, selection));
    }

    updateExportAvailability();
}

function renderSummary(calc: Calculation): void {
    const counts: Array<{ status: ResultStatus; label: string }> = [
        { status: 'calculated', label: 'calculated' },
        { status: 'needs_input', label: 'needs input' },
        { status: 'unsupported', label: 'unsupported' },
        { status: 'not_applicable', label: 'not applicable' },
    ];

    const strip = el('div', 'rig-summary__strip');

    const title = el('span', 'rig-summary__title');
    title.textContent = 'Calculation totals';
    strip.append(title, document.createTextNode(' '));

    const total = el('span', 'rig-summary__total');
    const totalValue = el('strong');
    totalValue.textContent = `All ${calc.results.length} rows`;
    total.append(totalValue, document.createTextNode(' before filters'));
    strip.append(total, document.createTextNode(' '));

    for (const { status, label } of counts) {
        const count = calc.results.filter((result) => result.status === status).length;
        const item = el('span', `rig-summary__stat rig-summary__stat--${status}`);
        item.dataset.status = status;
        if (count === 0) item.classList.add('is-zero');

        const value = el('strong');
        value.textContent = String(count);
        item.append(value, document.createTextNode(` ${label}`));
        strip.append(item, document.createTextNode(' '));
    }

    summary.replaceChildren(strip);
}

function calculationErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message.replace(/\.$/, '') : '';
    const detail = message ? ` ${message}.` : '';
    return `Calculation service is unavailable.${detail} Check your connection and retry.`;
}

function scrollToResults(): void {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    resultsSection.focus({ preventScroll: true });
    resultsSection.classList.add('is-highlighted');
    window.setTimeout(() => resultsSection.classList.remove('is-highlighted'), 1400);
    if (window.location.hash !== '#rig-results') {
        window.history.replaceState(null, '', '#rig-results');
    }
}

async function calculateAndRender(scrollOnSuccess: boolean): Promise<void> {
    const missingDimensions = requiredDimensionRows();
    if (missingDimensions.length > 0) {
        renderErrors([
            {
                code: 'REQUIRED_INPUT',
                message: `Enter the required dimensions: ${requiredDimensionLabels().join(', ')}.`,
            },
        ]);
        const firstInput = missingDimensions[0]?.querySelector('input');
        if (firstInput) {
            const step = firstInput.closest<HTMLDetailsElement>('.rig-step');
            if (step) step.open = true;
            firstInput.focus();
        }
        if (state.calculation) {
            resultsSection.classList.add('is-stale');
            setResultsState('stale');
            showStale();
        }
        return;
    }

    const settings = readSettings();
    const input = buildInput(settings);
    const versionAtStart = state.formVersion;
    // Пока идёт пересчёт, старые результаты относятся к прежним входам или
    // профилю, поэтому оставляем их затемнёнными до успешного ответа. Это
    // особенно важно при переключении профиля: расчёт стартует сразу, и без
    // этого флага затемнение снималось бы в том же кадре.
    const keepStale = state.dirty;

    state.abort?.abort();
    const controller = new AbortController();
    state.abort = controller;
    const seq = ++state.requestSeq;

    if (!keepStale) resultsSection.classList.remove('is-stale');
    calculateButton.classList.remove('rig-button--attention');
    resultsSection.classList.add('is-calculating');
    resultsSection.setAttribute('aria-busy', 'true');
    setResultsState('calculating');
    hideStale();
    resultsStatus.textContent = 'Calculating diameters…';
    calculationError.hidden = true;
    calculationErrorText.textContent = '';

    try {
        const calc = await postCalculate(input, controller.signal);
        if (seq !== state.requestSeq || controller.signal.aborted) return;

        state.calculation = calc;
        state.settings = settings;
        state.ledgerRows = buildLedgerRows(calc.results);
        const reconciled = reconcileState(state.ledger, state.ledgerRows);
        state.ledger = reconciled.state;
        state.notice = reconciled.notice;

        const inputsChanged = state.formVersion !== versionAtStart;
        state.dirty = inputsChanged;

        renderErrors(calc.validationErrors);
        renderSummary(calc);
        renderResults(calc);
        saveLedgerView();

        updateExportAvailability();

        if (inputsChanged) {
            resultsSection.classList.add('is-stale');
            calculateButton.classList.add('rig-button--attention');
            setResultsState('stale');
            showStale();
        } else {
            // Ответ соответствует текущим входам: снимаем затемнение.
            resultsSection.classList.remove('is-stale');
            calculateButton.classList.remove('rig-button--attention');
            setResultsState('ready');
            hideStale();
        }

        if (scrollOnSuccess) scrollToResults();
    } catch (error) {
        if (controller.signal.aborted || seq !== state.requestSeq) return;

        const failedAfterInputChange = state.formVersion !== versionAtStart;
        state.dirty = true;
        resultsSection.classList.add('is-stale');
        calculateButton.classList.add('rig-button--attention');
        setResultsState('error');
        if (state.calculation) {
            showStale(failedAfterInputChange ? STALE_MESSAGE : FAILED_RECALC_MESSAGE);
        } else {
            hideStale();
        }
        calculationErrorText.textContent = calculationErrorMessage(error);
        calculationError.hidden = false;
        updateExportAvailability();
        resultsStatus.textContent = state.calculation
            ? 'Calculation failed. Showing previous results.'
            : 'Calculation unavailable.';
    } finally {
        if (seq === state.requestSeq) {
            resultsSection.classList.remove('is-calculating');
            resultsSection.setAttribute('aria-busy', 'false');
        }
    }
}

function markDirty(): void {
    state.formVersion += 1;
    calculationError.hidden = true;
    calculationErrorText.textContent = '';
    if (!state.calculation) return;
    state.dirty = true;
    resultsSection.classList.add('is-stale');
    calculateButton.classList.add('rig-button--attention');
    setResultsState('stale');
    showStale();
    updateExportAvailability();
}

function download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function timestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}`
    );
}

function updateProfileNote(): void {
    const profile = selectedProfile();
    const note = byId('profile-context-note');
    undoProfileButton.hidden = state.profileUndo === null;
    if (!profile) {
        note.textContent = 'No profile selected.';
        return;
    }
    note.textContent = `Selected: ${profile.name} v${profile.version} — tiers: ${profile.ui.tiers.join(', ')}. A draft profile is not historical verification.`;
}

function onProfileChange(): void {
    const profile = selectedProfile();
    if (!profile) return;

    const previous = state.activeProfile;
    captureDimensionDraft(previous);
    const current = readSettings();
    if (previous) {
        // Снимок конфигурации до переключения: отмена вернёт значения полей,
        // а не только название профиля.
        state.profileUndo = {
            ...current,
            profileId: previous.profileId,
            profileVersion: previous.version,
        };
    }
    const merged = switchProfileSettings({
        current,
        previous: previous
            ? { ui: previous.ui, requirements: previous.requirements }
            : null,
        nextDefaults: profile.defaults,
        next: { ui: profile.ui, requirements: profile.requirements },
        draft: state.dimensionDraft,
        editedDimensions: state.editedDimensions,
    });

    applySettingsToForm(merged.settings);
    applyProfileUi(profile);
    initDimState();
    syncDisabled();
    updateProfileNote();
    state.activeProfile = profile;
    syncRequiredDimensions();
    // Переключение профиля — такое же изменение входных данных: старые
    // результаты затемняются и остаются некликабельными до нажатия
    // «Calculate diameters». Автоматический пересчёт здесь не запускается.
    markDirty();
}

/* -------------------------------- events ---------------------------------- */

function exportReady(): boolean {
    return Boolean(state.calculation && state.settings && !state.dirty);
}

function exportSuffix(): string {
    return state.ledger.exportScope === 'selection' ? '-selection' : '';
}

/** Применяет ещё не отрисованный поиск, чтобы экспорт не отстал от поля. */
function flushPendingSearch(): void {
    if (ledgerSearch.value === state.ledger.query) return;
    window.clearTimeout(searchTimer);
    state.searchExpansion = 'auto';
    state.ledger = setQuery(state.ledger, ledgerSearch.value);
    saveLedgerView();
    if (state.calculation) renderResults(state.calculation);
}

function exportCount(): number {
    if (!state.calculation) return 0;
    return state.ledger.exportScope === 'selection'
        ? (state.currentSelection?.visible.length ?? 0)
        : state.calculation.results.length;
}

exportCsv.addEventListener('click', () => {
    flushPendingSearch();
    if (!exportReady() || !state.calculation) return;
    if (state.calculation.validationErrors.length > 0 || exportCount() === 0) return;
    const scope = state.ledger.exportScope;
    const results = scope === 'selection' ? selectedResults() : undefined;

    download(
        `rigging-diameters-${timestamp()}${exportSuffix()}.csv`,
        toCsv(state.calculation, results, state.threadPicks),
        'text/csv;charset=utf-8',
    );
});

exportJson.addEventListener('click', () => {
    flushPendingSearch();
    if (!exportReady() || !state.calculation || !state.settings) return;
    if (state.calculation.validationErrors.length > 0 || exportCount() === 0) return;
    const scope = state.ledger.exportScope;
    const results = scope === 'selection' ? selectedResults() : undefined;

    download(
        `rigging-diameters-${timestamp()}${exportSuffix()}.json`,
        toProjectJson(state.calculation, state.settings, undefined, {
            results,
            scope,
            conditions: scope === 'selection' ? exportConditions() : [],
            threadPicks: state.threadPicks,
        }),
        'application/json',
    );
});

exportScopeSelect.addEventListener('change', () => {
    state.ledger = setExportScope(
        state.ledger,
        exportScopeSelect.value as ExportScope,
    );
    saveLedgerView();
    updateExportAvailability();
});

function setPrefillStatus(text: string, status: '' | 'success' | 'error' = ''): void {
    modelPrefillStatus.textContent = text;
    if (status) {
        modelPrefillStatus.dataset.status = status;
    } else {
        delete modelPrefillStatus.dataset.status;
    }
}

/**
 * Заполняет размеры выбранной модели. Адаптер отдаёт только явные
 * сопоставления; остальные поля очищаются, чтобы демонстрационные значения
 * не были приняты за измерения модели. Наличие рангоута, профиль и формулы
 * не меняются.
 */
function applySelectedModelPrefill(): void {
    const model = PREFILL_BY_SLUG.get(modelPrefillSelect.value);
    if (!model) {
        setPrefillStatus('Select a model first.', 'error');
        return;
    }

    const mapped = mapModelMeasurements(model.measurements);
    if (mapped.applied.length === 0) {
        setPrefillStatus(
            `No usable dimensions were found for ${model.title}. Enter the dimensions manually.`,
            'error',
        );
        return;
    }

    for (const field of PREFILL_FIELDS) {
        const prefix = PREFILL_PREFIX_BY_FIELD[field];
        const valueMm = mapped.values[field];
        if (valueMm === undefined) {
            setValue(`${prefix}-value`, null);
            continue;
        }
        const measurement = measurementFromPrefill(valueMm);
        setValue(`${prefix}-value`, measurement.value);
        setSelect(`${prefix}-unit`, measurement.unitId);
        setSelect(`${prefix}-basis`, measurement.basis);
        state.editedDimensions.add(DIMENSION_KEYS[prefix]);
    }

    const scale = parseModelScale(model.scale);
    if (scale !== null) {
        setValue('scale', scale);
    }

    initDimState();
    captureDimensionDraft(state.activeProfile);
    syncRequiredDimensions();
    updateStepSummaries();
    markDirty();

    const appliedLabels = mapped.applied.map((entry) => PREFILL_FIELD_LABELS[entry.field]);
    const stillRequired = requiredDimensionLabels();
    const parts = [`Filled from ${model.title}: ${appliedLabels.join(', ')}.`];
    if (scale === null) {
        parts.push('The model card scale could not be read; set the scale manually.');
    }
    if (stillRequired.length > 0) {
        parts.push(`Still required by the profile: ${stillRequired.join(', ')}.`);
    }
    if (mapped.diagnostics.length > 0) {
        parts.push(mapped.diagnostics.map((entry) => entry.message).join(' '));
    }

    setPrefillStatus(parts.join(' '), stillRequired.length > 0 ? 'error' : 'success');
}

modelPrefillSelect.addEventListener('change', () => {
    const hasSelection = Boolean(PREFILL_BY_SLUG.get(modelPrefillSelect.value));
    applyModelPrefillButton.disabled = !hasSelection;
    setPrefillStatus('');
});

applyModelPrefillButton.addEventListener('click', applySelectedModelPrefill);

loadPresetButton.addEventListener('click', () => presetFile.click());

presetFile.addEventListener('change', async () => {
    const file = presetFile.files?.[0];
    if (!file) return;
    try {
        const parsed = parsePreset(await file.text(), PROFILE_VERSIONS);
        const settings = parsed.settings;
        const profile = PROFILE_DATA.get(settings.profileId)!;
        state.profileUndo = null;
        modelPrefillSelect.value = '';
        applyModelPrefillButton.disabled = true;
        setPrefillStatus('');
        applySettingsToForm(settings);
        applyProfileUi(profile);
        initDimState();
        syncDisabled();
        state.activeProfile = profile;
        for (const prefix of DIM_PREFIXES) {
            if (parseValueInput(prefix) !== null) {
                state.editedDimensions.add(DIMENSION_KEYS[prefix]);
            }
        }
        captureDimensionDraft(profile);
        syncRequiredDimensions();
        updateProfileNote();
        markDirty();
        await calculateAndRender(true);
        if (state.calculation && !state.dirty) {
            state.threadPicks.clear();
            for (const entry of parsed.threadPicks) {
                if (state.rowsByKey.has(entry.rowKey)) {
                    state.threadPicks.set(entry.rowKey, entry.pick);
                }
            }
            renderResults(state.calculation);
        }
    } catch (error) {
        renderErrors([
            {
                code: 'PRESET',
                message: `Could not load preset. ${
                    error instanceof Error ? error.message : ''
                }`,
            },
        ]);
    } finally {
        presetFile.value = '';
    }
});

form.addEventListener('submit', (event) => {
    event.preventDefault();
    syncDisabled();
    void calculateAndRender(true);
});

form.addEventListener('reset', () => {
    window.setTimeout(() => {
        const profile = selectedProfile();
        state.editedDimensions.clear();
        state.dimensionDraft = {};
        state.profileUndo = null;
        if (profile) {
            applySettingsToForm(profile.defaults);
            applyProfileUi(profile);
            state.activeProfile = profile;
            initDimState();
            captureDimensionDraft(profile);
            syncRequiredDimensions();
        }
        syncDisabled();
        updateProfileNote();
        modelPrefillSelect.value = '';
        applyModelPrefillButton.disabled = true;
        setPrefillStatus('');
        void calculateAndRender(false);
    }, 0);
});

expandStepsButton.addEventListener('click', () => {
    const steps = visibleSteps();
    const allOpen = steps.length > 0 && steps.every((step) => step.open);
    steps.forEach((step) => {
        step.open = !allOpen;
    });
    updateStepsToggle();
});

form.addEventListener('toggle', updateStepsToggle, true);

form.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'profile' || (target as HTMLInputElement).name === 'profile') return;
    const key = dimensionKeyForTarget(target);
    if (key) state.editedDimensions.add(key);
    captureDimensionDraft(state.activeProfile);
    syncRequiredDimensions();
    updateStepSummaries();
    markDirty();
});

form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'show-na') return;
    if ((target as HTMLInputElement).name === 'profile') {
        onProfileChange();
        return;
    }
    const key = dimensionKeyForTarget(target);
    if (key) state.editedDimensions.add(key);
    // Пересчитываем доступность зависимых полей сразу: иначе sail остаётся
    // доступным после снятия мачты.
    syncDisabled();
    captureDimensionDraft(state.activeProfile);
    syncRequiredDimensions();
    markDirty();
});

/* ------------------------------ ledger view ------------------------------- */

function rerender(): void {
    saveLedgerView();
    if (state.calculation) renderResults(state.calculation);
}

function applyLedger(next: LedgerState, notice: string | null = null): void {
    state.ledger = next;
    state.notice = notice;
    rerender();
}

let searchTimer = 0;
ledgerSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
        state.notice = null;
        state.searchExpansion = 'auto';
        state.ledger = setQuery(state.ledger, ledgerSearch.value);
        rerender();
    }, 140);
});

filtersToggle.addEventListener('click', () => {
    const expanded = filtersToggle.getAttribute('aria-expanded') === 'true';
    filtersToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    filtersPanel.hidden = expanded;
});

filterNode.addEventListener('change', () => {
    const change = setNode(state.ledger, filterNode.value, state.ledgerRows);
    applyLedger(change.state, change.notice);
});

filterTier.addEventListener('change', () => {
    state.notice = null;
    state.ledger = setTier(state.ledger, filterTier.value as Tier | 'all', state.ledgerRows);
    rerender();
});

filterType.addEventListener('change', () => {
    state.notice = null;
    state.ledger = setType(state.ledger, filterType.value as LedgerType | 'all');
    rerender();
});

filterStatus.addEventListener('change', () => {
    state.notice = null;
    state.ledger = setStatus(state.ledger, filterStatus.value as ResultStatus | 'all');
    rerender();
});

showNaInput.addEventListener('change', () => {
    state.notice = null;
    state.ledger = setShowNotApplicable(state.ledger, showNaInput.checked);
    rerender();
});

function switchLedgerMode(mode: LedgerMode): void {
    if (state.ledger.mode === mode) return;

    const before = ledgerControls.getBoundingClientRect().top;
    state.notice = null;
    state.ledger = setMode(state.ledger, mode);
    rerender();
    const delta = ledgerControls.getBoundingClientRect().top - before;

    // Дерево и таблица разной высоты; сохраняем позицию панели управления,
    // чтобы переключение режима не бросало страницу вверх или вниз.
    if (Math.abs(delta) > 1) {
        const root = document.documentElement;
        const previous = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollBy(0, delta);
        root.style.scrollBehavior = previous;
    }
}

modeGrouped.addEventListener('click', () => switchLedgerMode('grouped'));
modeFlat.addEventListener('click', () => switchLedgerMode('flat'));

sortSelect.addEventListener('change', () => {
    state.notice = null;
    state.ledger = setSort(state.ledger, sortSelect.value as LedgerSort);
    rerender();
});

function visibleNodeIds(): string[] {
    return [...resultsList.querySelectorAll<HTMLElement>('.rig-node')]
        .map((element) => element.dataset.node ?? '')
        .filter(Boolean);
}

function setAllSectionsOpen(open: boolean): void {
    if (state.ledger.query.trim() !== '') {
        // Во время поиска это временное состояние просмотра: очистка поиска
        // возвращает прежнюю раскладку секций.
        state.searchExpansion = open ? 'expanded' : 'collapsed';
    } else {
        state.searchExpansion = 'auto';
        state.ledger = setAllSections(state.ledger, open, visibleNodeIds());
        saveLedgerView();
    }
    resultsList.querySelectorAll<HTMLDetailsElement>('.rig-node__details').forEach((details) => {
        details.open = open;
    });
}

expandAllButton.addEventListener('click', () => setAllSectionsOpen(true));
collapseAllButton.addEventListener('click', () => setAllSectionsOpen(false));

recalculateButton.addEventListener('click', () => {
    syncDisabled();
    void calculateAndRender(true);
});

staleRecalculate.addEventListener('click', () => {
    syncDisabled();
    void calculateAndRender(true);
});

undoProfileButton.addEventListener('click', () => {
    const settings = state.profileUndo;
    if (!settings) return;
    const profile = PROFILE_DATA.get(settings.profileId);
    if (!profile) return;

    state.profileUndo = null;
    state.dimensionDraft = {};
    applySettingsToForm(settings);
    applyProfileUi(profile);
    state.activeProfile = profile;
    initDimState();
    captureDimensionDraft(profile);
    syncDisabled();
    syncRequiredDimensions();
    updateProfileNote();
    markDirty();
    document
        .querySelector<HTMLInputElement>('input[name="profile"]:checked')
        ?.focus();
});

calculationRetry.addEventListener('click', () => {
    syncDisabled();
    void calculateAndRender(true);
});

function clearAll(focusSearch: boolean): void {
    state.notice = null;
    state.searchExpansion = 'auto';
    state.ledger = clearFilters(state.ledger);
    ledgerSearch.value = '';
    rerender();
    if (focusSearch) ledgerSearch.focus();
}

clearFiltersButton.addEventListener('click', () => clearAll(false));

ledgerActive.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '.rig-condition__remove',
    );
    if (!button) return;

    const index = Number(button.dataset.index ?? '0');
    const kind = button.dataset.kind;

    if (kind === 'query') {
        ledgerSearch.value = '';
        state.searchExpansion = 'auto';
        state.ledger = setQuery(state.ledger, '');
    } else if (kind === 'node') {
        state.ledger = setNode(state.ledger, 'all', state.ledgerRows).state;
    } else if (kind === 'tier') {
        state.ledger = setTier(state.ledger, 'all', state.ledgerRows);
    } else if (kind === 'type') {
        state.ledger = setType(state.ledger, 'all');
    } else if (kind === 'status') {
        state.ledger = setStatus(state.ledger, 'all');
    } else if (kind === 'notApplicable') {
        state.ledger = setShowNotApplicable(state.ledger, false);
    }

    state.notice = null;
    rerender();

    const chips = ledgerActive.querySelectorAll<HTMLButtonElement>('.rig-condition__remove');
    const next = chips[Math.min(index, chips.length - 1)] ?? ledgerSearch;
    next.focus();
});

function toggleGroupedDetails(button: HTMLButtonElement): void {
    const id = button.getAttribute('aria-controls');
    if (!id) return;
    const body = document.getElementById(id);
    if (!body) return;

    const key = button.dataset.key;
    const row = key ? state.rowsByKey.get(key) : undefined;

    if (body.hidden) {
        if (row && body.dataset.built !== 'true') {
            body.appendChild(buildDetailsBody(row.result, row));
            body.dataset.built = 'true';
        }
        body.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Hide';
        if (button.dataset.detailContext) {
            button.setAttribute(
                'aria-label',
                `Hide details for ${button.dataset.detailContext}`,
            );
        }
    } else {
        body.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.textContent = 'Details';
        if (button.dataset.detailContext) {
            button.setAttribute(
                'aria-label',
                `Details for ${button.dataset.detailContext}`,
            );
        }
    }
}

function toggleFlatDetails(button: HTMLButtonElement): void {
    const id = button.getAttribute('aria-controls');
    if (!id) return;
    const detailsRow = document.getElementById(id) as HTMLTableRowElement | null;
    if (!detailsRow) return;

    const cell = detailsRow.querySelector<HTMLTableCellElement>('td');
    const key = button.dataset.key;
    const row = key ? state.rowsByKey.get(key) : undefined;

    if (detailsRow.hidden) {
        if (cell && row && cell.dataset.built !== 'true') {
            cell.appendChild(buildDetailsBody(row.result, row));
            cell.dataset.built = 'true';
        }
        detailsRow.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Hide';
    } else {
        detailsRow.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.textContent = 'Details';
    }
}

resultsList.addEventListener('click', (event) => {
    const actionEl = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (action === 'pick-thread') {
        event.preventDefault();
        const key = actionEl.dataset.key;
        const row = key ? state.rowsByKey.get(key) : undefined;
        if (row) openRopeModal(row, actionEl);
        return;
    }

    if (action === 'toggle-details') {
        toggleFlatDetails(actionEl as HTMLButtonElement);
        return;
    }

    if (action === 'toggle-grouped-details') {
        toggleGroupedDetails(actionEl as HTMLButtonElement);
        return;
    }

    if (action === 'clear-filters') {
        clearAll(true);
        return;
    }

    if (action === 'show-na') {
        showNaInput.checked = true;
        state.notice = null;
        state.ledger = setShowNotApplicable(state.ledger, true);
        rerender();
        ledgerSearch.focus();
    }
});

resultsList.addEventListener(
    'toggle',
    (event) => {
        const target = event.target;
        if (!(target instanceof HTMLDetailsElement)) return;

        if (target.classList.contains('rig-node__details')) {
            const nodeId = target.dataset.node ?? '';
            if (!nodeId) return;
            state.ledger = setSectionOpen(
                state.ledger,
                nodeId,
                target.open,
                state.ledger.query.trim() !== '',
            );
            saveLedgerView();
        }
    },
    true,
);

function focusThreadButton(key: string): void {
    const buttons = resultsList.querySelectorAll<HTMLButtonElement>(
        '[data-action="pick-thread"]',
    );
    for (const button of buttons) {
        if (button.dataset.key === key && button.getClientRects().length > 0) {
            button.focus();
            return;
        }
    }
    resultsSection.focus();
}

/* -------------------------------- rope modal ------------------------------ */

function setRopeTarget(targetMm: number): void {
    if (!ropeWidget) return;

    let attempts = 0;
    const apply = () => {
        const root = ropeWidget.shadowRoot;
        if (!root) {
            if (++attempts < 60) window.setTimeout(apply, 100);
            return;
        }

        const mode = root.querySelector<HTMLSelectElement>('#mode');
        const targetInput = root.querySelector<HTMLInputElement>('#target');
        if (!mode || !targetInput) return;

        const reverseOption = mode.querySelector<HTMLOptionElement>(
            'option[value="reverse"]',
        );
        // Каталог недоступен: виджет уже показывает причину в статусе.
        // Не переводим его в обратный режим, где нет ни одного варианта.
        if (reverseOption?.disabled) return;

        // Сначала фиксируем цель, потом включаем обратный режим: иначе
        // виджет успевает запросить результаты для прежней цели и в таблице
        // на мгновение появляются кнопки Use для чужого диаметра.
        targetInput.value = targetMm.toFixed(3);

        // Убираем прошлые совпадения сразу: кнопки Use не должны относиться
        // к прежней цели, пока новый запрос ещё выполняется.
        root.querySelector('[data-results]')?.replaceChildren();
        const tableWrap = root.querySelector<HTMLElement>('[data-table-wrap]');
        if (tableWrap) tableWrap.hidden = true;
        const status = root.querySelector('[data-status]');
        if (status) status.textContent = 'Searching…';

        if (mode.value !== 'reverse') {
            mode.value = 'reverse';
            mode.dispatchEvent(new Event('change'));
        } else {
            targetInput.dispatchEvent(new Event('input'));
        }
    };

    apply();
}

function openRopeModal(row: LedgerRow, invoker?: HTMLElement): void {
    const targetMm = row.result.diameterModelMm;
    if (targetMm === null) return;

    state.modalRowKey = row.key;
    state.lastFocused =
        invoker ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    ropeModalTarget.textContent =
        `Target diameter: Ø ${targetMm.toFixed(3)} mm · ` +
        `${row.result.nameEn} (${rowContext(row)})`;
    ropeModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setRopeTarget(targetMm);
    ropeModal.querySelector<HTMLButtonElement>('.rig-modal__close')?.focus();
}

function closeRopeModal(): void {
    ropeModal.hidden = true;
    document.body.style.overflow = '';
    state.modalRowKey = null;

    const previous = state.lastFocused;
    state.lastFocused = null;
    if (previous?.isConnected) previous.focus();
}

ropeModal.querySelectorAll<HTMLElement>('[data-close-rope]').forEach((element) => {
    element.addEventListener('click', closeRopeModal);
});

ropeWidget?.addEventListener('thread-select', (event) => {
    const detail = (event as CustomEvent<{ thread: ThreadMatch; targetMm: number }>).detail;
    if (!state.modalRowKey) return;

    const key = state.modalRowKey;
    const row = state.rowsByKey.get(key);
    const rowDiameterMm = row?.result.diameterModelMm ?? detail?.targetMm;
    const pick = makeThreadPick(detail?.thread, detail?.targetMm, rowDiameterMm);
    if (!pick) return;

    state.threadPicks.set(key, pick);
    closeRopeModal();
    rerender();
    focusThreadButton(key);
});

function modalFocusables(): HTMLElement[] {
    const dialog = ropeModal.querySelector('.rig-modal__dialog');
    if (!dialog) return [];

    const selector =
        'button:not([disabled]), [href], input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), summary, ' +
        '[tabindex]:not([tabindex="-1"])';

    const items = [...dialog.querySelectorAll<HTMLElement>(selector)];
    if (ropeWidget?.shadowRoot) {
        items.push(...ropeWidget.shadowRoot.querySelectorAll<HTMLElement>(selector));
    }
    return items.filter((element) => element.getClientRects().length > 0);
}

document.addEventListener('keydown', (event) => {
    if (ropeModal.hidden) return;

    if (event.key === 'Escape') {
        closeRopeModal();
        return;
    }

    if (event.key !== 'Tab') return;

    const items = modalFocusables();
    if (items.length === 0) return;

    const activeInShadow = ropeWidget?.shadowRoot?.activeElement as HTMLElement | null;
    const active = activeInShadow ?? (document.activeElement as HTMLElement | null);
    const index = active ? items.indexOf(active) : -1;

    if (event.shiftKey) {
        if (index <= 0) {
            event.preventDefault();
            items.at(-1)?.focus();
        }
        return;
    }

    if (index === -1 || index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
    }
});

/* --------------------------------- init ----------------------------------- */

ledgerSearch.value = state.ledger.query;
exportScopeSelect.value = state.ledger.exportScope;
initDimState();
setResultsState('idle');
hideStale();
for (const prefix of DIM_PREFIXES) {
    select(`${prefix}-unit`).addEventListener('change', () =>
        onDimensionUnitOrBasisChange(prefix),
    );
    select(`${prefix}-basis`).addEventListener('change', () =>
        onDimensionUnitOrBasisChange(prefix),
    );

    input(`${prefix}-value`).addEventListener('input', () => {
        const current = dimState.get(prefix);
        if (current) {
            dimState.set(prefix, { ...current, value: parseValueInput(prefix) });
        }
    });
}

const initialProfile = selectedProfile();
if (initialProfile) {
    applySettingsToForm(initialProfile.defaults);
    applyProfileUi(initialProfile);
    state.activeProfile = initialProfile;
    initDimState();
    captureDimensionDraft(initialProfile);
}
syncRequiredDimensions();
updateProfileNote();
syncDisabled();
void calculateAndRender(false);
