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
import { parsePresetJson } from '../lib/rigging/preset.ts';
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
    isSectionOpen,
    nodeLabel,
    selectLedgerRows,
    sortLedgerRows,
    type LedgerFacets,
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
    setShowNotApplicable,
    setSort,
    setStatus,
    setTier,
    setType,
    tierFilterDisabled,
    tierFilterNote,
    type LedgerState,
} from '../lib/rigging/ledgerState.ts';
import {
    makeThreadPick,
    threadPickDetails,
    threadPickLabel,
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
    MeasurementPointId,
    MountingType,
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

const state = {
    calculation: null as Calculation | null,
    settings: null as RiggingSettings | null,
    ledgerRows: [] as LedgerRow[],
    ledger: initialLedgerState() as LedgerState,
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
    dimensionDraft: {} as Partial<Record<DimensionKey, Measurement>>,
    editedDimensions: new Set<DimensionKey>(),
};

const form = byId<HTMLFormElement>('rigging-form');
const errorsBox = byId('form-errors');
const resultsStatus = byId('results-status');
const resultsSection = byId('rig-results');
const summary = byId('summary');
const resultsList = byId('results-list');
const calculationError = byId('calculation-error');
const showNaInput = input('show-na');
const exportCsv = byId<HTMLButtonElement>('export-csv');
const exportJson = byId<HTMLButtonElement>('export-json');
const calculateButton = byId<HTMLButtonElement>('calculate');
const loadPresetButton = byId<HTMLButtonElement>('load-preset');
const presetFile = byId<HTMLInputElement>('preset-file');
const ropeModal = byId('rope-modal');
const ropeModalTarget = byId('rope-modal-target');
const ropeWidget = ropeModal.querySelector('gm-rope-calculator') as HTMLElement | null;

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
const ledgerCount = byId('ledger-count');
const filtersToggle = byId<HTMLButtonElement>('ledger-filters-toggle');
const filtersPanel = byId('ledger-filters');
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
const ledgerExpand = byId('ledger-expand');
const recalculateButton = byId<HTMLButtonElement>('recalculate');

const FIELD_TO_ID: Record<string, string> = {
    scaleDenominator: 'scale',
    'mast.fore.diameter': 'mast-fore-value',
    'mast.main.diameter': 'mast-main-value',
    'mast.mizzen.diameter': 'mast-mizzen-value',
    'bowsprit.diameter': 'bowsprit-value',
    'hull.width': 'hull-width-value',
    'gun.bore': 'gun-bore-value',
};

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

function threadControl(row: LedgerRow): HTMLElement {
    const pick = state.threadPicks.get(row.key);
    const button = el('button', 'rig-thread');
    button.type = 'button';
    button.dataset.action = 'pick-thread';
    button.dataset.key = row.key;

    if (pick) {
        button.classList.add('rig-thread--picked');
        const label = el('span', 'rig-thread__label');
        label.textContent = threadPickLabel(pick);
        const meta = el('span', 'rig-thread__meta');
        meta.textContent = `Ø ${pick.diameterMm.toFixed(3)} mm`;
        button.append(label, meta);
        button.title = threadPickDetails(pick);
        button.setAttribute(
            'aria-label',
            `Change thread for ${row.result.nameEn}: ${threadPickLabel(pick)}, ${threadPickDetails(pick)}`,
        );
    } else {
        const label = el('span', 'rig-thread__label');
        label.textContent = 'Pick thread';
        button.appendChild(label);
        button.setAttribute('aria-label', `Pick a model thread for ${row.result.nameEn}`);
    }

    return button;
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
            actionButton('Change thread', 'pick-thread', row.key),
        );
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
    const details = el('details', 'rig-row');
    details.dataset.status = result.status;
    details.dataset.group = result.group;
    details.dataset.key = row.key;

    const summaryEl = el('summary', 'rig-row__summary');

    const identity = el('span', 'rig-row__identity');
    const name = el('span', 'rig-row__name');
    appendHighlighted(name, result.nameEn, tokens);
    const nameRu = el('span', 'rig-row__ru');
    appendHighlighted(nameRu, result.nameRu, tokens);
    identity.append(name, nameRu);
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

    summaryEl.append(identity, diameter, material, badge, thread);

    const body = el('div', 'rig-row__body');
    body.dataset.built = 'false';

    details.append(summaryEl, body);
    return details;
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
    details.open = isSectionOpen(
        state.ledger.collapsedNodes,
        section.nodeId,
        state.ledger.query,
        selection.matchingNodes,
    );

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
        const toggle = actionButton('Details', 'toggle-details', row.key, 'rig-table__expand');
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

function renderLedgerToolbar(
    calc: Calculation,
    selection: LedgerSelection,
    facets: LedgerFacets,
): void {
    renderFilterOptions(facets);
    renderActiveConditions();

    showNaInput.checked = state.ledger.showNotApplicable;
    sortSelect.value = state.ledger.sort;
    modeGrouped.setAttribute('aria-pressed', state.ledger.mode === 'grouped' ? 'true' : 'false');
    modeFlat.setAttribute('aria-pressed', state.ledger.mode === 'flat' ? 'true' : 'false');

    const queryActive = state.ledger.query.trim() !== '';
    ledgerExpand.hidden = state.ledger.mode === 'flat';
    expandAllButton.disabled = queryActive;
    collapseAllButton.disabled = queryActive;
    expandAllButton.title = queryActive ? 'Collapse and expand are paused while search is active.' : '';
    collapseAllButton.title = expandAllButton.title;

    const total = selection.totalM;
    ledgerCount.textContent =
        calc.results.length === 0
            ? 'No rows in this calculation.'
            : `${selection.visible.length} of ${total} ${total === 1 ? 'row' : 'rows'}`;

    resultsStatus.textContent =
        calc.results.length === 0
            ? 'No rows produced for this configuration.'
            : `Showing ${selection.visible.length} of ${total} rows.`;
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

    renderLedgerToolbar(calc, selection, facets);
    resultsList.replaceChildren();

    if (rows.length === 0 || selection.visible.length === 0) {
        renderEmpty(calc, selection);
        return;
    }

    if (state.ledger.mode === 'flat') {
        resultsList.appendChild(createFlatTable(selection));
        return;
    }

    const head = el('div', 'rig-ledger__head');
    for (const label of ['Rope', 'Model Ø', 'Material', 'Status', 'Thread']) {
        const cell = el('span');
        cell.textContent = label;
        head.appendChild(cell);
    }
    head.setAttribute('aria-hidden', 'true');
    resultsList.appendChild(head);

    for (const section of groupedLedger(selection.visible, state.ledger.sort)) {
        resultsList.appendChild(createGroupedSection(section, selection.tokens, selection));
    }
}

function renderSummary(calc: Calculation): void {
    const counts: Array<{ status: ResultStatus; label: string }> = [
        { status: 'calculated', label: 'Calculated' },
        { status: 'needs_input', label: 'Needs input' },
        { status: 'unsupported', label: 'Unsupported' },
        { status: 'not_applicable', label: 'Not applicable' },
    ];

    summary.replaceChildren();

    for (const { status, label } of counts) {
        const count = calc.results.filter((result) => result.status === status).length;
        const item = el('div', 'rig-summary__item');
        item.dataset.status = status;

        const labelEl = el('span', 'rig-summary__label');
        labelEl.textContent = label;
        const valueEl = el('span', 'rig-summary__value');
        valueEl.textContent = String(count);

        item.append(labelEl, valueEl);
        summary.appendChild(item);
    }

    const calculated = calc.results.filter((result) => result.status === 'calculated');
    for (const basis of ['preliminary_fit', 'engineering_assumption'] as const) {
        const count = calculated.filter((result) => result.coefficientBasis === basis).length;
        const item = el('div', 'rig-summary__item');
        item.dataset.status = 'basis';

        const labelEl = el('span', 'rig-summary__label');
        labelEl.textContent = `${ORIGIN_SHORT_LABELS[basis]} rows`;
        const valueEl = el('span', 'rig-summary__value');
        valueEl.textContent = String(count);

        item.append(labelEl, valueEl);
        summary.appendChild(item);
    }
}

function calculationErrorMessage(error: unknown): string {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    return `Calculation service is unavailable.${detail} Press "Calculate diameters" to retry.`;
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
        if (firstInput) firstInput.focus();
        resultsSection.classList.add('is-stale');
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
    calculationError.hidden = true;
    calculationError.textContent = '';

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

        const exportable = calc.validationErrors.length === 0 && calc.results.length > 0;
        exportCsv.disabled = !exportable || inputsChanged;
        exportJson.disabled = !exportable || inputsChanged;

        if (inputsChanged) {
            resultsSection.classList.add('is-stale');
            calculateButton.classList.add('rig-button--attention');
        } else {
            // Ответ соответствует текущим входам: снимаем затемнение.
            resultsSection.classList.remove('is-stale');
            calculateButton.classList.remove('rig-button--attention');
        }

        if (scrollOnSuccess) scrollToResults();
    } catch (error) {
        if (controller.signal.aborted || seq !== state.requestSeq) return;

        state.dirty = true;
        resultsSection.classList.add('is-stale');
        calculateButton.classList.add('rig-button--attention');
        calculationError.textContent = calculationErrorMessage(error);
        calculationError.hidden = false;

        if (!state.calculation) {
            resultsStatus.textContent = 'Calculation unavailable.';
        }
    } finally {
        if (seq === state.requestSeq) {
            resultsSection.classList.remove('is-calculating');
            resultsSection.setAttribute('aria-busy', 'false');
        }
    }
}

