# งานที่ต้องทำภายหลัง: ให้บอทรันตรงทุก 30 นาที (cron-job.org)

> บันทึกไว้ 30 ก.ย. 2026 · สถานะ: **ยังไม่ได้ทำ**
> ค่าใช้จ่าย: ฟรีทั้งหมด (cron-job.org ฟรี · token ฟรี · GitHub Actions ฟรีสำหรับ repo Public)

## ทำไมต้องทำ
ตารางเวลาของ GitHub เอง (ตั้งไว้ทุก 30 นาที) **รันจริงแค่ประมาณทุก 3–6 ชั่วโมง** เพราะบัญชีฟรีโดนเลื่อนคิว
ผลกระทบหลัก: **สัญญาณค่ากีบตอนเช้า** อาจบันทึกไม่ทันก่อน BOL ประกาศ (ข้อมูลอื่นแทบไม่กระทบ เพราะแหล่งข้อมูลอัปเดตวันละไม่กี่ครั้งอยู่แล้ว)
ถ้า cron-job.org ล่มหรือ token หมดอายุ → บอทแค่กลับไปรันช้าเหมือนเดิม **เว็บไม่พัง**

⚠️ **ห้ามส่ง token ให้ใคร ห้ามวางในแชต ห้ามใส่ในไฟล์นี้หรือใน repo** — วางที่ cron-job.org เท่านั้น

---

## ส่วนที่ 1 — สร้าง token บน GitHub (สิทธิ์แค่ "สั่งบอทรัน")
1. เปิด https://github.com/settings/personal-access-tokens/new (ล็อกอินบัญชี vivo0982136455-dev)
2. กรอก:
   - **Token name:** `cron-job lao-kip-gold`
   - **Expiration:** 366 days (หรือสูงสุดที่เลือกได้) — **จดวันหมดอายุไว้**
   - **Repository access:** Only select repositories → **lao-kip-gold**
   - **Permissions → Repository permissions → Actions:** **Read and write** (อย่างอื่นไม่ต้องแตะ)
3. กด **Generate token** → คัดลอกรหัส `github_pat_...` (แสดงครั้งเดียว — เปิดหน้าค้างไว้)

## ส่วนที่ 2 — สมัคร cron-job.org
1. https://console.cron-job.org/signup → สมัครฟรีด้วยอีเมล → กดยืนยันในอีเมล → ล็อกอิน

## ส่วนที่ 3 — สร้างงานตั้งเวลา (กด CREATE CRONJOB)
**แท็บ COMMON**
- Title: `Lao kip gold - fetch data`
- URL: `https://api.github.com/repos/vivo0982136455-dev/lao-kip-gold/actions/workflows/fetch-data.yml/dispatches`
- Execution schedule: **Every 30 minutes**

**แท็บ ADVANCED**
- Time zone: `Asia/Bangkok`
- Request method: **POST**
- Request body: `{"ref":"main"}`
- Headers (กด + ADD 3 ครั้ง):
  - `Accept` = `application/vnd.github+json`
  - `X-GitHub-Api-Version` = `2022-11-28`
  - `Authorization` = `Bearer ` + token (มีเว้นวรรค 1 ช่องหลัง Bearer)

กด **CREATE**

## ส่วนที่ 4 — ทดสอบ
1. ในรายการงาน กด **⋯ → Test run / Execute now**
2. ต้องได้ **HTTP 204** = สำเร็จ
   - 401 → token ผิด หรือลืม `Bearer `
   - 403 → ลืมตั้ง Actions = Read and write
   - 404 → URL ผิด หรือเลือก repo ผิด
3. เปิด https://github.com/vivo0982136455-dev/lao-kip-gold/actions → ต้องเห็น **Fetch data** รอบใหม่
4. บอก Claude ให้ช่วยเช็กว่ารันทุก 30 นาทีจริง

## เมื่อ token ใกล้หมดอายุ (อีก ~1 ปี)
ทำส่วนที่ 1 ใหม่ แล้วแก้ header `Authorization` ใน cron-job.org เป็น token ใหม่
