/**
 * Перенос пользовательских данных при смене профиля.
 *
 * Профили показывают разные наборы полей. При переключении нужно сохранить
 * размеры, которые уже введены, чтобы сравнивать профили на одних и тех же
 * данных. Поле, которого в прежнем профиле не было и для которого нет
 * сохранённого черновика, очищается и попадает в `requiredDimensions`:
 * интерфейс обязан явно отметить его как требуемое к вводу.
 *
 * Модуль чистый: без DOM и сети, поэтому перенос проверяется тестами.
 */

import type { ProfileUi } from './document.ts';
import type { ProfileRequirements } from './profiles.ts';
import { sailNodeKindsForUi, type RiggingSettings } from './settings.ts';
import { MAST_IDS, TIERS, type MastId, type Measurement, type Tier } from './types.ts';

export type DimensionKey =
    | 'mast.fore'
    | 'mast.main'
    | 'mast.mizzen'
    | 'bowsprit'
    | 'hullWidth'
    | 'gunBore';

export interface ProfileSwitchContext {
    ui: ProfileUi;
    requirements: ProfileRequirements;
}

export interface SwitchProfileParams {
    /** Текущее состояние формы до переключения. */
    current: RiggingSettings;
    /** Профиль, из которого уходим; null для первого применения. */
    previous: ProfileSwitchContext | null;
    /** Значения нового профиля по умолчанию. */
    nextDefaults: RiggingSettings;
    /** Новый профиль. */
    next: ProfileSwitchContext;
    /** Ранее введённые размеры, включая поля, скрытые в текущем профиле. */
    draft: Readonly<Partial<Record<DimensionKey, Measurement>>>;
    /** Размеры, которые пользователь действительно редактировал. */
    editedDimensions: ReadonlySet<DimensionKey>;
}

export interface SwitchProfileResult {
    settings: RiggingSettings;
    /** Размеры, которые не удалось перенести и нужно ввести заново. */
    requiredDimensions: DimensionKey[];
}

const MAST_DIMENSION: Record<MastId, DimensionKey> = {
    fore: 'mast.fore',
    main: 'mast.main',
    mizzen: 'mast.mizzen',
};

function cloneSettings(settings: RiggingSettings): RiggingSettings {
    return JSON.parse(JSON.stringify(settings)) as RiggingSettings;
}

