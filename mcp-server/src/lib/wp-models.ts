/**
 * Общая логика доступа к моделям (постройкам) и их build-логам через WPGraphQL.
 * Запросы скопированы 1:1 из src/lib/wordpress.ts основного Astro-репозитория
 * (getAllModels/getModelBySlug/getBuildPartsByModel), чтобы гарантировать
 * совместимость со схемой реальной CMS.
 */
import { requestWithTimeout } from "./graphql-client.js";

export { stripHtmlAndTruncate } from "./text.js";

export interface ModelInfo {
  manufacturer?: string | null;
  modelscale?: string | null;
  modelimageurl?: string | null;
  shortdescription?: string | null;
  historicalyear?: string | null;
  modellength?: string | null;
  totalparts?: string | null;
  buildstatus?: string[] | string | null;
  historicalnote?: string | null;
  donedate?: string | null;
}

export interface ModelNode {
  id: string;
  slug: string;
  title: string;
  modelinfo?: ModelInfo | null;
}

export interface BuildLog {
  modelslug?: string | null;
  partnumber?: string | number | null;
  partcontent?: string | null;
  recordday?: string | null;
}

export interface BuildPostNode {
  id: string;
  slug: string;
  title: string;
  content?: string | null;
  buildlog?: BuildLog | null;
}

interface GetAllModelsResponse {
  models: { nodes: ModelNode[] };
}

interface GetBuildPartsResponse {
  posts: { nodes: BuildPostNode[] };
}

const GET_ALL_MODELS = `
  query GetAllModels {
    models(first: 100) {
      nodes {
        id
        slug
        title
        modelinfo {
          manufacturer
          modelscale
          modelimageurl
          shortdescription
          historicalyear
          modellength
          totalparts
          buildstatus
          historicalnote
          donedate
        }
      }
    }
  }
`;

const GET_BUILD_PARTS = `
  query GetBuildPartsByModel {
    posts(where: { categoryName: "Builds" }, first: 100) {
      nodes {
        id
        slug
        title
        content
        buildlog {
          modelslug
          partnumber
          partcontent
          recordday
        }
      }
    }
  }
`;

/** slugify как в Astro (src/lib/wordpress.ts::slugifyStatus) — для сопоставления с enum статусов. */
export function slugifyStatus(status: string): string {
  return status.toLowerCase().trim().replace(/\s+/g, "-");
}

export function statusSlugOf(model: ModelNode): string {
  const raw = model.modelinfo?.buildstatus;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first ? slugifyStatus(first) : "";
}

export function statusTextOf(model: ModelNode): string {
  const raw = model.modelinfo?.buildstatus;
  return Array.isArray(raw) ? raw.join(", ") : raw || "";
}

/** Фильтрует модели по статусу постройки. Входной статус (например, из enum
 * инструмента, где значения содержат пробелы: "in progress") приводится к тому
 * же slug-формату, что и statusSlugOf, перед сравнением — устраняет несовпадение
 * "in-progress" (ACF slug) vs "in progress" (enum), из-за которого list_builds
 * и list_model_slugs не находили постройки со статусом "in progress". */
export function filterModelsByStatus(
    models: ModelNode[],
    status: string,
): ModelNode[] {
  const target = slugifyStatus(status);
  return models.filter((model) => statusSlugOf(model) === target);
}

let modelsCache: { data: ModelNode[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function fetchAllModels(): Promise<ModelNode[]> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL_MS) {
    return modelsCache.data;
  }

  const data = await requestWithTimeout<GetAllModelsResponse>(GET_ALL_MODELS);

  modelsCache = {
    data: data.models.nodes,
    fetchedAt: Date.now(),
  };

  return modelsCache.data;
}

/** Ищет постройку по человекочитаемому названию (buildName): точное совпадение title,
 * затем совпадение по slug (buildName приводится к виду slug), без учёта регистра. */
export function findModelByName(
    models: ModelNode[],
    buildName: string,
): ModelNode | null {
  const normalized = buildName.trim().toLowerCase();
  const bySlug = slugifyStatus(buildName);

  return (
      models.find((model) => model.title.trim().toLowerCase() === normalized) ??
      models.find((model) => model.slug.toLowerCase() === normalized) ??
      models.find((model) => model.slug.toLowerCase() === bySlug) ??
      null
  );
}

export async function fetchBuildPartsForSlug(
    slug: string,
): Promise<BuildPostNode[]> {
  const data = await requestWithTimeout<GetBuildPartsResponse>(GET_BUILD_PARTS);

  return data.posts.nodes
      .filter((post) => post.buildlog?.modelslug === slug)
      .sort(
          (a, b) =>
              Number(a.buildlog?.partnumber || 0) -
              Number(b.buildlog?.partnumber || 0),
      );
}

/**
 * Нормализует title, slug и исторический год для token-based поиска.
 *
 * Примеры:
 * - "Le Requin"  -> "le requin"
 * - "le-requin"  -> "le requin"
 * - "1750"       -> "1750"
 *
 * Благодаря этому запрос "Le Requin 1750" сопоставляется с моделью,
 * у которой title = "Le Requin", slug = "le-requin" и
 * modelinfo.historicalyear = "1750".
 */
function normalizeModelSearchText(value: string | null | undefined): string {
  return (value ?? "")
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
}

/**
 * Ищет все постройки, у которых все слова запроса встречаются в объединённом
 * контексте title, slug и historicalyear.
 *
 * В отличие от findModelByName (первое строгое совпадение), возвращает все
 * совпадения и используется list_model_slugs, чтобы явно показать клиенту
 * неоднозначность, если она есть.
 *
 * Примеры:
 * - "Le Requin"       -> Le Requin
 * - "le-requin"       -> Le Requin
 * - "Le Requin 1750"  -> Le Requin
 * - "1750"            -> все модели с historicalyear, содержащим 1750
 */
export function findModelsByNamePartial(
    models: ModelNode[],
    query: string,
): ModelNode[] {
  const terms = normalizeModelSearchText(query)
      .split(" ")
      .filter(Boolean);

  if (terms.length === 0) {
    return models;
  }

  return models.filter((model) => {
    const searchableText = normalizeModelSearchText(
        [
          model.title,
          model.slug,
          model.modelinfo?.historicalyear ?? "",
        ].join(" "),
    );

    return terms.every((term) => searchableText.includes(term));
  });
}