function markDirty(): void {
    state.formVersion += 1;
    if (!state.calculation) return;
    state.dirty = true;
    resultsSection.classList.add('is-stale');
    calculateButton.classList.add('rig-button--attention');
    exportCsv.disabled = true;
    exportJson.disabled = true;
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

exportCsv.addEventListener('click', () => {
    if (!state.calculation) return;
    download(
        `rigging-diameters-${timestamp()}.csv`,
        toCsv(state.calculation),
        'text/csv;charset=utf-8',
    );
});

exportJson.addEventListener('click', () => {
    if (!state.calculation || !state.settings) return;
    download(
        `rigging-diameters-${timestamp()}.json`,
        toProjectJson(state.calculation, state.settings),
        'application/json',
    );
});

loadPresetButton.addEventListener('click', () => presetFile.click());

presetFile.addEventListener('change', async () => {
    const file = presetFile.files?.[0];
    if (!file) return;
    try {
        const settings = parsePresetJson(await file.text(), PROFILE_VERSIONS);
        const profile = PROFILE_DATA.get(settings.profileId)!;
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
    } catch (error) {
        calculationError.textContent = `Could not load preset. ${error instanceof Error ? error.message : ''}`;
        calculationError.hidden = false;
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
        void calculateAndRender(false);
    }, 0);
});

