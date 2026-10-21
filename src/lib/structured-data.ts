/**
 * structured-data.ts
 *
 * Serialization for JSON-LD blocks embedded in `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is unsafe here: a title or description containing
 * `</script>` would close the element and turn the rest of the value into
 * markup. Escaping `<` keeps the output valid JSON (it is a legal `\u003c`
 * escape) while making the sequence inert inside HTML. The two JavaScript line
 * separators are escaped as well so the payload survives any consumer that
 * evaluates it as script text.
 */

export function serializeJsonLd(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
