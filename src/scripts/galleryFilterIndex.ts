import type { GalleryFilterIndex } from '../lib/gallery';
import { isGalleryFilterIndex } from './galleryFilterEngine';

/** Missing or malformed JSON returns null: all photos stay visible. */
export function readFilterIndex(elementId: string): GalleryFilterIndex | null {
    const element = document.getElementById(elementId);
    if (!element?.textContent) return null;

    try {
        const data: unknown = JSON.parse(element.textContent);
        if (isGalleryFilterIndex(data)) return data;
    } catch {
        /* fall through */
    }

    console.warn('[gallery] photo index is missing or malformed; showing all photos');
    return null;
}
