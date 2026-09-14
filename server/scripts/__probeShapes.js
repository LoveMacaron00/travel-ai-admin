const { config } = require('../config/env');
const { tatHeadersFor } = require('../utils/tatLanguage');

const s = (v, n = 600) => String(v === undefined ? '‹undef›' : JSON.stringify(v)).slice(0, n);
const detail = async (id) => {
  const r = await fetch(config.tat.apiBaseUrl + '/places/' + id, { headers: tatHeadersFor(config.tat.apiKey, 'th') });
  const j = await r.json();
  return j.data || j.result || j;
};
const list = async (cat) => {
  const r = await fetch(config.tat.apiBaseUrl + '/places?limit=5&page=1&place_category=' + cat,
    { headers: tatHeadersFor(config.tat.apiKey, 'th') });
  const j = await r.json();
  return j.data || j.result || j;
};

(async () => {
  const d = await detail(15664);
  console.log('=== hotel 15664', String(d.name).slice(0, 50), '| cat:', s(d.category?.name));
  console.log('    min/max:', s(d.minPrice), '/', s(d.maxPrice));
  console.log('    infoKeys:', Object.keys(d.information || {}).join(','));
  console.log('    star:', s(d.information?.hotelStar), '| in:', s(d.information?.checkInTime),
    '| out:', s(d.information?.checkOutTime), '| numRooms:', s(d.information?.numberOfRooms),
    '| license:', s(d.information?.registerLicenseId));
  console.log('    rooms:', s(d.information?.rooms));
  console.log('    fee:', s(d.information?.fee));
  console.log('    facilities:', s(d.facilities));
  console.log('    services:', s(d.services));
  console.log('    payment:', s(d.paymentMethods));
  console.log('    contact:', s(d.contact));

  for (const cat of ['restaurant', 'shop']) {
    const items = await list(cat);
    console.log(`=== ${cat} list n=${items.length}`);
    for (const item of items.slice(0, 2)) {
      const id = item.placeId || item.id;
      const dd = await detail(id);
      console.log('---', id, String(dd.name).slice(0, 40));
      console.log('    infoKeys:', Object.keys(dd.information || {}).join(','));
      console.log('    cuisines:', s(dd.information?.cuisines));
      console.log('    fee:', s(dd.information?.fee));
      console.log('    min/max:', s(dd.minPrice), '/', s(dd.maxPrice));
      console.log('    payment:', s(dd.paymentMethods));
      console.log('    services:', s(dd.services));
      console.log('    facilities:', s(dd.facilities));
      console.log('    contact:', s(dd.contact));
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
