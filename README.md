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

Admin client:

```powershell
cd client
npm install
npm run dev
```

## ตรวจสอบก่อน commit

```powershell
cd server
npm test

cd ../client
npm run lint
npm run build
```

คีย์ `GEMINI_API_KEY`, `AIFORTHAI_*`, `TATDATAAPI`, database password และ JWT secret ต้องอยู่ใน server เท่านั้น ตัวแปร `VITE_*` ถูกฝังใน browser bundle จึงใช้ได้เฉพาะค่า public เช่น API URL
