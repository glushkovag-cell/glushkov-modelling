import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeJsonLd } from '../src/lib/structured-data.ts';

test('serializes a plain object unchanged', () => {
    const value = { '@type': 'Article', headline: 'Bounty' };

    assert.equal(JSON.parse(serializeJsonLd(value)).headline, 'Bounty');
});

test('escapes a closing script tag so it cannot break out of the element', () => {
    const serialized = serializeJsonLd({
        headline: '</script><img src=x onerror=alert(1)>',
    });

    assert.equal(serialized.includes('</script>'), false);
    assert.equal(serialized.includes('<img'), false);
    assert.equal(serialized.includes('\\u003c/script'), true);
});

test('stays valid JSON that round-trips to the original value', () => {
    const value = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'HMS Bounty — 1:48',
        keywords: ['wooden ship model', '<script>'],
    };

    assert.deepEqual(JSON.parse(serializeJsonLd(value)), value);
});

test('escapes the JavaScript line separators', () => {
    const serialized = serializeJsonLd({ text: 'line\u2028break\u2029here' });

    assert.equal(serialized.includes('\u2028'), false);
    assert.equal(serialized.includes('\u2029'), false);
    assert.equal(serialized.includes('\\u2028'), true);
    assert.equal(serialized.includes('\\u2029'), true);
});

test('keeps non-ASCII text readable', () => {
    const serialized = serializeJsonLd({ title: 'Blériot XI' });

    assert.equal(serialized.includes('Blériot XI'), true);
});
