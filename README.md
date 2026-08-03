# GoThai API และ Admin

โฟลเดอร์นี้ประกอบด้วย Express/PostgreSQL API ใน `server` และ React/Vite admin dashboard ใน `client` รายละเอียด flow ระหว่าง mobile, admin, database และบริการ AI อยู่ที่ [คู่มืออ่านโค้ดภาษาไทย](../doc/CODE_GUIDE_TH.md)

## เริ่มใช้งาน

คัดลอก `.env.example` เป็น `.env` แล้วตั้งค่าจริงเฉพาะในเครื่องหรือ secret manager ของระบบ deploy ห้าม commit `.env`

Server:

```powershell
cd server
npm install
npm run dev
```

Flutter Web ใช้ `http://localhost:7357` เป็นพอร์ตแนะนำสำหรับ development โดย server
อนุญาต `localhost`, `127.0.0.1` และ `::1` ทุกพอร์ตเฉพาะเมื่อ `NODE_ENV` ไม่ใช่
`production` เท่านั้น ใน production ต้องใส่ origin ของเว็บจริงแบบเจาะจงใน
`ALLOWED_ORIGINS` และใช้ HTTPS ทั้งเว็บและ API เพื่อไม่ให้ browser บล็อก mixed content

รูปจาก CDN ภายนอกที่ไม่ส่ง CORS header จะถูก Flutter Web โหลดผ่าน
`/api/mobile/media` โดยอนุญาตเฉพาะ hostname ใน `MEDIA_PROXY_HOSTS` หากเพิ่มแหล่งรูปใหม่
ให้เพิ่ม hostname แบบเจาะจงในตัวแปรนี้ ห้ามใช้ wildcard

Admin client:

```powershell
cd client
npm install
npm run dev
```

## ตรวจสอบก่อน commit

```powershell
cd client
npm run lint
npm run build

cd ..\server
npm test
```

คีย์ `GEMINI_API_KEY`, `AIFORTHAI_*`, `TATDATAAPI`, database password และ JWT secret ต้องอยู่ใน server เท่านั้น ตัวแปร `VITE_*` ถูกฝังใน browser bundle จึงใช้ได้เฉพาะค่า public เช่น API URL
