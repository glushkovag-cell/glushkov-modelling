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
import { formatDiameter } from '../lib/rigging/format.ts';
import { sailSelectable, tierAvailability } from '../lib/rigging/formRules.ts';
import { parsePresetJson } from '../lib/rigging/preset.ts';
import {
    CALIBRATION_LABELS,
    GROUP_LABELS,
    MAST_IDS,
    MATERIAL_LABELS,
    MEASUREMENT_LABELS,
    MEASUREMENT_POINT_LABELS,
    ORIGIN_LABELS,
    ORIGIN_SHORT_LABELS,
    OWNER_LABELS,
    OWNER_ORDER,
    REASON_LABELS,
    SAIL_CLASSES,
    STATUS_LABELS,
    TIER_LABELS,
} from '../lib/rigging/profile.ts';
import type { ProfileUi } from '../lib/rigging/document.ts';
import type {
    AnchorConnection,
    Basis,
    Calculation,
    GunType,
    MastId,
    Measurement,
    MeasurementPointId,
    MountingType,
    ResultGroup,
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

type GroupFilter = 'all' | ResultGroup;

interface ProfileCardData {
    profileId: string;
    version: string;
    ui: ProfileUi;
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

function isRussianLocale(): boolean {
    const navigatorLang = (navigator.language || '').toLowerCase();
    return navigatorLang.startsWith('ru');
}

const SHOW_RUSSIAN_NAMES = isRussianLocale();

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

/* ------------------------------ profile state ----------------------------- */

const PROFILE_DATA = new Map<string, ProfileCardData>();

document.querySelectorAll<HTMLElement>('[data-profile-card]').forEach((card) => {
    const radio = card.querySelector<HTMLInputElement>('input[name="profile"]');
    if (!radio) return;
    const ui = JSON.parse(card.dataset.ui ?? '{}') as ProfileUi;
    const defaults = JSON.parse(card.dataset.defaults ?? '{}') as RiggingSettings;
    const name = card.querySelector('strong')?.textContent?.trim() ?? radio.value;
    PROFILE_DATA.set(radio.value, {
        profileId: radio.value,
        version: card.dataset.version ?? '',
        ui,
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

function applyProfileUi(ui: ProfileUi): void {
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
        bowsprit: ui.bowsprit,
        'hull-width': ui.anchor,
        'gun-bore': ui.gun,
    };
    for (const [key, visible] of Object.entries(dimensionVisibility)) {
        const element = document.querySelector<HTMLElement>(`[data-dim="${key}"]`);
        if (element) element.hidden = !visible;
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
    activeGroup: 'all' as GroupFilter,
    showNotApplicable: false,
    dirty: false,
    formVersion: 0,
    requestSeq: 0,
    abort: undefined as AbortController | undefined,
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

function tierLabel(tier: Tier | undefined): string {
    if (!tier) return '';
    return TIER_LABELS[tier].en;
}

function metaLabel(result: RiggingResult): string {
    const group = GROUP_LABELS[result.group];
    const tier = tierLabel(result.tier);
    return tier ? `${group} · ${tier}` : group;
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

function buildDetailsBody(result: RiggingResult): HTMLDListElement {
    const dl = el('dl', 'rig-details');

    definitionText(dl, 'Formula', result.formula);
    definitionText(dl, 'Base reference', result.referenceLabel);
    definitionText(dl, 'Coefficient', result.factorLabel);
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
    definitionText(dl, 'Profile', `${result.profileId} v${result.profileVersion}`);
    definitionText(
        dl,
        'Sources',
        result.sourceIds.length > 0
            ? `${result.sourceIds.join(', ')}${result.sourceLocator ? ` · ${result.sourceLocator}` : ''}`
            : null,
    );

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

    if (result.status === 'calculated' && result.diameterModelMm !== null) {
        definitionTerm(dl, 'Choose material');
        const dd = el('dd', 'rig-details__def');
        const target = result.diameterModelMm.toFixed(3);
        const button = el('button', 'rig-link');
        button.type = 'button';
        button.textContent = `Find a model rope for Ø ${target} mm`;
        button.addEventListener('click', () => {
            openRopeModal(result.diameterModelMm);
        });
        dd.appendChild(button);
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

function createRow(result: RiggingResult): HTMLElement {
    const details = el('details', 'rig-row');
    details.dataset.status = result.status;
    details.dataset.group = result.group;

    const summaryEl = el('summary', 'rig-row__summary');

    const identity = el('span', 'rig-row__identity');
    const name = el('span', 'rig-row__name');
    name.textContent = result.nameEn;
    identity.append(name);

    if (SHOW_RUSSIAN_NAMES) {
        const nameRu = el('span', 'rig-row__ru');
        nameRu.textContent = result.nameRu;
        identity.append(nameRu);
    }

    const meta = el('span', 'rig-row__meta');
    meta.textContent = metaLabel(result);
    const material = el('span', 'rig-row__material');
    material.textContent = MATERIAL_LABELS[result.material];
    meta.appendChild(material);
    if (result.status === 'calculated') {
        const basis = el('span', `rig-row__basis rig-row__basis--${result.coefficientBasis}`);
        basis.textContent = ORIGIN_SHORT_LABELS[result.coefficientBasis];
        basis.title = ORIGIN_LABELS[result.coefficientBasis];
        meta.appendChild(basis);
    }

    const diameter = el('span', 'rig-row__diameter');
    diameter.textContent = formatDiameter(result.diameterModelMm);

    const badge = el('span', `rig-row__badge rig-row__badge--${result.status}`);
    badge.textContent = STATUS_LABELS[result.status];

    summaryEl.append(identity, meta, diameter, badge);

    const body = el('div', 'rig-row__body');
    body.appendChild(buildDetailsBody(result));

    details.append(summaryEl, body);
    return details;
}

function ownerHeading(ownerId: string): string {
    return OWNER_LABELS[ownerId] ?? ownerId;
}

function renderResults(calc: Calculation): void {
    resultsList.replaceChildren();

    const visible = calc.results.filter((result) => {
        if (state.activeGroup !== 'all' && result.group !== state.activeGroup) return false;
        if (result.status === 'not_applicable' && !state.showNotApplicable) return false;
        return true;
    });

    const calculated = visible.filter((result) => result.status === 'calculated').length;

    resultsStatus.textContent = calc.results.length
        ? `Calculated ${calculated} of ${visible.length} shown. ${calc.results.length} rows total.`
        : 'No rows produced.';

    if (visible.length === 0) {
        const empty = el('p', 'rig-results__empty');
        empty.textContent = 'No rows match the current filters.';
        resultsList.appendChild(empty);
        return;
    }

    const byOwner = new Map<string, RiggingResult[]>();
    for (const result of visible) {
        const list = byOwner.get(result.ownerId) ?? [];
        list.push(result);
        byOwner.set(result.ownerId, list);
    }

    const owners = [
        ...OWNER_ORDER.filter((ownerId) => byOwner.has(ownerId)),
        ...[...byOwner.keys()].filter((ownerId) => !OWNER_ORDER.includes(ownerId)),
    ];

    for (const ownerId of owners) {
        const rows = byOwner.get(ownerId);
        if (!rows || rows.length === 0) continue;

        const section = el('section', 'rig-group');
        const heading = el('h3', 'rig-group__title');
        heading.textContent = ownerHeading(ownerId);
        section.appendChild(heading);

        const rowsWrap = el('div', 'rig-group__rows');
        for (const result of rows) {
            rowsWrap.appendChild(createRow(result));
        }
        section.appendChild(rowsWrap);
        resultsList.appendChild(section);
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

function updateFilterUI(): void {
    document.querySelectorAll<HTMLButtonElement>('.rig-chip[data-group]').forEach((button) => {
        const active = button.dataset.group === state.activeGroup;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
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
    applySettingsToForm(profile.defaults);
    applyProfileUi(profile.ui);
    initDimState();
    syncDisabled();
    updateProfileNote();
    markDirty();
    void calculateAndRender(true);
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
        applySettingsToForm(settings);
        applyProfileUi(PROFILE_DATA.get(settings.profileId)!.ui);
        initDimState();
        syncDisabled();
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
        if (profile) {
            applySettingsToForm(profile.defaults);
            applyProfileUi(profile.ui);
        }
        initDimState();
        syncDisabled();
        updateProfileNote();
        void calculateAndRender(false);
    }, 0);
});

form.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'profile' || (target as HTMLInputElement).name === 'profile') return;
    markDirty();
});

form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'show-na') return;
    if ((target as HTMLInputElement).name === 'profile') {
        onProfileChange();
        return;
    }
    // Пересчитываем доступность зависимых полей сразу: иначе sail остаётся
    // доступным после снятия мачты.
    syncDisabled();
    markDirty();
});

document.querySelectorAll<HTMLButtonElement>('.rig-chip[data-group]').forEach((button) => {
    button.addEventListener('click', () => {
        state.activeGroup = (button.dataset.group ?? 'all') as GroupFilter;
        updateFilterUI();
        if (state.calculation) renderResults(state.calculation);
    });
});

showNaInput.addEventListener('change', () => {
    state.showNotApplicable = showNaInput.checked;
    if (state.calculation) renderResults(state.calculation);
});

/* -------------------------------- rope modal ------------------------------ */

function setRopeTarget(targetMm: number): void {
    const element = ropeModal.querySelector('gm-rope-calculator') as HTMLElement | null;
    if (!element) return;

    let attempts = 0;
    const apply = () => {
        const root = element.shadowRoot;
        if (!root) {
            if (++attempts < 60) window.setTimeout(apply, 100);
            return;
        }

        const mode = root.querySelector<HTMLSelectElement>('#mode');
        const targetInput = root.querySelector<HTMLInputElement>('#target');
        if (mode && targetInput) {
            mode.value = 'reverse';
            mode.dispatchEvent(new Event('change'));
            targetInput.value = targetMm.toFixed(3);
            targetInput.dispatchEvent(new Event('input'));
        }
    };

    apply();
}

function openRopeModal(targetMm: number | null): void {
    if (targetMm === null) return;
    ropeModalTarget.textContent = `Target diameter: Ø ${targetMm.toFixed(3)} mm`;
    ropeModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setRopeTarget(targetMm);
    ropeModal.querySelector<HTMLButtonElement>('.rig-modal__close')?.focus();
}

function closeRopeModal(): void {
    ropeModal.hidden = true;
    document.body.style.overflow = '';
}

ropeModal.querySelectorAll<HTMLElement>('[data-close-rope]').forEach((element) => {
    element.addEventListener('click', closeRopeModal);
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
    applyProfileUi(initialProfile.ui);
    initDimState();
}
updateProfileNote();
syncDisabled();
void calculateAndRender(false);
