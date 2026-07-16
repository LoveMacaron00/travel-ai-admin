# API endpoint inventory

อัปเดตล่าสุด: 2026-07-16

เอกสารนี้เทียบ route ที่ backend เปิดกับ caller ใน `client/src` และ
`travel-ai-app/lib` เพื่อแยก endpoint ที่ใช้งานจริงออกจาก endpoint สำหรับงานดูแลระบบ

## Admin web

| Method | Endpoint | Caller / purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | `Login.jsx` |
| GET | `/api/analytics/overview` | `Dashboard.jsx` |
| GET | `/api/destinations` | `Destinations.jsx` |
| GET | `/api/destinations/:id` | `EditDestination.jsx` |
| POST | `/api/destinations` | `AddDestination.jsx` |
| PUT | `/api/destinations/:id` | `EditDestination.jsx` |
| DELETE | `/api/destinations/:id` | `Destinations.jsx` |
| POST | `/api/upload` | หน้าเพิ่มและแก้ไขสถานที่ |
| GET | `/api/v2/places` | ค้น TAT ใน `Destinations.jsx` |
| GET | `/api/v2/places/:id` | `ReadDestination.jsx` |
| GET | `/api/users` | `UserManager.jsx` |
| PUT | `/api/users/:id/ban` | `UserManager.jsx` |
| GET | `/api/feedback` | `UserManager.jsx` |
| PUT | `/api/feedback/:id` | `UserManager.jsx` |
| POST | `/api/admin/sync/tat` | sync ผลค้นหาจาก `Destinations.jsx` |
| POST | `/api/admin/sync/tat/:tatPlaceId` | sync สถานที่เดียวจากหน้า list/detail |

## Mobile app

| Method | Endpoint | Caller / purpose |
| --- | --- | --- |
| POST | `/api/users/register` | `AuthService.register` |
| POST | `/api/users/login` | `AuthService.login` |
| PUT | `/api/users/profile` | `AuthService.updateProfile` |
| POST | `/api/users/profile/upload-image` | `AuthService.uploadProfileImage` |
| GET | `/api/mobile/destinations` | `DestinationService.getDestinations` |
| GET | `/api/mobile/destinations/:id` | `DestinationService.getDestinationDetails` |
| POST | `/api/trips` | `TripService.createTravelPlan` |
| GET | `/api/trips/:id` | โหลดผลหลังสร้างแผนผ่าน `TripService.getTravelPlan` |
| GET | `/api/chat/sessions/latest` | เปิด session แชทล่าสุด |
| POST | `/api/chat/sessions` | สร้าง session เมื่อยังไม่มี |
| GET | `/api/chat/sessions/:sessionId/messages` | โหลดประวัติแชท |
| POST | `/api/chat/sessions/:sessionId/messages` | ส่งข้อความและรับ SSE |
| POST | `/api/chat/sessions/:sessionId/images` | ส่งภาพ place/sign/food ผ่าน `ChatService.sendImage` |

## Endpoint ที่ตั้งใจเก็บแม้ยังไม่มีหน้าจอเรียกตรง

| Method | Endpoint | Reason |
| --- | --- | --- |
| GET | `/api/trips` | รองรับหน้าประวัติแผนในอนาคต; query และ authorization พร้อมแล้ว |
| GET | `/api/chat/trips/:tripId/session` | รองรับแชทที่ผูกกับ trip ซึ่ง data model รองรับอยู่ |
| POST | `/api/admin/embed/bulk` | maintenance: เติม embedding ที่ขาดหลัง import/migration |
| POST | `/api/admin/embed/:id` | maintenance: บังคับ re-embed สถานที่เดียว |

endpoint กลุ่ม maintenance ต้องใช้ admin token และปกติเรียกด้วยเครื่องมือดูแลระบบ
จึงไม่ควรถูกตีความว่าเป็น dead endpoint

`/api/destinations` และ `/api/mobile/destinations` ดูคล้ายกันแต่ไม่ซ้ำกัน:
ชุดแรกเป็น CRUD สำหรับ admin และถูกครอบด้วย admin auth ส่วนชุด mobile เป็น read-only,
คืนเฉพาะสถานะ `approved` และแปลง response ให้ตรงกับ model ของแอป
