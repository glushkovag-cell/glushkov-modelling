import { z } from "zod";
import { ROPE_LOAD_GRAMS } from "../lib/rope-api.js";

/**
 * Общие поля груза натяжения для инструментов калькулятора канатов.
 * Явный `loadMode` переключает инструмент на API v2; без него остаётся v1.
 */
export const loadModeSchema = z
    .enum(["auto", "manual"])
    .optional()
    .describe(
        "Tension load mode (API v2). 'auto' applies the recommended starting load for each construction; 'manual' applies loadGrams. " +
        "Omit to use the legacy calculation without load (API v1).",
    );

export const loadGramsSchema = z
    .union([
      z.literal(30),
      z.literal(50),
      z.literal(100),
      z.literal(150),
      z.literal(200),
      z.literal(250),
      z.literal(300),
    ])
    .optional()
    .describe(
        `Tension load in grams: one of ${ROPE_LOAD_GRAMS.join(", ")}. Required when loadMode is 'manual', not allowed otherwise. ` +
        "Only 30, 200 and 300 g were measured; other values are interpolated.",
    );

/** Проверка сочетания loadMode/loadGrams; возвращает текст ошибки или null. */
export function loadSelectionError(loadMode: string | undefined, loadGrams: number | undefined): string | null {
  if (loadMode === "manual" && loadGrams === undefined) {
    return "loadGrams is required when loadMode is 'manual'.";
  }
  if (loadMode !== "manual" && loadGrams !== undefined) {
    return "loadGrams is allowed only when loadMode is 'manual'.";
  }
  return null;
}
