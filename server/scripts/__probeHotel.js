const { config } = require('../config/env');
const { tatHeadersFor } = require('../utils/tatLanguage');

const s = (v, n = 200) => String(v === undefined ? '‹undef›' : JSON.stringify(v)).slice(0, n);

(async () => {
  for (const [label, cat, ids] of [
    ['hotel', 'accommodation', [15664, 1584, 1583, 184]],
    ['restaurant', 'restaurant', [1, 4, 5]],
    ['shop', 'shop', [332, 15297, 4595]],
  ]) {
    console.log('=== ' + label);
    for (const id of ids) {
      try {
        const r = await fetch(config.tat.apiBaseUrl + '/places/' + id, { headers: tatHeadersFor(config.tat.apiKey, 'th') });
        const jj = await r.json();
        const d = jj.data || jj.result || jj;
        if (!d || !d.information) { console.log('---', id, 'NO information'); continue; }
        console.log('---', id, '|', String(d.name).slice(0, 40));
        console.log('    min/max:', d.minPrice, '/', d.maxPrice);
        console.log('    infoKeys:', Object.keys(d.information).join(','));
        const inf = d.information;
        console.log('    fee:', s(inf.fee));
        console.log('    intro?', s(inf.introduction, 80), '| detail?', s(inf.detail, 80));
        if (cat === 'accommodation') {
          console.log('    star:', s(inf.hotelStar), '| in:', s(inf.checkInTime), '| out:', s(inf.checkOutTime),
            '| numRooms:', s(inf.numberOfRooms), '| license:', s(inf.registerLicenseId));
          console.log('    rooms:', Array.isArray(inf.rooms) ? 'array[' + inf.rooms.length + '] ' + s(inf.rooms[0], 400) : s(inf.rooms));
        }
        if (cat === 'restaurant') console.log('    cuisines:', s(inf.cuisines, 400));
        console.log('    activities:', s(inf.activities, 200), '| targets:', s(inf.targets, 200));
        console.log('    facilities:', s(d.facilities, 300));
        console.log('    payment:', s(d.paymentMethods, 300));
        console.log('    services:', s(d.services, 300));
        console.log('    contact:', s(d.contact, 200));
      } catch (e) { console.log('---', id, 'ERROR:', e.message); }
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
