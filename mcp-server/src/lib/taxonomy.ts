/**
 * Единый справочник таксономии Gallery / Tutorials.
 *
 * Источник — термины WordPress-таксономии TutorialTags с ACF-группой
 * Tutorial Tag Settings (поле tagSettings в WPGraphQL). Используются поля
 * slug, name (с учётом prefferedLabel), facet и status.
 *
 * Справочник общий для статей и галереи: фотографии в manifest.json
 * ссылаются на те же slug, что и теги статей.
 */
import { requestWithTimeout } from "./graphql-client.js";

export const TAXONOMY_FACETS = [
  "component",
  "technique",
  "material",
  "context",
  "view",
] as const;

export type TaxonomyFacet = (typeof TAXONOMY_FACETS)[number];

export const TAXONOMY_STATUSES = ["active", "deprecated", "hidden"] as const;

export type TaxonomyStatus = (typeof TAXONOMY_STATUSES)[number];

export interface TaxonomyTerm {
  slug: string;
  /** Отображаемое имя: ACF prefferedLabel, иначе имя термина WordPress. */
  name: string;
  /** null — facet не задан или не входит в TAXONOMY_FACETS. */
  facet: TaxonomyFacet | null;
  status: TaxonomyStatus;
  /** ACF public: показывать ли тег в UI-фильтрах Tutorials. */
  publicFilter: boolean;
}

/** Сырые данные термина из WPGraphQL. */
export interface RawTaxonomyTermNode {
  slug: string;
  name: string;
  tagSettings?: {
    facet?: string[] | string | null;
    status?: string[] | string | null;
    public?: boolean | null;
    prefferedLabel?: string | null;
  } | null;
}

interface TutorialTagsPageResponse {
  tutorialTags: {
    nodes: RawTaxonomyTermNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/**
 * hideEmpty: false обязателен — теги, назначенные только фотографиям
 * галереи (например, facet view), не имеют статей и иначе будут скрыты.
 * WPGraphQL ограничивает first сотней элементов, поэтому читаем постранично.
 */
const TUTORIAL_TAGS_DICTIONARY_QUERY = `
  query GetTaxonomyDictionary($after: String) {
    tutorialTags(first: 100, after: $after, where: { hideEmpty: false }) {
      nodes {
        slug
        name
        tagSettings {
          facet
          status
          public
          prefferedLabel
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const MAX_PAGES = 20;

function firstValue(raw: string[] | string | null | undefined): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim().toLowerCase();
  return String(raw ?? "").trim().toLowerCase();
}

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeTaxonomyFacet(
    raw: string[] | string | null | undefined,
): TaxonomyFacet | null {
  const value = firstValue(raw);
  return (TAXONOMY_FACETS as readonly string[]).includes(value)
      ? (value as TaxonomyFacet)
      : null;
}

/** Отсутствующий статус считается active — так же, как в activeTagsOf(). */
export function normalizeTaxonomyStatus(
    raw: string[] | string | null | undefined,
): TaxonomyStatus {
  const value = firstValue(raw);
  return (TAXONOMY_STATUSES as readonly string[]).includes(value)
      ? (value as TaxonomyStatus)
      : "active";
}

export function normalizeTaxonomyTerm(node: RawTaxonomyTermNode): TaxonomyTerm {
  const label = node.tagSettings?.prefferedLabel?.trim();

  return {
    slug: normalizeSlug(node.slug),
    name: label || node.name,
    facet: normalizeTaxonomyFacet(node.tagSettings?.facet),
    status: normalizeTaxonomyStatus(node.tagSettings?.status),
    publicFilter: node.tagSettings?.public === true,
  };
}

export interface TaxonomyDictionary {
  terms: TaxonomyTerm[];
  bySlug: Map<string, TaxonomyTerm>;
  /** Поиск по отображаемому имени (без учёта регистра) — для удобства клиентов. */
  byName: Map<string, TaxonomyTerm>;
}

export function buildTaxonomyDictionary(terms: TaxonomyTerm[]): TaxonomyDictionary {
  const bySlug = new Map<string, TaxonomyTerm>();
  const byName = new Map<string, TaxonomyTerm>();

  for (const term of terms) {
    bySlug.set(term.slug, term);
    const key = term.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, term);
  }

  return { terms, bySlug, byName };
}

/**
 * Приводит значение фильтра к slug справочника: принимает slug или
 * отображаемое имя (регистр не важен). Неизвестные значения возвращаются
 * нормализованными, чтобы фильтр применялся точно (и давал пустую выдачу).
 */
export function resolveTagValue(
    value: string,
    dictionary: TaxonomyDictionary | null,
): { slug: string; term: TaxonomyTerm | null } {
  const normalized = normalizeSlug(value);

  if (!dictionary) return { slug: normalized, term: null };

  const term =
      dictionary.bySlug.get(normalized) ?? dictionary.byName.get(normalized) ?? null;

  return { slug: term?.slug ?? normalized, term };
}

let dictionaryCache: { data: TaxonomyDictionary; fetchedAt: number } | null = null;

/** Справочник меняется редко; короткий кэш согласован с fetchAllTutorials. */
const DICTIONARY_CACHE_TTL_MS = 5 * 60_000;

export async function fetchTaxonomyDictionary(): Promise<TaxonomyDictionary> {
  if (
      dictionaryCache &&
      Date.now() - dictionaryCache.fetchedAt < DICTIONARY_CACHE_TTL_MS
  ) {
    return dictionaryCache.data;
  }

  const nodes: RawTaxonomyTermNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response: TutorialTagsPageResponse =
        await requestWithTimeout<TutorialTagsPageResponse>(
            TUTORIAL_TAGS_DICTIONARY_QUERY,
            { after },
        );

    nodes.push(...(response.tutorialTags?.nodes ?? []));

    const pageInfo = response.tutorialTags?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  const data = buildTaxonomyDictionary(nodes.map(normalizeTaxonomyTerm));
  dictionaryCache = { data, fetchedAt: Date.now() };
  return data;
}

/** Только для тестов. */
export function resetTaxonomyCache(): void {
  dictionaryCache = null;
}