function isPositive(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

function supportsTier(ui: ProfileUi, tier: Tier): boolean {
    return ui.tiers.includes(tier);
}

/**
 * Возвращает измерение для нового профиля. Приоритет: поле было видно в
 * прежнем профиле → сохранённый черновик → пустое значение + required.
 */
function transferDimension(
    key: DimensionKey,
    previouslyExposed: boolean,
    current: Measurement,
    fallback: Measurement,
    draft: Readonly<Partial<Record<DimensionKey, Measurement>>>,
    editedDimensions: ReadonlySet<DimensionKey>,
    required: DimensionKey[],
): Measurement {
    let result: Measurement;
    if (previouslyExposed) {
        result = { ...current };
    } else if (editedDimensions.has(key)) {
        // Пользователь уже вводил это значение в другом профиле — переносим
        // его, даже если поле сейчас было скрыто.
        const drafted = draft[key];
        result = drafted && drafted.value !== null ? { ...drafted } : { ...fallback, value: null };
    } else {
        // Поле появилось впервые: не подставляем пример, требуем ввод.
        result = { ...fallback, value: null };
    }

    if (result.value === null) required.push(key);
    return result;
}

export function switchProfileSettings(params: SwitchProfileParams): SwitchProfileResult {
    const { current, previous, nextDefaults, next, draft, editedDimensions } = params;
    const settings = cloneSettings(nextDefaults);
    const required: DimensionKey[] = [];
    const prevUi = previous?.ui ?? null;

    if (isPositive(current.scaleDenominator)) {
        settings.scaleDenominator = current.scaleDenominator;
    }

    for (const mastId of MAST_IDS) {
        const nextMast = settings.masts[mastId];
        const currentMast = current.masts[mastId];
        const defaultMast = nextDefaults.masts[mastId];

        if (!next.ui.masts) continue;

        nextMast.present = currentMast.present;

        if (supportsTier(next.ui, 'topmast') && prevUi && supportsTier(prevUi, 'topmast')) {
            nextMast.topmast = currentMast.topmast;
        } else {
            nextMast.topmast = defaultMast.topmast;
        }
        if (supportsTier(next.ui, 'topgallant') && prevUi && supportsTier(prevUi, 'topgallant')) {
            nextMast.topgallant = currentMast.topgallant;
        } else {
            nextMast.topgallant = defaultMast.topgallant;
        }

        for (const tier of TIERS) {
            if (!supportsTier(next.ui, tier)) continue;
            const sharedTier = Boolean(prevUi && supportsTier(prevUi, tier));
            if (next.ui.yards && prevUi?.yards && sharedTier) {
                nextMast.yards[tier] = currentMast.yards[tier];
            }
            if (next.ui.squareSails && prevUi?.squareSails && sharedTier) {
                nextMast.sails[tier] = currentMast.sails[tier];
            }
        }

        if (next.requirements.mast) {
            const exposed = Boolean(previous?.ui.masts && previous.requirements.mast);
            nextMast.diameter = transferDimension(
                MAST_DIMENSION[mastId],
                exposed,
                currentMast.diameter,
                defaultMast.diameter,
                draft,
                editedDimensions,
                required,
            );
        }
    }

    if (next.ui.bowsprit) {
        if (previous?.ui.bowsprit) {
            settings.bowsprit.present = current.bowsprit.present;
            // Дополнительные части бушприта переносим только тогда, когда их
            // поддерживают оба профиля. Иначе оставляем значение нового
            // профиля, а не ложное «нет» из промежуточного.
            if (next.ui.jibboom && previous.ui.jibboom) {
                settings.bowsprit.jibboom = current.bowsprit.jibboom;
                settings.bowsprit.flyingJibboom = current.bowsprit.flyingJibboom;
            }
            if (next.ui.martingale && previous.ui.martingale) {
                settings.bowsprit.martingale = current.bowsprit.martingale;
            }
            if (next.ui.spritsaill && previous.ui.spritsaill) {
                settings.bowsprit.spritsailYard = current.bowsprit.spritsailYard;
                settings.bowsprit.spritsailSail = current.bowsprit.spritsailSail;
            }
        }
        if (next.requirements.bowsprit) {
            const exposed = Boolean(previous?.ui.bowsprit && previous.requirements.bowsprit);
            settings.bowsprit.diameter = transferDimension(
                'bowsprit',
                exposed,
                current.bowsprit.diameter,
                nextDefaults.bowsprit.diameter,
                draft,
                editedDimensions,
                required,
            );
        }
    }

    if (next.ui.anchor) {
        if (previous?.ui.anchor) {
            settings.anchor = { ...current.anchor };
        }
        if (next.requirements.hullWidth) {
            const exposed = Boolean(previous?.ui.anchor && previous.requirements.hullWidth);
            settings.hullWidth = transferDimension(
                'hullWidth',
                exposed,
                current.hullWidth,
                nextDefaults.hullWidth,
                draft,
                editedDimensions,
                required,
            );
        }
    }

    if (next.ui.gun) {
        if (previous?.ui.gun) {
            settings.gun = { ...current.gun };
        }
        if (next.requirements.gunBore) {
            const exposed = Boolean(previous?.ui.gun && previous.requirements.gunBore);
            settings.gun.bore = transferDimension(
                'gunBore',
                exposed,
                current.gun.bore,
                nextDefaults.gun.bore,
                draft,
                editedDimensions,
                required,
            );
        }
    }

    if (next.ui.gaff && !next.ui.gaffSail && previous?.ui.gaff && !previous.ui.gaffSail) {
        settings.gaff = { ...current.gaff };
    }

    for (const sailClass of Object.keys(settings.foreAndAft) as Array<
        keyof RiggingSettings['foreAndAft']
    >) {
        if (
            next.ui.foreAndAft.includes(sailClass) &&
            prevUi?.foreAndAft.includes(sailClass)
        ) {
            settings.foreAndAft[sailClass] = { ...current.foreAndAft[sailClass] };
        }
    }

    if (next.ui.lateenYard && prevUi?.lateenYard) {
        settings.lateenYard = { ...current.lateenYard };
    }
    if (next.ui.hullGroup && prevUi?.hullGroup) {
        settings.hullGroup = current.hullGroup;
    }

    const nextKinds = new Set(sailNodeKindsForUi(next.ui));
    const prevKinds = new Set(prevUi ? sailNodeKindsForUi(prevUi) : []);
    for (const kind of nextKinds) {
        if (!prevKinds.has(kind)) continue;
        for (const mastId of MAST_IDS) {
            settings.sailNodes[kind][mastId] = current.sailNodes[kind][mastId];
        }
    }

    return {
        settings,
        requiredDimensions: [...new Set(required)],
    };
}
