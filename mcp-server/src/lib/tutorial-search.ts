// mcp-server/src/lib/tutorial-search.ts
import { stripHtmlAndTruncate } from "./text.js";

const MAX_CONTENT_LENGTH = 20_000;
const EXCERPT_RADIUS = 140;

// Добавлено "tags" в union
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
 * AND-логика сохранена: каждое слово обязательно должно присутствовать
 * хотя бы в одном из полей в совокупности.
 * Tags индексируются как единая строка через пробел, что позволяет найти
 * статью по имени тега даже если тег не упомянут в тексте.
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
    const tagsText = normalizeText(
        (tutorial.tagNames ?? []).join(" "),
    );

    const searchableText = `${title} ${teaser} ${content} ${tagsText}`;

    if (!includesAllTerms(searchableText, terms)) {
        return null;
    }

    const matchedFields: MatchedField[] = [];

    if (includesAllTerms(title, terms)) {
        matchedFields.push("title");
    }
    if (includesAllTerms(teaser, terms)) {
        matchedFields.push("teaser");
    }
    if (includesAllTerms(content, terms)) {
        matchedFields.push("content");
    }
    if (tagsText && includesAllTerms(tagsText, terms)) {
        matchedFields.push("tags");
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
