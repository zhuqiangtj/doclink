const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

(async () => {
  const base = 'http://localhost:3000';
  const outDir = path.join(__dirname, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('UPSTASH_REDIS_REST_URL:', process.env.UPSTASH_REDIS_REST_URL || 'undefined');
  console.log('UPSTASH_REDIS_REST_TOKEN:', process.env.UPSTASH_REDIS_REST_TOKEN ? '<present>' : 'undefined');

  const browser = await chromium.launch();
  const doctorCtx = await browser.newContext();
  const doctorPage = await doctorCtx.newPage();

  await doctorPage.goto(`${base}/auth/signin`);
  await doctorPage.fill('#username', 'zhangru');
  await doctorPage.fill('#password', '123456');
  await Promise.all([
    doctorPage.waitForNavigation({ url: /\/doctor\/schedule/ }),
    doctorPage.click('button[type="submit"]'),
  ]);
  console.log('Doctor logged in, navigating to /doctor/schedule');

  const userRes = await doctorPage.request.get(`${base}/api/user`);
  const userJson = await userRes.json();
  const doctorId = userJson.doctorProfile?.id;
  if (!doctorId) throw new Error('Doctor profile id not found');

  const roomsRes = await doctorPage.request.get(`${base}/api/rooms`);
  let rooms = await roomsRes.json();
  if (!Array.isArray(rooms)) rooms = [];
  let roomId = rooms[0]?.id;
  if (!roomId) {
    const createRoomRes = await doctorPage.request.post(`${base}/api/rooms`, { data: { name: '测试诊室', bedCount: 10 } });
    const roomJson = await createRoomRes.json();
    if (!createRoomRes.ok()) throw new Error('Failed to create room: ' + JSON.stringify(roomJson));
    roomId = roomJson.id;
    console.log('Created room:', roomId);
  } else {
    console.log('Using existing room:', roomId);
  }

  const date = todayYYYYMMDD();
  const tsRes = await doctorPage.request.post(`${base}/api/schedules`, { data: { date, roomId, startTime: '09:00', endTime: '10:00', bedCount: 5 } });
  const tsJson = await tsRes.json();
  if (!tsRes.ok()) throw new Error('Failed to create timeslot: ' + JSON.stringify(tsJson));
  const timeSlotId = tsJson.id;
  console.log('Created timeSlot:', timeSlotId, 'date:', date);

  await doctorPage.screenshot({ path: path.join(outDir, 'doctor-schedule-before.png'), fullPage: true });

  const patientCtx = await browser.newContext();
  const patientPage = await patientCtx.newPage();
  await patientPage.goto(`${base}/auth/signin`);
  await patientPage.fill('#username', 'patient1');
  await patientPage.fill('#password', 'patient123');
  await Promise.all([
    patientPage.waitForNavigation({ url: /\/$/ }),
    patientPage.click('button[type="submit"]'),
  ]);
  console.log('Patient logged in');

  const pUserRes = await patientPage.request.get(`${base}/api/user`);
  const pUser = await pUserRes.json();
  const userId = pUser.id;
  const patientId = pUser.patientProfile?.id;
  if (!patientId) throw new Error('Patient profile id not found');

  const aptRes = await patientPage.request.post(`${base}/api/appointments`, { data: { userId, patientId, doctorId, timeSlotId, roomId } });
  const aptJson = await aptRes.json();
  if (!aptRes.ok()) throw new Error('Failed to create appointment: ' + JSON.stringify(aptJson));
  const appointmentId = aptJson.id;
  console.log('Appointment created:', appointmentId);

  const detailsResp = await doctorPage.waitForResponse(resp => resp.url().includes('/api/schedules/details') && resp.request().method() === 'GET', { timeout: 15000 }).catch(() => null);
  if (detailsResp) {
    console.log('Doctor page refreshed after SSE event');
  } else {
    console.warn('Doctor page did not refresh within timeout');
  }

  await doctorPage.screenshot({ path: path.join(outDir, 'doctor-schedule-after.png'), fullPage: true });

  await browser.close();
  console.log('Screenshots saved to', outDir);
})();