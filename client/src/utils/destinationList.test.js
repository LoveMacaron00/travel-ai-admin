import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countDestinationStatuses,
    getVisiblePageNumbers,
    normalizeDestinationItems
} from './destinationList.js';

test('normalizes TAT destination shapes and applies the status filter', () => {
    const items = normalizeDestinationItems({
        source: 'tat',
        status: 'approved',
        adminItems: [],
        tatItems: [
            {
                placeId: 'tat-1',
                name: 'Temple',
                status: 'APPROVED',
                thumbnailUrl: ['https://example.com/temple.jpg'],
                location: { district: { name: 'เขตพระนคร' }, province: { name: 'กรุงเทพฯ' } }
            },
            { placeId: 'tat-2', name: 'Pending place', status: 'pending' }
        ]
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].province, 'เขตพระนคร, กรุงเทพฯ');
    assert.equal(items[0].image, 'https://example.com/temple.jpg');
});

test('counts statuses for only the active source', () => {
    assert.deepEqual(countDestinationStatuses({
        source: 'admin',
        tatItems: [{ status: 'approved' }],
        adminItems: [{ status: 'pending' }, { status: 'PENDING' }, { status: 'rejected' }]
    }), { pending: 2, approved: 0, rejected: 1 });
});

test('builds a stable pagination window around the current page', () => {
    assert.deepEqual(getVisiblePageNumbers(1, 10), [1, 2, 3, 4, 5]);
    assert.deepEqual(getVisiblePageNumbers(6, 10), [4, 5, 6, 7, 8]);
    assert.deepEqual(getVisiblePageNumbers(10, 10), [6, 7, 8, 9, 10]);
});
