/**
 * Клиентский контроллер калькулятора толщин такелажа.
 *
 * Читает форму, собирает компактную конфигурацию, вызывает чистое ядро и
 * рисует ведомость. Формул и коэффициентов здесь нет — только перенос данных
 * между DOM и расчётным ядром.
 */

import { calculate } from '../lib/rigging/calculate.ts';
import {
    buildInput,
    type RiggingSettings,
} from '../lib/rigging/settings.ts';
import { findSuitableProfiles } from '../lib/rigging/profiles.ts';
import { toCsv, toProjectJson } from '../lib/rigging/export.ts';
import { formatDiameter } from '../lib/rigging/format.ts';
import {
    CALIBRATION_LABELS,
    GROUP_LABELS,
    MAST_IDS,
    MEASUREMENT_LABELS,
    ORIGIN_LABELS,
    OWNER_LABELS,
    REASON_LABELS,
    SAIL_CLASSES,
    STATUS_LABELS,
    TIER_LABELS,
} from '../lib/rigging/profile.ts';
import type {
    AnchorConnection,
    Basis,
    Calculation,
    GunType,
    HistoricalContext,
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
import { PROFILE_ID } from '../lib/rigging/types.ts';

const MAST_IDS_LIST = MAST_IDS as readonly MastId[];
const SAIL_CLASSES_LIST = SAIL_CLASSES as readonly SailClass[];

type GroupFilter = 'all' | ResultGroup;

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
    return input(id).checked;
}

