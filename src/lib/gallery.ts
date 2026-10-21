import {
  deriveHistoricalPeriod,
  getHistoricalPeriodLabel,
} from './modelFilters';
import { fetchWithRetry } from './fetch-retry';
import { getAllModels } from './wordpress';

/**
 * gallery.ts — build-time helpers for loading gallery manifests
 * and building client-side filter indexes.
 *
 * Supported manifest formats:
 *
 * v1:
 * - schemaVersion is missing or equals 1;
 * - image.section is a string.
 *
 * v2:
 * - schemaVersion equals 2;
 * - image.section or image.sections is an array of taxonomy slugs;
 * - optional legacySection, review and suggested fields.
 *
 * Both formats are normalized to GalleryImage.sections: string[].
 */

export interface GalleryImagePaths {
  lowRes: string | null;
  hiRes: string | null;
}

/**
 * Image as it appears in manifest.json.
 *
 * Both section and sections are accepted because existing manifests use
 * section while the v2 data contract defines sections.
 */
export interface RawGalleryImage {
  file: string;
  order: number;
  section?: string | string[];
  sections?: string[];
  legacySection?: string;
  review?: boolean;
  suggested?: string[];
  caption: string;
  alt: string;
  lead: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

/** Normalized image used by gallery pages. */
export interface GalleryImage {
  file: string;
  order: number;

  /**
   * Always an array.
   *
   * A v1 string is wrapped in an array.
   * Missing or empty values become [].
   */
  sections: string[];

  /** First section or null, retained for the existing single-label UI. */
  section: string | null;

  legacySection: string | null;
  review: boolean;
  suggested: string[];
  caption: string;
  alt: string;
  lead: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

export interface GalleryBreadcrumb {
  label: string;
  href: string;
}

export interface GalleryMeta {
  status: string;
  focus: string;
  viewerMode: string;
}

/** Manifest as it appears in manifest.json. */
export interface RawGalleryManifest {
  schemaVersion?: 1 | 2;
  slug: string;
  title: string;
  scale: string;
  galleryTitle: string;
  buildLogUrl: string;
  breadcrumbs: GalleryBreadcrumb[];
  meta: GalleryMeta;
  images: RawGalleryImage[];
}

/** Normalized manifest used by gallery pages. */
export interface GalleryManifest
    extends Omit<RawGalleryManifest, 'schemaVersion' | 'images'> {
  schemaVersion: 1 | 2;
  images: GalleryImage[];
}

/** Model entry used by the /gallery hub. */
export interface GalleryIndexEntry {
  slug: string;
  title: string;
  scale: string;
  period: string;
  cover: GalleryImage | null;
  imageCount: number;

  /** Union of valid active taxonomy slugs across the model images. */
  sections: string[];
}

/** Term from index/taxonomy.json. */
export interface GalleryTaxonomyTerm {
  slug: string;
  name: string;
  facet: string;
  appliesTo: string[];
  status: 'active' | 'deprecated' | 'hidden';

