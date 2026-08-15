import { stripHtmlAndTruncate } from "./text.js";

const MAX_CONTENT_LENGTH = 20_000;
const EXCERPT_RADIUS = 140;

export type MatchedField = "title" | "teaser" | "content";

export interface TutorialSearchable {
    title: string;
    teaser?: string | null;
    content?: string | null;
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
 * Ищет все слова запроса в объединённом индексе title + teaser + content.
 * Это позволяет найти статью, если разные слова запроса оказались в разных
 * полях, но сохраняет AND-логику: каждое слово обязательно должно присутствовать.
 */
export function findTutorialTextMatch(
    tutorial: TutorialSearchable,
    terms: string[],
): TutorialTextMatch | null {
    const title = normalizeText(tutorial.title);
    const teaser = normalizeText(tutorial.teaser);
    const plainContent = stripHtmlAndTruncate(
        tutorial.content,
        MAX_CONTENT_LENGTH,
    )
        .replace(/\s+/g, " ")
        .trim();
    const content = normalizeText(plainContent);

    const searchableText = `${title} ${teaser} ${content}`;

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

    return {
        matchedFields,
        plainContent,
    };
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
        const fallbackText = stripHtmlAndTruncate(
            fallback,
            EXCERPT_RADIUS * 2,
        ).trim();

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