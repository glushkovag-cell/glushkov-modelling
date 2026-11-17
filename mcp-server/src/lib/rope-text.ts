import type { CalculateRopeResult, FindRopeThreadsResult, RopeWarning } from "./rope-api.js";

/**
 * Текст для человека в ответе MCP.
 *
 * Числовой паритет с HTTP API держится на `structuredContent`: там те же числа
 * без округления. Здесь только форматирование: диаметр — три знака после
 * запятой, отклонение — два знака со знаком, «почти ноль» печатается как
 * 0.00% без знака, чтобы не появлялось −0.00%. Те же правила в интерфейсе.
 */

const NEAR_ZERO_PERCENT = 0.005;

/** Сколько совпадений перечислять в тексте; остальные остаются в structuredContent. */
const MAX_LISTED_MATCHES = 25;

export function formatDiameterText(diameterMm: number): string {
  return diameterMm.toFixed(3);
}

export function formatDeviationText(deviationPercent: number): string {
  if (Math.abs(deviationPercent) < NEAR_ZERO_PERCENT) {
    return "0.00%";
  }
  const sign = deviationPercent > 0 ? "+" : "";
  return `${sign}${deviationPercent.toFixed(2)}%`;
}

function modelLine(algorithmVersion: string, modelId: string): string {
  return `Model: ${algorithmVersion} (${modelId})`;
}

function warningLines(warnings: readonly RopeWarning[]): string[] {
  if (warnings.length === 0) {
    return ["Warnings: none"];
  }

  return [
    "Warnings:",
    ...warnings.map((warning) => `- ${warning.code}: ${warning.message}`),
  ];
}

/** Текстовый ответ calculate_rope_diameter. */
export function calculateRopeText(result: CalculateRopeResult): string {
  const lines = [
    `Rope diameter: ${formatDiameterText(result.diameterMm)} mm`,
    `Construction: ${result.construction} (${result.strands} strands)`,
    `Threads per strand: ${result.threadsPerStrand}`,
    `Linear density: ${result.dtex} dTex`,
  ];

  if (result.basis === "catalog") {
    lines.push(`Basis: catalog thread ${result.threadId ?? ""}`.trim());
    lines.push(`Catalog version: ${result.catalogVersion ?? "unknown"}`);
  } else {
    lines.push("Basis: custom dTex (catalog not used)");
  }

  lines.push(modelLine(result.algorithmVersion, result.modelId));
  lines.push(...warningLines(result.warnings));

  return lines.join("\n");
}

/** Текстовый ответ find_rope_threads. */
export function findRopeThreadsText(result: FindRopeThreadsResult): string {
  const target = formatDiameterText(result.targetDiameterMm);
  const header =
    result.results.length === 0
      ? `No constructions match ±${result.tolerancePercent}% of ${target} mm. ` +
        "An empty result is a valid answer, not an error."
      : `${result.totalMatched} construction` +
        `${result.totalMatched === 1 ? "" : "s"} within ±${result.tolerancePercent}% of ` +
        `${target} mm. The tolerance is a search window, not an accuracy claim.`;

  const lines = [
    header,
    `Catalog version: ${result.catalogVersion}`,
    modelLine(result.algorithmVersion, result.modelId),
  ];

  if (result.results.length > 0) {
    lines.push("");

    const listed = result.results.slice(0, MAX_LISTED_MATCHES);
    listed.forEach((match, index) => {
      lines.push(
        `${index + 1}. ${match.brand} ${match.number} — ${match.dtex} dTex, ` +
          `${match.construction}: ${formatDiameterText(match.diameterMm)} mm, ` +
          `${formatDeviationText(match.deviationPercent)}`,
      );
    });

    const omitted = result.results.length - listed.length;
    if (omitted > 0) {
      lines.push(`… and ${omitted} more; see structuredContent for the full list.`);
    }
  }

  lines.push(...warningLines(result.warnings));

  return lines.join("\n");
}
