/**
 * 定時任務調度器
 * 每小時執行一次預約狀態更新
 */

const cron = require('node-cron');
const { updateExpiredAppointments } = require('./update-appointment-status');

console.log('啟動預約狀態更新定時任務...');

// 每小時的第0分鐘執行一次
cron.schedule('0 * * * *', async () => {
  console.log(`[${new Date().toISOString()}] 執行定時任務：更新過期預約狀態`);
  await updateExpiredAppointments();
}, {
  scheduled: true,
  timezone: "Asia/Taipei"
});

console.log('定時任務已啟動，每小時執行一次預約狀態更新');

// 立即執行一次
updateExpiredAppointments();