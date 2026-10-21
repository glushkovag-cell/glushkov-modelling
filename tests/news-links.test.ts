import test from 'node:test';
import assert from 'node:assert/strict';

import { isExternalNewsLink } from '../src/lib/news-links.ts';

const SITE = 'https://www.glushkov-modelling.com';

test('treats absolute links to another host as external', () => {
    assert.equal(isExternalNewsLink('https://youtube.com/watch?v=1', SITE), true);
    assert.equal(isExternalNewsLink('http://example.com', SITE), true);
    assert.equal(isExternalNewsLink('HTTPS://EXAMPLE.COM', SITE), true);
});

test('treats protocol-relative and mailto links as external', () => {
    assert.equal(isExternalNewsLink('//cdn.example.com/file', SITE), true);
    assert.equal(isExternalNewsLink('mailto:glushkov.ag@gmail.com', SITE), true);
});

test('treats absolute links to the site itself as internal', () => {
    // WordPress stores internal targets as absolute URLs.
    assert.equal(
        isExternalNewsLink('https://www.glushkov-modelling.com/builds/santa-maria#part-5', SITE),
        false,
    );
    assert.equal(isExternalNewsLink('https://www.glushkov-modelling.com/about', SITE), false);
});

test('treats relative routes as internal', () => {
    assert.equal(isExternalNewsLink('/builds/bounty', SITE), false);
    assert.equal(isExternalNewsLink('/gallery/all?tag=hull', SITE), false);
    assert.equal(isExternalNewsLink('#news', SITE), false);
});

test('treats empty values as internal', () => {
    assert.equal(isExternalNewsLink('', SITE), false);
    assert.equal(isExternalNewsLink('   ', SITE), false);
    assert.equal(isExternalNewsLink(null, SITE), false);
    assert.equal(isExternalNewsLink(undefined, SITE), false);
});

test('ignores surrounding whitespace', () => {
    assert.equal(isExternalNewsLink('  https://t.me/glushkov_modelling  ', SITE), true);
    assert.equal(isExternalNewsLink('  /about  ', SITE), false);
});
