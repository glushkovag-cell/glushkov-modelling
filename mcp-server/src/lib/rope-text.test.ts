import { describe, expect, it } from "vitest";
import {
    calculateRopeText,
    findRopeThreadsText,
    formatDeviationText,
    formatDiameterText,
} from "./rope-text.js";
import type { CalculateRopeResult, FindRopeThreadsResult } from "./rope-api.js";

const calculation: CalculateRopeResult = {
    basis: "catalog",
    threadId: "tera-40",
    dtex: 750,
    diameterMm: 1.0201549921706878,
    threadsPerStrand: 2,
    strands: 3,
    construction: "2 × 3",
    catalogVersion: "0b24290aff0e",
    apiVersion: "1",
    algorithmVersion: "3.0.0",
    modelId: "log-dtex-quadratic-no-load",
    warnings: [],
};

const search: FindRopeThreadsResult = {
    targetDiameterMm: 1,
    tolerancePercent: 10,
    totalMatched: 1,
    catalogVersion: "0b24290aff0e",
    apiVersion: "1",
    algorithmVersion: "3.0.0",
    modelId: "log-dtex-quadratic-no-load",
    warnings: [],
    results: [
        {
            threadId: "tera-60",
            brand: "Tera",
            number: "60",
            dtex: 500,
            threadsPerStrand: 3,
            construction: "3 × 3",
            diameterMm: 1.0199255213596312,
            deviationPercent: 1.9925521359631215,
        },
    ],
};

describe("форматирование текста MCP", () => {
    it("диаметр выводится с тремя знаками после запятой", () => {
        expect(formatDiameterText(1.0201549921706878)).toBe("1.020");
        expect(formatDiameterText(0.05259208341950491)).toBe("0.053");
        expect(formatDiameterText(3.7881720185143406)).toBe("3.788");
    });

    it("отклонение выводится с двумя знаками без −0.00%", () => {
        expect(formatDeviationText(1.9925521359631215)).toBe("+1.99%");
        expect(formatDeviationText(-0.9282427818066208)).toBe("-0.93%");
        expect(formatDeviationText(-0.0001)).toBe("0.00%");
        expect(formatDeviationText(0)).toBe("0.00%");
    });

    it("текст расчёта содержит три знака и версию модели", () => {
        const text = calculateRopeText(calculation);

        expect(text).toContain("Rope diameter: 1.020 mm");
        expect(text).not.toContain("1.0201549921706878");
        expect(text).toContain("3.0.0 (log-dtex-quadratic-no-load)");
        expect(text).toContain("Warnings: none");
    });

    it("текст расчёта перечисляет предупреждения по коду", () => {
        const text = calculateRopeText({
            ...calculation,
            basis: "dtex",
            threadId: null,
            catalogVersion: null,
            dtex: 3750,
            warnings: [
                { code: "EXTRAPOLATION", message: "Above the measured range.", fields: ["dtex"] },
            ],
        });

        expect(text).toContain("Basis: custom dTex (catalog not used)");
        expect(text).toContain("EXTRAPOLATION: Above the measured range.");
    });

    it("текст подбора печатает совпадения и допуск", () => {
        const text = findRopeThreadsText(search);

        expect(text).toContain("1 construction within ±10% of 1.000 mm");
        expect(text).toContain("1. Tera 60 — 500 dTex, 3 × 3: 1.020 mm, +1.99%");
    });

    it("пустой подбор — успешный ответ, а не ошибка", () => {
        const text = findRopeThreadsText({ ...search, totalMatched: 0, results: [] });

        expect(text).toContain("No constructions match ±10% of 1.000 mm.");
        expect(text).toContain("valid answer, not an error");
    });

    it("structuredContent сохраняет исходное число без округления", () => {
        // Тот же объект уходит в structuredContent, поэтому точность не теряется.
        expect(calculation.diameterMm).toBe(1.0201549921706878);
        expect(search.results[0]?.diameterMm).toBe(1.0199255213596312);
    });
});
