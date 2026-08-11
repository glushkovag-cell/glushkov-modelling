/**
 * Общая логика доступа к моделям (постройкам) и их build-логам через WPGraphQL.
 * Запросы скопированы 1:1 из src/lib/wordpress.ts основного Astro-репозитория
 * (getAllModels/getModelBySlug/getBuildPartsByModel), чтобы гарантировать
 * совместимость со схемой реальной CMS.
 */
import { requestWithTimeout } from "./graphql-client.js";

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

let modelsCache: { data: ModelNode[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function fetchAllModels(): Promise<ModelNode[]> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL_MS) {
    return modelsCache.data;
  }
  const data = await requestWithTimeout<GetAllModelsResponse>(GET_ALL_MODELS);
  modelsCache = { data: data.models.nodes, fetchedAt: Date.now() };
  return modelsCache.data;
}

/** Ищет постройку по человекочитаемому названию (buildName): точное совпадение title,
 * затем совпадение по slug (buildName приводится к виду slug), без учёта регистра. */
export function findModelByName(models: ModelNode[], buildName: string): ModelNode | null {
  const normalized = buildName.trim().toLowerCase();
  const bySlug = slugifyStatus(buildName);

  return (
    models.find((m) => m.title.trim().toLowerCase() === normalized) ??
    models.find((m) => m.slug.toLowerCase() === normalized) ??
    models.find((m) => m.slug.toLowerCase() === bySlug) ??
    null
  );
}

export async function fetchBuildPartsForSlug(slug: string): Promise<BuildPostNode[]> {
  const data = await requestWithTimeout<GetBuildPartsResponse>(GET_BUILD_PARTS);
  return data.posts.nodes
    .filter((post) => post.buildlog?.modelslug === slug)
    .sort((a, b) => Number(a.buildlog?.partnumber || 0) - Number(b.buildlog?.partnumber || 0));
}

/** Убирает HTML-теги и обрезает текст до заданной длины — для компактных ответов инструментов. */
export function stripHtmlAndTruncate(html: string | null | undefined, maxLength = 300): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}
