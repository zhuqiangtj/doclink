/**
 * 定時任務調度器
 * 每小时执行一次预约状态更新
 */

const cron = require('node-cron');
const { updateExpiredAppointments } = require('./update-appointment-status');

console.log('启动预约状态更新定时任务...');

// 每小時的第0分鐘執行一次
cron.schedule('0 * * * *', async () => {
console.log(`[${new Date().toISOString()}] 执行定时任务：更新过期预约状态`);
  await updateExpiredAppointments();
}, {
  scheduled: true,
  timezone: "Asia/Taipei"
});

console.log('定时任务已启动，每小时执行一次预约状态更新');

// 立即執行一次
updateExpiredAppointments();