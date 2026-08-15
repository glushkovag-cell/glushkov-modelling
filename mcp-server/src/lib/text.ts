/** Убирает HTML-теги и обрезает текст до заданной длины. */
export function stripHtmlAndTruncate(
    html: string | null | undefined,
    maxLength = 300,
): string {
    if (!html) return "";

    const text = html
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    return text.length > maxLength
        ? `${text.slice(0, maxLength).trim()}…`
        : text;
}