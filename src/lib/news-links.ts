/**
 * news-links.ts
 *
 * News entries can point to an internal route ("/builds/bounty") or to an
 * external source (YouTube, Telegram, a press release). The cards used to add
 * `target="_blank"` to every link, so internal destinations opened in a new tab
 * and left the navigation history behind.
 */

export function isExternalNewsLink(
    url: string | null | undefined,
    siteOrigin: string,
): boolean {
    const value = (url ?? '').trim();

    if (!value) {
        return false;
    }

    if (/^mailto:/i.test(value)) {
        return true;
    }

    try {
        const target = new URL(value, siteOrigin);
        const site = new URL(siteOrigin);

        return target.host !== site.host;
    } catch {
        return false;
    }
}
