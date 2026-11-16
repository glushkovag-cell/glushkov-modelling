import test from 'node:test';
import assert from 'node:assert/strict';

import {
    THREAD_PICK_TOLERANCE_MM,
    makeThreadPick,
    threadPickDetails,
    threadPickLabel,
    threadPickNeedsReview,
    threadPickReviewNote,
    type ThreadMatch,
} from '../src/lib/rigging/threadPick.ts';

const MATCH: ThreadMatch = {
    threadId: 'mara-50',
    brand: 'Mara',
    number: '50',
    dtex: 600,
    threadsPerStrand: 4,
    diameterMm: 1.269,
    deviationPercent: -0.11,
};

test('a thread pick stores the widget result, target and row diameter', () => {
    const pick = makeThreadPick(MATCH, 1.27, 1.27);
    assert.ok(pick);
    assert.equal(pick.threadId, 'mara-50');
    assert.equal(pick.targetMm, 1.27);
    assert.equal(pick.rowDiameterMm, 1.27);
    assert.equal(threadPickLabel(pick), 'Mara 50');
    assert.match(threadPickDetails(pick), /600 dTex · 4 × 3 · Ø 1.269 mm · -0.11%/);
});

test('invalid matches and diameters are rejected', () => {
    assert.equal(makeThreadPick(null, 1), null);
    assert.equal(makeThreadPick({ ...MATCH, threadId: '' }, 1), null);
    assert.equal(makeThreadPick({ ...MATCH, brand: 1 as unknown as string }, 1), null);
    assert.equal(makeThreadPick({ ...MATCH, dtex: Number.NaN }, 1), null);
    assert.equal(makeThreadPick(MATCH, 0), null);
    assert.equal(makeThreadPick(MATCH, 1, Number.NaN), null);
    assert.equal(makeThreadPick(MATCH, 1, 0), null);
});

test('review is not required while the row diameter is unchanged', () => {
    const pick = makeThreadPick(MATCH, 1.27, 1.27);
    assert.ok(pick);
    assert.equal(threadPickNeedsReview(pick, 1.27), false);
    assert.equal(threadPickReviewNote(pick, 1.27), null);
    assert.equal(threadPickNeedsReview(pick, 1.27 + THREAD_PICK_TOLERANCE_MM / 2), false);
});

test('review is required after a diameter change and explains it', () => {
    const pick = makeThreadPick(MATCH, 1.27, 1.27);
    assert.ok(pick);
    assert.equal(threadPickNeedsReview(pick, 1.5), true);
    const note = threadPickReviewNote(pick, 1.5);
    assert.match(note ?? '', /changed from 1\.270 mm to 1\.500 mm/);
});

test('review is required when the thread was picked for another target', () => {
    const pick = makeThreadPick(MATCH, 2, 1.27);
    assert.ok(pick);
    assert.equal(threadPickNeedsReview(pick, 1.27), true);
    const note = threadPickReviewNote(pick, 1.27);
    assert.match(note ?? '', /chosen for a 2\.000 mm target/);
    assert.match(note ?? '', /row diameter 1\.270 mm/);
});

test('a missing current diameter forces a review', () => {
    const pick = makeThreadPick(MATCH, 1.27, 1.27);
    assert.ok(pick);
    assert.equal(threadPickNeedsReview(pick, null), true);
    assert.match(threadPickReviewNote(pick, null) ?? '', /no calculated diameter/);
});
