/**
 * Паритет MCP с калькулятором сайта /tools/rigging-diameters.
 *
 * Сайт строит узлы в src/lib/rigging/settings.ts (buildInput); MCP — в
 * src/lib/rigging-config.ts (buildRiggingInput). Тест берёт все документы
 * профилей из data/rigging/profiles, строит вход обоими способами и сравнивает
 * узлы, а затем — результат общего ядра (src/lib/rigging/calculate.ts, тот же
 * код, что в Worker'е). Тест живёт вне src/, чтобы tsc сборки MCP не тянул
 * файлы сайта.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildInput,
  defaultSettingsForProfile,
  type RiggingSettings,
} from "../../src/lib/rigging/settings.ts";
import { calculate } from "../../src/lib/rigging/calculate.ts";
import type { ProfileDocument as SiteProfileDocument } from "../../src/lib/rigging/document.ts";

import {
  MAST_IDS,
  SAIL_CLASSES,
  SAIL_NODE_KINDS,
  TIERS,
  buildRiggingInput,
  exampleConfiguration,
  type ShipConfiguration,
} from "../src/lib/rigging-config.js";
import type { ProfileUi } from "../src/lib/rigging-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const profilesDir = resolve(here, "../../data/rigging/profiles");

function loadDocuments(): SiteProfileDocument[] {
  const documents: SiteProfileDocument[] = [];
  for (const profileId of readdirSync(profilesDir)) {
    for (const file of readdirSync(join(profilesDir, profileId))) {
      if (!file.endsWith(".json")) continue;
      documents.push(JSON.parse(readFileSync(join(profilesDir, profileId, file), "utf8")));
    }
  }
  return documents;
}

/** Переводит настройки формы сайта в компактную конфигурацию MCP. */
function settingsToConfiguration(settings: RiggingSettings): ShipConfiguration {
  const config: ShipConfiguration = {
    profileId: settings.profileId,
    profileVersion: settings.profileVersion ?? null,
    scaleDenominator: settings.scaleDenominator,
    masts: {},
  };

  for (const mastId of MAST_IDS) {
    const mast = settings.masts[mastId];
    if (!mast.present) continue;
    config.masts![mastId] = {
      diameter: { ...mast.diameter, value: mast.diameter.value ?? 0 },
      topmast: mast.topmast,
      topgallant: mast.topgallant,
      yards: TIERS.filter((tier) => mast.yards[tier]),
      squareSails: TIERS.filter((tier) => mast.sails[tier]),
      sailNodes: SAIL_NODE_KINDS.filter((kind) => settings.sailNodes[kind]?.[mastId]),
    };
  }

  const foreAndAft = SAIL_CLASSES.filter((sailClass) => settings.foreAndAft[sailClass].present).map(
    (sailClass) => ({ sailClass, supportingMastId: settings.foreAndAft[sailClass].supportingMastId }),
  );
  if (foreAndAft.length > 0) config.foreAndAftSails = foreAndAft;

  if (settings.gaff.present) {
    config.gaff = { supportingMastId: settings.gaff.supportingMastId, sailPresent: settings.gaff.sailPresent };
  }
  if (settings.lateenYard.present) {
    config.lateenYard = {
      supportingMastId: settings.lateenYard.supportingMastId,
      sailPresent: settings.lateenYard.sailPresent,
    };
  }
  if (settings.bowsprit.present) {
    const spar = settings.bowsprit;
    config.bowsprit = {
      diameter: { ...spar.diameter, value: spar.diameter.value ?? 0 },
      jibboom: spar.jibboom,
      flyingJibboom: spar.flyingJibboom,
      martingale: spar.martingale,
      spritsailYard: spar.spritsailYard,
      spritsailSail: spar.spritsailSail,
    };
  }
  if (settings.hullGroup) config.hullGroup = true;
  if (settings.anchor.present) {
    config.anchor = { connection: settings.anchor.connection };
  }
  config.hullWidth = { ...settings.hullWidth, value: settings.hullWidth.value ?? 0 };
  if (settings.gun.present) {
    config.gun = {
      gunType: settings.gun.gunType,
      mountingType: settings.gun.mountingType,
      bore: { ...settings.gun.bore, value: settings.gun.bore.value ?? 0 },
    };
  }
  return config;
}

