const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizePlanPlaces,
    sanitizePlaceholderPlanImages,
} = require('../controllers/helpers/planPlaceNormalizer');

const places = [{
    id: 48,
    name: 'วัดร่องเสือเต้น',
    image_url: 'https://dmc.tatdataapi.io/assets/blue-temple.jpeg',
    latitude: '19.92339',
    longitude: '99.84179',
}];

test('allows trips that do not have generated plan data yet', () => {
    assert.equal(normalizePlanPlaces(null, places), null);
});

test('replaces AI media and coordinates with the matched database destination', () => {
    const plan = {
        days: [{
            stops: [{
                destinationId: '2',
                place: 'วัดร่องเสือเต้น',
                imageUrl: 'https://example.com/fake.jpg',
                latitude: 0,
                longitude: 0,
            }],
        }],
    };

    normalizePlanPlaces(plan, places);

    assert.deepEqual(plan.days[0].stops[0], {
        destinationId: '48',
        place: 'วัดร่องเสือเต้น',
        imageUrl: 'https://dmc.tatdataapi.io/assets/blue-temple.jpeg',
        latitude: 19.92339,
        longitude: 99.84179,
    });
});

test('removes stops invented outside the retrieved database destinations', () => {
    const plan = {
        days: [{
            stops: [{
                destinationId: 'N/A',
                place: 'สถานที่ที่ไม่มีในฐานข้อมูล',
                imageUrl: 'https://example.com/invented.jpg',
            }],
        }],
    };

    normalizePlanPlaces(plan, places);

    assert.deepEqual(plan.days, []);
});

test('keeps only matched database stops when AI mixes grounded and invented places', () => {
    const plan = {
        days: [{
            stops: [
                {
                    destinationId: '48',
                    place: 'วัดร่องเสือเต้น',
                    imageUrl: 'https://example.com/fake.jpg',
                },
                {
                    destinationId: 'N/A',
                    place: 'สถานที่ที่ AI คิดเพิ่ม',
                    imageUrl: 'https://example.com/invented.jpg',
                },
            ],
        }],
    };

    normalizePlanPlaces(plan, places);

    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].stops.length, 1);
    assert.equal(plan.days[0].stops[0].destinationId, '48');
    assert.equal(
        plan.days[0].stops[0].imageUrl,
        'https://dmc.tatdataapi.io/assets/blue-temple.jpeg',
    );
});

test('sanitizes placeholder images when an older stored plan is read', () => {
    const plan = {
        days: [{
            stops: [
                { imageUrl: 'https://example.com/invented.jpg' },
                { imageUrl: 'https://dmc.tatdataapi.io/assets/real.jpg' },
            ],
        }],
    };

    sanitizePlaceholderPlanImages(plan);

    assert.equal(plan.days[0].stops[0].imageUrl, '');
    assert.equal(
        plan.days[0].stops[1].imageUrl,
        'https://dmc.tatdataapi.io/assets/real.jpg',
    );
});