form.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'profile' || (target as HTMLInputElement).name === 'profile') return;
    const key = dimensionKeyForTarget(target);
    if (key) state.editedDimensions.add(key);
    captureDimensionDraft(state.activeProfile);
    syncRequiredDimensions();
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

modeGrouped.addEventListener('click', () => {
    state.notice = null;
    state.ledger = setMode(state.ledger, 'grouped');
    rerender();
});

modeFlat.addEventListener('click', () => {
    state.notice = null;
    state.ledger = setMode(state.ledger, 'flat');
    rerender();
});

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
    state.ledger = setAllSections(state.ledger, open, visibleNodeIds());
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

function clearAll(focusSearch: boolean): void {
    state.notice = null;
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

function populateRowDetails(details: HTMLDetailsElement): void {
    const key = details.dataset.key;
    const body = details.querySelector<HTMLElement>('.rig-row__body');
    if (!key || !body || body.dataset.built === 'true') return;

    const row = state.rowsByKey.get(key);
    if (!row) return;

    body.appendChild(buildDetailsBody(row.result, row));
    body.dataset.built = 'true';
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
        if (row) openRopeModal(row);
        return;
    }

    if (action === 'toggle-details') {
        toggleFlatDetails(actionEl as HTMLButtonElement);
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

        if (target.classList.contains('rig-row')) {
            if (target.open) populateRowDetails(target);
            return;
        }

        if (target.classList.contains('rig-node__details')) {
            const nodeId = target.dataset.node ?? '';
            if (!nodeId) return;
            state.ledger = setSectionOpen(
                state.ledger,
                nodeId,
                target.open,
                state.ledger.query.trim() !== '',
            );
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

function openRopeModal(row: LedgerRow): void {
    const targetMm = row.result.diameterModelMm;
    if (targetMm === null) return;

    state.modalRowKey = row.key;
    state.lastFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

    const pick = makeThreadPick(detail?.thread, detail?.targetMm);
    if (!pick) return;

    const key = state.modalRowKey;
    state.threadPicks.set(key, pick);
    closeRopeModal();
    rerender();
    focusThreadButton(key);
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ropeModal.hidden) {
        closeRopeModal();
    }
});

/* --------------------------------- init ----------------------------------- */

initDimState();
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