  /**
   * Retained because it exists in taxonomy.json.
   * Gallery filtering intentionally does not use this field.
   */
  publicFilter?: {
    gallery?: boolean;
    tutorials?: boolean;
  };
}

/** Structure of index/taxonomy.json. */
export interface GalleryTaxonomy {
  version: number;
  facets: string[];
  terms: GalleryTaxonomyTerm[];
}

export interface GalleryFilterOption {
  value: string;
  label: string;
}

export interface GalleryFilterTag {
  slug: string;
  name: string;
}

export interface GalleryFilterGroup {
  facet: string;
  tags: GalleryFilterTag[];
}

/** One filterable model or photo in an embedded client-side index. */
export interface GalleryFilterIndexItem {
  model: string;
  period: string;
  scale: string;
  tags: string[];
}

/**
 * Filter index embedded into a gallery page as:
 *
 * <script type="application/json">
 */
export interface GalleryFilterIndex {
  groups: GalleryFilterGroup[];
  periods: GalleryFilterOption[];
  scales: GalleryFilterOption[];
  byTag: Record<string, string[]>;
  items: Record<string, GalleryFilterIndexItem>;
}

/**
 * The gallery hub needs two indexes:
 *
 * models:
 * - item key is the model slug;
 * - used to determine model-card visibility.
 *
 * photos:
 * - item key is model/file;
 * - used to calculate the exact N of M photo summary.
 */
export interface GalleryFilterIndexes {
  models: GalleryFilterIndex;
  photos: GalleryFilterIndex;
}

/**
 * Minimal WordPress model shape required for period calculation.
 *
 * It is intentionally structural and does not depend on the private
 * NormalizedModel interface from wordpress.ts.
 */
interface GalleryModelPeriodSource {
  slug: string;
  modelinfo?: {
    historicalyear?: string | null;
  } | null;
}

const CMS_GALLERY_URL = (
    import.meta.env.CMS_GALLERY_URL || ''
).replace(/\/$/, '');

if (!CMS_GALLERY_URL) {
  throw new Error('CMS_GALLERY_URL is not set');
}

function buildCmsUrl(path: string): string {
  return `${CMS_GALLERY_URL}/${path.replace(/^\//, '')}`;
}

function absolutizeAsset(path: string | null): string | null {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const cleaned = path
      .replace(/^\/+/, '')
      .replace(/^gallery\/+/, '');

  return buildCmsUrl(cleaned);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
        (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
    );
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  return [];
}

function normalizeFilterValue(value?: string | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function detectVersion(manifest: RawGalleryManifest): 1 | 2 {
  if (manifest.schemaVersion === 2) {
    return 2;
  }

  if (
      manifest.schemaVersion === undefined ||
      (manifest.schemaVersion as number) === 1
  ) {
    return 1;
  }

  console.warn(
      `[gallery] unknown schemaVersion ${String(
          manifest.schemaVersion,
      )} in "${manifest.slug}", treating as v2`,
  );

  return 2;
}

function normalizeImage(image: RawGalleryImage): GalleryImage {
  const sections = [
    ...new Set([
      ...toStringArray(image.sections),
      ...toStringArray(image.section),
    ]),
  ];

  return {
    file: image.file,
    order: image.order,
    sections,
    section: sections[0] ?? null,
    legacySection:
        typeof image.legacySection === 'string'
            ? image.legacySection
            : null,
    review: image.review === true,
    suggested: toStringArray(image.suggested),
    caption: image.caption,
    alt: image.alt,
    lead: image.lead,
    orientation: image.orientation,
    width: image.width,
    height: image.height,
    paths: {
      lowRes: absolutizeAsset(image.paths?.lowRes ?? null),
      hiRes: absolutizeAsset(image.paths?.hiRes ?? null),
    },
  };
}

function normalizeManifest(
    manifest: RawGalleryManifest,
): GalleryManifest {
  const {
    schemaVersion: _ignored,
    images,
    ...rest
  } = manifest;

  return {
    ...rest,
    schemaVersion: detectVersion(manifest),
    images: (Array.isArray(images) ? images : []).map(
        normalizeImage,
    ),
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetchWithRetry(url, {}, {
      attempts: 2,
      timeoutMs: 10_000,
      onRetry: ({ attempt, attempts, delayMs, reason }) => {
        console.warn(
            `[gallery] ${url}: ${reason}; attempt ${attempt}/${attempts}, ` +
            `retrying in ${delayMs} ms`,
        );
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function createModelMap(
    models: GalleryModelPeriodSource[],
): Map<string, GalleryModelPeriodSource> {
  return new Map(
      models.map((model) => [model.slug, model]),
  );
}

/**
 * Resolves the historical period of a gallery model.
 *
 * If the model is absent from WordPress, or historicalyear cannot be
 * mapped, the period is other-unknown and a build warning is emitted.
 */
function resolveModelPeriod(
    slug: string,
    models: Map<string, GalleryModelPeriodSource>,
    warnedModels: Set<string>,
): string {
  const model = models.get(slug);

  if (!model) {
    if (!warnedModels.has(slug)) {
      console.warn(
          `[gallery] model "${slug}" was not found in WordPress; ` +
          'period set to other-unknown',
      );

      warnedModels.add(slug);
    }

    return 'other-unknown';
  }

  const historicalYear = model.modelinfo?.historicalyear;
  const period = deriveHistoricalPeriod(historicalYear);

  if (
      period === 'other-unknown' &&
      !warnedModels.has(slug)
  ) {
    const reason = historicalYear
        ? `historicalyear "${historicalYear}" does not map to a known period`
        : 'modelinfo.historicalyear is empty';

    console.warn(
        `[gallery] model "${slug}" has no known historical period: ${reason}`,
    );

    warnedModels.add(slug);
  }

  return period;
}

function createFilterOptions(
    items: GalleryFilterIndexItem[],
    field: 'period' | 'scale',
): GalleryFilterOption[] {
  const labels = new Map<string, string>();

  for (const item of items) {
    const value = item[field];

    if (!value || labels.has(value)) {
      continue;
    }

    labels.set(
        value,
        field === 'period'
            ? getHistoricalPeriodLabel(value)
            : value,
    );
  }

  return [...labels.entries()]
      .map(([value, label]) => ({
        value,
        label,
      }))
      .sort((a, b) =>
          a.label.localeCompare(b.label, 'en'),
      );
}

/**
 * Builds filter groups from active taxonomy terms.
 *
 * publicFilter is intentionally ignored. A taxonomy term is available
 * when and only when status === "active".
 */
function createFilterGroups(
    taxonomy: GalleryTaxonomy | null,
): GalleryFilterGroup[] {
  if (!taxonomy) {
    return [];
  }

  const activeTerms = taxonomy.terms.filter(
      (term) => term.status === 'active',
  );

  /**
   * Preserve the order from taxonomy.facets.
   * If an active term uses a facet missing from that array, append it.
   */
  const facetOrder = [
    ...taxonomy.facets,
    ...activeTerms
        .map((term) => term.facet)
        .filter(
            (facet) => !taxonomy.facets.includes(facet),
        ),
  ];

  return [...new Set(facetOrder)]
      .map((facet) => ({
        facet,
        tags: activeTerms
            .filter((term) => term.facet === facet)
            .map((term) => ({
              slug: term.slug,
              name: term.name,
            })),
      }))
      .filter((group) => group.tags.length > 0);
}

function createFilterIndex(
    groups: GalleryFilterGroup[],
    items: Record<string, GalleryFilterIndexItem>,
): GalleryFilterIndex {
  const byTag: Record<string, string[]> = {};

  for (const group of groups) {
    for (const tag of group.tags) {
      byTag[tag.slug] = [];
    }
  }

  for (const [key, item] of Object.entries(items)) {
    for (const tag of item.tags) {
      if (byTag[tag]) {
        byTag[tag].push(key);
      }
    }
  }

  const itemValues = Object.values(items);

  return {
    groups,
    periods: createFilterOptions(
        itemValues,
        'period',
    ),
    scales: createFilterOptions(
        itemValues,
        'scale',
    ),
    byTag,
    items,
  };
}

/**
 * Returns only active and known taxonomy terms assigned to an image.
 *
 * Unknown and inactive terms are excluded and reported during build.
 * Each invalid term is reported only once per index-building operation.
 */
function collectValidImageTags(
    manifest: GalleryManifest,
    image: GalleryImage,
    allTerms: Map<string, GalleryTaxonomyTerm>,
    activeTerms: Set<string>,
    warnedTerms: Set<string>,
): string[] {
  const validTags: string[] = [];

  for (const slug of image.sections) {
    const term = allTerms.get(slug);

    if (!term) {
      if (!warnedTerms.has(slug)) {
        console.warn(
            `[gallery] unknown taxonomy term "${slug}" in ` +
            `${manifest.slug}/${image.file}; excluded from filter index`,
        );

        warnedTerms.add(slug);
      }

      continue;
    }

    if (!activeTerms.has(slug)) {
      if (!warnedTerms.has(slug)) {
        console.warn(
            `[gallery] inactive taxonomy term "${slug}" ` +
            `(${term.status}) in ${manifest.slug}/${image.file}; ` +
            'excluded from filter index',
        );

        warnedTerms.add(slug);
      }

      continue;
    }

    validTags.push(slug);
  }

  return [...new Set(validTags)];
}

export async function getAllGallerySlugs(): Promise<
    string[]
> {
  const list = await fetchJson<string[]>(
      buildCmsUrl('index/models.json'),
  );

  return Array.isArray(list) ? list : [];
}

async function readManifest(
    slug: string,
): Promise<GalleryManifest | null> {
  const manifest =
      await fetchJson<RawGalleryManifest>(
          buildCmsUrl(`${slug}/manifest.json`),
      );

  return manifest
      ? normalizeManifest(manifest)
      : null;
}

export async function getGalleryManifest(
    slug: string,
): Promise<GalleryManifest | null> {
  return readManifest(slug);
}

/**
 * Loads all manifests listed in index/models.json.
 * Missing or unreadable manifests are skipped.
 */
export async function getAllGalleryManifests(): Promise<
    GalleryManifest[]
> {
  const slugs = await getAllGallerySlugs();

  const manifests = await Promise.all(
      slugs.map((slug) => readManifest(slug)),
  );

  return manifests.filter(
      (
          manifest,
      ): manifest is GalleryManifest =>
          manifest !== null,
  );
}

/**
 * Loads the taxonomy dictionary from:
 *
 * ${CMS_GALLERY_URL}/index/taxonomy.json
 */
export async function getGalleryTaxonomy(): Promise<
    GalleryTaxonomy | null
> {
  const data = await fetchJson<GalleryTaxonomy>(
      buildCmsUrl('index/taxonomy.json'),
  );

  if (
      !data ||
      !Array.isArray(data.terms) ||
      !Array.isArray(data.facets)
  ) {
    console.warn(
        '[gallery] index/taxonomy.json is missing or malformed; ' +
        'tag indexes will be empty',
    );

    return null;
  }

  return data;
}

/**
 * Builds the existing model entries used by the /gallery hub.
 *
 * The entry now contains:
 *
 * - period derived from WordPress modelinfo.historicalyear;
 * - sections containing only known active taxonomy terms.
 */
export async function getAllGalleryEntries(): Promise<
    GalleryIndexEntry[]
> {
  const [
    manifests,
    wordpressModels,
    taxonomy,
  ] = await Promise.all([
    getAllGalleryManifests(),
    getAllModels(),
    getGalleryTaxonomy(),
  ]);

  const modelMap = createModelMap(
      wordpressModels,
  );

  const warnedModels = new Set<string>();
  const warnedTerms = new Set<string>();

  const allTerms = new Map(
      (taxonomy?.terms ?? []).map((term) => [
        term.slug,
        term,
      ]),
  );

  const activeTerms = new Set(
      (taxonomy?.terms ?? [])
          .filter(
              (term) => term.status === 'active',
          )
          .map((term) => term.slug),
  );

  return manifests.map((manifest) => {
    const sorted = [...manifest.images].sort(
        (a, b) => a.order - b.order,
    );

    const cover =
        sorted.find((image) => image.lead) ??
        sorted[0] ??
        null;

    const sections = [
      ...new Set(
          manifest.images.flatMap((image) =>
              collectValidImageTags(
                  manifest,
                  image,
                  allTerms,
                  activeTerms,
                  warnedTerms,
              ),
          ),
      ),
    ];

    return {
      slug: manifest.slug,
      title: manifest.title,
      scale: manifest.scale,
      period: resolveModelPeriod(
          manifest.slug,
          modelMap,
          warnedModels,
      ),
      cover,
      imageCount: manifest.images.length,
      sections,
    } satisfies GalleryIndexEntry;
  });
}

/**
 * Builds both indexes required by the Gallery hub.
 *
 * models.items:
 * - key: model slug;
 * - tags: union of tags assigned to the model photos;
 * - used to show or hide model cards.
 *
 * photos.items:
 * - key: model/file;
 * - tags: tags assigned to that individual photo;
 * - used to calculate the exact N of M summary.
 */
export function buildGalleryFilterIndexes(
    manifests: GalleryManifest[],
    taxonomy: GalleryTaxonomy | null,
    wordpressModels: GalleryModelPeriodSource[],
): GalleryFilterIndexes {
  const groups = createFilterGroups(taxonomy);

  const modelMap = createModelMap(
      wordpressModels,
  );

  const allTerms = new Map(
      (taxonomy?.terms ?? []).map((term) => [
        term.slug,
        term,
      ]),
  );

  const activeTerms = new Set(
      (taxonomy?.terms ?? [])
          .filter(
              (term) => term.status === 'active',
          )
          .map((term) => term.slug),
  );

  const warnedModels = new Set<string>();
  const warnedTerms = new Set<string>();

  const modelItems: Record<
      string,
      GalleryFilterIndexItem
  > = {};

  const photoItems: Record<
      string,
      GalleryFilterIndexItem
  > = {};

  for (const manifest of manifests) {
    const period = resolveModelPeriod(
        manifest.slug,
        modelMap,
        warnedModels,
    );

    const scale = normalizeFilterValue(
        manifest.scale,
    );

    const modelTags = new Set<string>();

    for (const image of manifest.images) {
      const tags = collectValidImageTags(
          manifest,
          image,
          allTerms,
          activeTerms,
          warnedTerms,
      );

      for (const tag of tags) {
        modelTags.add(tag);
      }

      photoItems[
          `${manifest.slug}/${image.file}`
          ] = {
        model: manifest.slug,
        period,
        scale,
        tags,
      };
    }

    modelItems[manifest.slug] = {
      model: manifest.slug,
      period,
      scale,
      tags: [...modelTags],
    };
  }

  return {
    models: createFilterIndex(
        groups,
        modelItems,
    ),
    photos: createFilterIndex(
        groups,
        photoItems,
    ),
  };
}

/**
 * Loads all build-time sources and returns indexes ready to embed
 * into a page as application/json.
 */
export async function getGalleryFilterIndexes(): Promise<
    GalleryFilterIndexes
> {
  const [
    manifests,
    taxonomy,
    wordpressModels,
  ] = await Promise.all([
    getAllGalleryManifests(),
    getGalleryTaxonomy(),
    getAllModels(),
  ]);

  return buildGalleryFilterIndexes(
      manifests,
      taxonomy,
      wordpressModels,
  );
}
