export interface FilterOption {
    value: string;
    label: string;
}

export interface BuildFilterState {
    status: string[];
    period: string[];
    scale: string[];
    manufacturer: string[];
}

export interface FilterableBuildModel {
    slug: string;
    title: string;
    buildstatusText?: string;
    buildstatusClass?: string;
    modelinfo?: {
        manufacturer?: string | null;
        modelscale?: string | null;
        historicalyear?: string | null;
        buildstatus?: string[] | string | null;
    } | null;
}

export interface BuildFilterOptions {
    statuses: FilterOption[];
    periods: FilterOption[];
    scales: FilterOption[];
    manufacturers: FilterOption[];
}

function normalizeValue(value?: string | null): string {
    return String(value ?? '').trim();
}

function normalizeKey(value?: string | null): string {
    return normalizeValue(value).toLowerCase();
}

function slugify(value?: string | null): string {
    return normalizeKey(value).replace(/\s+/g, '-');
}

function uniqueSorted(options: FilterOption[]): FilterOption[] {
    const seen = new Set<string>();
    const result: FilterOption[] = [];

    for (const option of options) {
        if (!option.value || seen.has(option.value)) continue;
        seen.add(option.value);
        result.push(option);
    }

    return result.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

function parseMultiValue(searchParams: URLSearchParams, key: string): string[] {
    return [
        ...new Set(
            searchParams
                .getAll(key)
                .map((value) => normalizeKey(value))
                .filter(Boolean),
        ),
    ];
}

function extractStatusValues(model: FilterableBuildModel): string[] {
    const raw = model.modelinfo?.buildstatus;

    if (Array.isArray(raw)) {
        return raw.map((item) => slugify(item)).filter(Boolean);
    }

    if (typeof raw === 'string') {
        const normalized = slugify(raw);
        return normalized ? [normalized] : [];
    }

    const fallback = slugify(model.buildstatusClass || model.buildstatusText);
    return fallback ? [fallback] : [];
}

function extractScaleValue(model: FilterableBuildModel): string {
    return normalizeValue(model.modelinfo?.modelscale);
}

function extractManufacturerValue(model: FilterableBuildModel): string {
    return normalizeValue(model.modelinfo?.manufacturer);
}

function parseYear(yearRaw?: string | null): number | null {
    const match = normalizeValue(yearRaw).match(/-?\d{1,4}/);

    if (!match) return null;

    const year = Number(match[0]);
    return Number.isFinite(year) ? year : null;
}

export function deriveHistoricalPeriod(yearRaw?: string | null): string {
    const year = parseYear(yearRaw);

    if (year === null) return 'other-unknown';

    if (year >= 1400 && year <= 1599) return 'age-of-discovery';
    if (year >= 1600 && year <= 1699) return '17th-century';
    if (year >= 1700 && year <= 1799) return 'age-of-sail-18th';
    if (year >= 1800 && year <= 1899) return 'age-of-sail-19th';
    if (year >= 1900 && year <= 1999) return 'early-modern-20th';

    return 'other-unknown';
}

export function getHistoricalPeriodLabel(period: string): string {
    switch (period) {
        case 'age-of-discovery':
            return 'Age of Discovery · 15th–16th c.';
        case '17th-century':
            return '17th century';
        case 'age-of-sail-18th':
            return 'Age of Sail · 18th c.';
        case 'age-of-sail-19th':
            return 'Age of Sail · 19th c.';
        case 'early-modern-20th':
            return 'Early Modern · 20th c.';
        case 'other-unknown':
            return 'Other / unknown';
        default:
            return period;
    }
}

export function parseBuildFilterState(searchParams: URLSearchParams): BuildFilterState {
    return {
        status: parseMultiValue(searchParams, 'status'),
        period: parseMultiValue(searchParams, 'period'),
        scale: parseMultiValue(searchParams, 'scale'),
        manufacturer: parseMultiValue(searchParams, 'manufacturer'),
    };
}

export function getBuildStatusValues(model: FilterableBuildModel): string[] {
    return extractStatusValues(model);
}

export function collectBuildFilterOptions(models: FilterableBuildModel[]): BuildFilterOptions {
    const statuses = uniqueSorted(
        models.flatMap((model) => {
            const raw = model.modelinfo?.buildstatus;

            if (Array.isArray(raw)) {
                return raw
                    .map((item) => ({
                        value: slugify(item),
                        label: normalizeValue(item),
                    }))
                    .filter((option) => option.value && option.label);
            }

            if (typeof raw === 'string' && normalizeValue(raw)) {
                return [
                    {
                        value: slugify(raw),
                        label: normalizeValue(raw),
                    },
                ];
            }

            if (model.buildstatusClass && model.buildstatusText) {
                return [
                    {
                        value: slugify(model.buildstatusClass),
                        label: normalizeValue(model.buildstatusText),
                    },
                ];
            }

            return [];
        }),
    );

    const periods = uniqueSorted(
        models.map((model) => {
            const value = deriveHistoricalPeriod(model.modelinfo?.historicalyear);

            return {
                value,
                label: getHistoricalPeriodLabel(value),
            };
        }),
    );

    const scales = uniqueSorted(
        models
            .map((model) => extractScaleValue(model))
            .filter(Boolean)
            .map((value) => ({
                value: normalizeKey(value),
                label: value,
            })),
    );

    const manufacturers = uniqueSorted(
        models
            .map((model) => extractManufacturerValue(model))
            .filter(Boolean)
            .map((value) => ({
                value: normalizeKey(value),
                label: value,
            })),
    );

    return {
        statuses,
        periods,
        scales,
        manufacturers,
    };
}

export function applyBuildFilters(
    models: FilterableBuildModel[],
    state: BuildFilterState,
): FilterableBuildModel[] {
    return models.filter((model) => {
        const statusValues = extractStatusValues(model);
        const scaleValue = normalizeKey(extractScaleValue(model));
        const manufacturerValue = normalizeKey(extractManufacturerValue(model));
        const periodValue = deriveHistoricalPeriod(model.modelinfo?.historicalyear);

        const matchesStatus =
            state.status.length === 0 ||
            statusValues.some((value) => state.status.includes(value));

        const matchesPeriod =
            state.period.length === 0 ||
            state.period.includes(periodValue);

        const matchesScale =
            state.scale.length === 0 ||
            (scaleValue !== '' && state.scale.includes(scaleValue));

        const matchesManufacturer =
            state.manufacturer.length === 0 ||
            (manufacturerValue !== '' && state.manufacturer.includes(manufacturerValue));

        return (
            matchesStatus &&
            matchesPeriod &&
            matchesScale &&
            matchesManufacturer
        );
    });
}