function isRussianLocale(): boolean {
    // Русские подписи показываются, если язык браузера пользователя русский.
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
    /** Полная точность в текущих единицах и режиме; округляется только в UI. */
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
 * сохраняется, а число пересчитывается с полной точностью. Округление до двух
 * знаков выполняется только при записи в поле; внутреннее значение в dimState
 * остаётся точным, поэтому при многократных переключениях ошибка не
 * накапливается.
 */
function onDimensionUnitOrBasisChange(prefix: DimPrefix): void {
    const previous = dimState.get(prefix);
    const next = readUnitBasis(prefix);

    if (!previous) {
        dimState.set(prefix, { ...next, value: parseValueInput(prefix) });
        return;
    }

    if (previous.unit === next.unit && previous.basis === next.basis) {
        return;
    }

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

function readMast(mastId: MastId): RiggingSettings['masts'][MastId] {
    return {
        present: checked(`mast-${mastId}-present`),
        diameter: readMeasurement(
            `mast-${mastId}`,
            select(`mast-${mastId}-point`).value as MeasurementPointId,
        ),
        topmast: checked(`mast-${mastId}-topmast`),
        topgallant: checked(`mast-${mastId}-topgallant`),
        yards: {
            lower: checked(`mast-${mastId}-yard-lower`),
            topmast: checked(`mast-${mastId}-yard-topmast`),
            topgallant: checked(`mast-${mastId}-yard-topgallant`),
        },
        sails: {
            lower: checked(`mast-${mastId}-sail-lower`),
            topmast: checked(`mast-${mastId}-sail-topmast`),
            topgallant: checked(`mast-${mastId}-sail-topgallant`),
        },
    };
}

function readContextMode(): 'year' | 'period' {
    const checked = document.querySelector<HTMLInputElement>(
        'input[name="context-mode"]:checked',
    );
    return checked && checked.value === 'period' ? 'period' : 'year';
}

function readProfileId(): string {
    const checked = document.querySelector<HTMLInputElement>(
        'input[name="profile"]:checked',
    );
    return checked ? checked.value : PROFILE_ID;
}

function readHistoricalContext(): HistoricalContext {
    const mode = readContextMode();
    const parseYear = (id: string): number | null => {
        const raw = input(id).value.trim();
        if (raw === '') return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    };

    if (mode === 'year') {
        return {
            mode: 'year',
            year: parseYear('context-year'),
            periodFrom: null,
            periodTo: null,
        };
    }

    return {
        mode: 'period',
        year: null,
        periodFrom: parseYear('context-period-from'),
        periodTo: parseYear('context-period-to'),
    };
}

function readSettings(): RiggingSettings {
    return {
        profileId: readProfileId(),
        historicalContext: readHistoricalContext(),
        scaleDenominator: Number(input('scale').value.trim().replace(',', '.')),
        masts: {
            fore: readMast('fore'),
            main: readMast('main'),
            mizzen: readMast('mizzen'),
        },
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
    };
}

const state = {
    calculation: null as Calculation | null,
    settings: null as RiggingSettings | null,
    activeGroup: 'all' as GroupFilter,
    showNotApplicable: false,
    dirty: false,
    rendering: false,
};

const form = byId<HTMLFormElement>('rigging-form');
const errorsBox = byId('form-errors');
const resultsStatus = byId('results-status');
const resultsSection = byId('rig-results');
const summary = byId('summary');
const resultsList = byId('results-list');
const showNaInput = input('show-na');
const exportCsv = byId<HTMLButtonElement>('export-csv');
const exportJson = byId<HTMLButtonElement>('export-json');
const calculateButton = byId<HTMLButtonElement>('calculate');
const ropeModal = byId('rope-modal');
const ropeModalTarget = byId('rope-modal-target');

function setDisabled(id: string, disabled: boolean): void {
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (element) element.disabled = disabled;
}

function syncDisabled(): void {
    for (const mastId of MAST_IDS_LIST) {
        const present = checked(`mast-${mastId}-present`);
        const topmast = present && checked(`mast-${mastId}-topmast`);
        const topgallant = topmast && checked(`mast-${mastId}-topgallant`);

        for (const suffix of ['-value', '-unit', '-basis', '-point']) {
            setDisabled(`mast-${mastId}${suffix}`, !present);
        }
        setDisabled(`mast-${mastId}-topmast`, !present);
        setDisabled(`mast-${mastId}-topgallant`, !topmast);

        setDisabled(`mast-${mastId}-yard-lower`, !present);
        setDisabled(`mast-${mastId}-yard-topmast`, !topmast);
        setDisabled(`mast-${mastId}-yard-topgallant`, !topgallant);

        setDisabled(`mast-${mastId}-sail-lower`, !checked(`mast-${mastId}-yard-lower`));
        setDisabled(`mast-${mastId}-sail-topmast`, !checked(`mast-${mastId}-yard-topmast`));
        setDisabled(`mast-${mastId}-sail-topgallant`, !checked(`mast-${mastId}-yard-topgallant`));
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
}

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
    definitionText(dl, 'Profile', `${result.profileId} v${result.profileVersion}`);

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

    const summary = el('summary', 'rig-row__summary');

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
    if (result.status === 'calculated') {
        const estimate = el('span', 'rig-row__estimate');
        estimate.textContent = 'Estimate';
        meta.appendChild(estimate);
    }

    const diameter = el('span', 'rig-row__diameter');
    diameter.textContent = formatDiameter(result.diameterModelMm);

    const badge = el('span', `rig-row__badge rig-row__badge--${result.status}`);
    badge.textContent = STATUS_LABELS[result.status];

    summary.append(identity, meta, diameter, badge);

    const body = el('div', 'rig-row__body');
    body.appendChild(buildDetailsBody(result));

    details.append(summary, body);
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

    const ownerOrder = ['fore', 'main', 'mizzen', 'bowsprit', 'anchor_group', 'gun_group'];
    const byOwner = new Map<string, RiggingResult[]>();

    for (const result of visible) {
        const list = byOwner.get(result.ownerId) ?? [];
        list.push(result);
        byOwner.set(result.ownerId, list);
    }

    for (const ownerId of ownerOrder) {
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
}

function calculateAndRender(): void {
    state.rendering = true;

    resultsSection.classList.remove('is-stale');
    resultsSection.classList.add('is-calculating');
    resultsSection.setAttribute('aria-busy', 'true');

    const settings = readSettings();
    const calc = calculate(buildInput(settings));

    state.calculation = calc;
    state.settings = settings;
    state.dirty = false;

    calculateButton.classList.remove('rig-button--attention');

    renderErrors(calc.validationErrors);
    renderSummary(calc);
    renderResults(calc);

    const exportable = calc.validationErrors.length === 0 && calc.results.length > 0;
    exportCsv.disabled = !exportable;
    exportJson.disabled = !exportable;

    state.rendering = false;

    window.setTimeout(() => {
        resultsSection.classList.remove('is-calculating');
        resultsSection.setAttribute('aria-busy', 'false');
    }, 320);
}

function markDirty(): void {
    if (state.rendering || !state.calculation) return;
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

exportCsv.addEventListener('click', () => {
    if (!state.calculation) return;
    download(`rigging-diameters-${timestamp()}.csv`, toCsv(state.calculation), 'text/csv;charset=utf-8');
});

exportJson.addEventListener('click', () => {
    if (!state.calculation || !state.settings) return;
    download(
        `rigging-diameters-${timestamp()}.json`,
        toProjectJson(state.calculation, state.settings),
        'application/json',
    );
});

form.addEventListener('submit', (event) => {
    event.preventDefault();
    syncDisabled();
    calculateAndRender();
});

form.addEventListener('reset', () => {
    window.setTimeout(() => {
        initDimState();
        syncDisabled();
        calculateAndRender();
    }, 0);
});

form.addEventListener('input', markDirty);
form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'show-na') return;
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

function syncContextModeFields(): void {
    const isPeriod = readContextMode() === 'period';
    byId('context-year-field').hidden = isPeriod;
    byId('context-period-field').hidden = !isPeriod;
}

function updateProfileContextNote(): void {
    const context = readHistoricalContext();
    const matches = findSuitableProfiles(context);
    const note = byId('profile-context-note');

    const inRange = matches.filter((match) => match.match === 'in_range').length;
    const partial = matches.filter((match) => match.match === 'partial_overlap').length;
    const drafts = matches.filter((match) => match.match === 'draft_unconfirmed').length;

    const publishedPart = `Published profiles: ${inRange} in range${partial ? `, ${partial} partial` : ''}.`;
    const draftPart = drafts ? ` ${drafts} draft profile(s) shown for explicit selection.` : '';

    if (context.mode === 'year' && context.year !== null) {
        note.textContent = `Context: ${context.year} (year). ${publishedPart}${draftPart}`;
        return;
    }
    if (context.mode === 'period' && context.periodFrom !== null && context.periodTo !== null) {
        note.textContent =
            `Context: ${context.periodFrom}–${context.periodTo} (period). ${publishedPart}${draftPart}`;
        return;
    }
    note.textContent = 'Enter a year or period. The profile covers 1625–1860 (James Lees).';
}

document.querySelectorAll<HTMLInputElement>('input[name="context-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        syncContextModeFields();
        updateProfileContextNote();
    });
});

byId('find-profiles').addEventListener('click', updateProfileContextNote);

syncContextModeFields();
updateProfileContextNote();

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

initDimState();
for (const prefix of DIM_PREFIXES) {
    select(`${prefix}-unit`).addEventListener('change', () => onDimensionUnitOrBasisChange(prefix));
    select(`${prefix}-basis`).addEventListener('change', () => onDimensionUnitOrBasisChange(prefix));

    input(`${prefix}-value`).addEventListener('input', () => {
        const current = dimState.get(prefix);
        if (current) {
            dimState.set(prefix, { ...current, value: parseValueInput(prefix) });
        }
    });
}

syncDisabled();
calculateAndRender();
