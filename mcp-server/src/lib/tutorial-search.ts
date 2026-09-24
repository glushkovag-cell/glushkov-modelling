// mcp-server/src/lib/tutorial-search.ts
import { stripHtmlAndTruncate } from "./text.js";

const MAX_CONTENT_LENGTH = 20_000;
const EXCERPT_RADIUS = 140;

export type MatchedField = "title" | "teaser" | "content" | "tags";

export interface TutorialSearchable {
    title: string;
    teaser?: string | null;
    content?: string | null;
    // Имена тегов (display name) — нормализуются и включаются в индекс поиска
    tagNames?: string[] | null;
}

export interface TutorialTextMatch {
    matchedFields: MatchedField[];
    plainContent: string;
}

export function normalizeText(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

export function getSearchTerms(query: string): string[] {
    return normalizeText(query).split(" ").filter(Boolean);
}

export function includesAllTerms(value: string, terms: string[]): boolean {
    return terms.every((term) => value.includes(term));
}

/**
 * Ищет все слова запроса в объединённом индексе title + teaser + content + tags.
 * AND-логика: каждое слово обязано присутствовать хотя бы в одном поле в совокупности.
 *
 * matchedFields — поля, в которых найдено ХОТЯ БЫ ОДНО слово запроса
 * (не требуется, чтобы все слова были в одном поле).
 */
export function findTutorialTextMatch(
    tutorial: TutorialSearchable,
    terms: string[],
): TutorialTextMatch | null {
    const title = normalizeText(tutorial.title);
    const teaser = normalizeText(tutorial.teaser);
    const plainContent = stripHtmlAndTruncate(tutorial.content, MAX_CONTENT_LENGTH)
        .replace(/\s+/g, " ")
        .trim();
    const content = normalizeText(plainContent);

    // Теги объединяются в строку — каждое имя тега отдельным словом
    const tagsText = normalizeText((tutorial.tagNames ?? []).join(" "));

    const searchableText = `${title} ${teaser} ${content} ${tagsText}`;

    // AND-проверка по объединённому индексу: все слова должны быть где-то
    if (!includesAllTerms(searchableText, terms)) {
        return null;
    }

    // matchedFields: поля, в которых встречается хотя бы одно слово запроса.
    // Это информативнее, чем требовать все слова в одном поле.
    const fieldHit = (fieldText: string): boolean =>
        terms.some((term) => fieldText.includes(term));

    const matchedFields: MatchedField[] = [];

    if (fieldHit(title))                 matchedFields.push("title");
    if (fieldHit(teaser))                matchedFields.push("teaser");
    if (fieldHit(content))               matchedFields.push("content");
    if (tagsText && fieldHit(tagsText))  matchedFields.push("tags");

    // Гарантия: если ни одно поле не дало hit (крайний случай при пустых полях),
    // считаем совпадение по объединённому тексту как content.
    if (matchedFields.length === 0) {
        matchedFields.push("content");
    }

    return { matchedFields, plainContent };
}

export function createExcerpt(
    content: string,
    searchTerm: string,
    fallback: string | null | undefined,
): string | null {
    const text = content.replace(/\s+/g, " ").trim();
    const normalizedText = text.toLocaleLowerCase("en");
    const normalizedTerm = searchTerm.toLocaleLowerCase("en");
    const matchIndex = normalizedText.indexOf(normalizedTerm);

    if (matchIndex < 0) {
        const fallbackText = stripHtmlAndTruncate(fallback, EXCERPT_RADIUS * 2).trim();
        return fallbackText || null;
    }

    const start = Math.max(0, matchIndex - EXCERPT_RADIUS);
    const end = Math.min(
        text.length,
        matchIndex + normalizedTerm.length + EXCERPT_RADIUS,
    );

    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
        end < text.length ? "…" : ""
    }`;
}
