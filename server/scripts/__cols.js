const pool = require('../config/db');
const { config } = require('../config/env');
const { tatHeadersFor } = require('../utils/tatLanguage');
(async () => {
  const c = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='destinations' ORDER BY ordinal_position");
  console.log('--- destinations cols'); c.rows.forEach((r) => console.log(r.column_name, r.data_type));
  const f = await pool.query("SELECT tat_place_id, admission_fee FROM destinations WHERE admission_fee IS NOT NULL AND admission_fee::text <> '{}' LIMIT 3");
  console.log('--- fee samples'); f.rows.forEach((r) => console.log(r.tat_place_id, JSON.stringify(r.admission_fee).slice(0, 300)));
  // attraction detail with fee from TAT
  for (const id of [1, 2, 3, 6, 9]) {
    try {
      const r = await fetch(config.tat.apiBaseUrl + '/places/' + id, { headers: tatHeadersFor(config.tat.apiKey, 'th') });
      const jj = await r.json();
      const d = jj.data || jj.result || jj;
      if (!d || !d.information) { console.log('---', id, 'NO info'); continue; }
      console.log('---', id, String(d.name).slice(0, 30), '| keys:', Object.keys(d.information).join(','));
      console.log('    fee:', JSON.stringify(d.information.fee || null).slice(0, 400));
      console.log('    min/max:', d.minPrice, '/', d.maxPrice);
    } catch (e) { console.log('---', id, 'ERR', e.message); }
  }
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