/** Детерминированный ГПСЧ (mulberry32), чтобы перебор был воспроизводимым. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutate(base: RiggingSettings, next: () => number): RiggingSettings {
  const settings: RiggingSettings = structuredClone(base);
  const flip = (): boolean => next() < 0.5;
  const pickMast = () => MAST_IDS[Math.floor(next() * MAST_IDS.length)]!;

  for (const mastId of MAST_IDS) {
    const mast = settings.masts[mastId];
    mast.present = next() < 0.8;
    mast.topmast = flip();
    mast.topgallant = flip();
    for (const tier of TIERS) {
      mast.yards[tier] = flip();
      mast.sails[tier] = flip();
    }
    for (const kind of SAIL_NODE_KINDS) settings.sailNodes[kind][mastId] = flip();
  }
  // Без грот-мачты поведение намеренно расходится с формой сайта (см. тест ниже).
  settings.masts.main.present = true;
  for (const sailClass of SAIL_CLASSES) {
    settings.foreAndAft[sailClass] = { present: flip(), supportingMastId: pickMast() };
  }
  settings.gaff = { present: flip(), sailPresent: flip(), supportingMastId: pickMast() };
  settings.lateenYard = { present: flip(), sailPresent: flip(), supportingMastId: pickMast() };
  settings.bowsprit = {
    ...settings.bowsprit,
    present: flip(),
    jibboom: flip(),
    flyingJibboom: flip(),
    martingale: flip(),
    spritsailYard: flip(),
    spritsailSail: flip(),
  };
  settings.hullGroup = flip();
  settings.anchor = { present: flip(), connection: flip() ? "fiber" : "chain" };
  settings.gun = { ...settings.gun, present: flip(), gunType: flip() ? "carriage_gun" : "carronade" };
  return settings;
}

/** Значимые для ядра поля: результаты без трассировки текстовых подписей нет смысла фильтровать. */
function resultsOf(calculation: ReturnType<typeof calculate>) {
  return {
    validationErrors: calculation.validationErrors,
    results: calculation.results.map((row) => ({
      nodeId: row.nodeId,
      ruleId: row.ruleId,
      status: row.status,
      reasonCode: row.reasonCode,
      diameterModelMm: row.diameterModelMm,
      diameterPrototypeMm: row.diameterPrototypeMm,
    })),
  };
}

const documents = loadDocuments();

describe("rigging parity with the website calculator", () => {
  it("covers every profile document in data/rigging/profiles", () => {
    expect(documents.length).toBeGreaterThanOrEqual(4);
  });

  for (const document of documents) {
    const label = `${document.profile.profileId}@${document.profile.profileVersion}`;

    it(`${label}: exampleConfiguration reproduces the website form defaults`, () => {
      const siteInput = buildInput(defaultSettingsForProfile(document));
      const mcpInput = buildRiggingInput(
        exampleConfiguration(
          document.profile.profileId,
          document.profile.profileVersion,
          document.profile.ui as unknown as ProfileUi,
        ),
      );

      expect(mcpInput.nodes).toEqual(siteInput.nodes);
      expect(mcpInput.scaleDenominator).toBe(siteInput.scaleDenominator);
      expect(mcpInput.profileVersion).toBe(siteInput.profileVersion);

      // Измерения отсутствующих узлов ядро не использует, поэтому сравнивается результат.
      expect(resultsOf(calculate(mcpInput as never, document))).toEqual(
        resultsOf(calculate(siteInput, document)),
      );
    });

    it(`${label}: without a mainmast, MCP does not borrow the diameter of an absent mast`, () => {
      // Форма сайта отправляет диаметры всех трёх мачт, даже отключённых, а ядро
      // для базы thickestMast без scope берёт грот-мачту. MCP передаёт только
      // измерения существующих мачт, поэтому такие строки получают needs_input,
      // а не диаметр несуществующей мачты.
      const settings = defaultSettingsForProfile(document);
      settings.masts.main.present = false;

      const mcpInput = buildRiggingInput(settingsToConfiguration(settings));
      expect(mcpInput.nodes).toEqual(buildInput(settings).nodes);
      expect(mcpInput.measurements.mastDiameter.main).toBeUndefined();

      const rows = calculate(mcpInput as never, document).results;
      for (const row of rows.filter((entry) => entry.missingInputIds.includes("mast.main.diameter"))) {
        expect(row.status).toBe("needs_input");
        expect(row.diameterModelMm).toBeNull();
      }
    });

    it(`${label}: random configurations build the same nodes and results`, () => {
      const next = random(document.profile.profileVersion.length * 7919 + document.profile.profileId.length);
      const base = defaultSettingsForProfile(document);

      for (let index = 0; index < 150; index += 1) {
        const settings = mutate(base, next);
        const siteInput = buildInput(settings);
        const mcpInput = buildRiggingInput(settingsToConfiguration(settings));

        expect(mcpInput.nodes).toEqual(siteInput.nodes);
        expect(resultsOf(calculate(mcpInput as never, document))).toEqual(
          resultsOf(calculate(siteInput, document)),
        );
      }
    });
  }
});
