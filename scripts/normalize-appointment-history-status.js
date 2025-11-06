/**
 * 数据库归一化脚本：
 * - 将所有 AppointmentHistory 中 action 为 "CHECKIN" 的记录状态统一为 "PENDING"
 * - 将 action 为 "UPDATE_STATUS_TO_CHECKED_IN" 的记录状态统一为 "PENDING"
 * - 输出处理摘要（受影响条数、示例记录）
 *
 * 说明：当前 Prisma 枚举仅允许四种状态（PENDING/CANCELLED/COMPLETED/NO_SHOW），
 * 若历史上存在写入 "CHECKED_IN" 的逻辑，此脚本确保数据最终一致为四状态。
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function normalizeAppointmentHistory() {
  const ALLOWED = ['PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
  let updatedCheckin = 0;
  let updatedUpdateToCheckedIn = 0;

  try {
    console.log('开始归一化 AppointmentHistory 状态...');

    // 1) 规范化 action = CHECKIN 的记录：统一设为 PENDING
    const checkinHistories = await prisma.appointmentHistory.findMany({
      where: {
        action: 'CHECKIN',
      },
      select: { id: true, status: true, appointmentId: true, action: true, reason: true },
    });

    for (const h of checkinHistories) {
      if (h.status !== 'PENDING') {
        await prisma.appointmentHistory.update({
          where: { id: h.id },
          data: { status: 'PENDING' },
        });
        updatedCheckin++;
      }
    }

    // 2) 规范化 action = UPDATE_STATUS_TO_CHECKED_IN 的记录：统一设为 PENDING
    const updateToCheckedInHistories = await prisma.appointmentHistory.findMany({
      where: {
        action: 'UPDATE_STATUS_TO_CHECKED_IN',
      },
      select: { id: true, status: true, appointmentId: true, action: true, reason: true },
    });

    for (const h of updateToCheckedInHistories) {
      if (h.status !== 'PENDING') {
        await prisma.appointmentHistory.update({
          where: { id: h.id },
          data: { status: 'PENDING' },
        });
        updatedUpdateToCheckedIn++;
      }
    }

    // 3) 可选：扫描所有历史记录，确保状态皆为允许值（仅统计）
    const allHistories = await prisma.appointmentHistory.findMany({
      select: { id: true, status: true, action: true },
    });
    const invalid = allHistories.filter(h => !ALLOWED.includes(h.status));

    console.log('处理摘要：');
    console.log(`- CHECKIN 记录修正为 PENDING：${updatedCheckin} 条`);
    console.log(`- UPDATE_STATUS_TO_CHECKED_IN 记录修正为 PENDING：${updatedUpdateToCheckedIn} 条`);
    console.log(`- 发现非四状态（理论上不应出现）的记录：${invalid.length} 条`);
    if (invalid.length > 0) {
      console.log('示例：', invalid.slice(0, 5));
    }

  } catch (error) {
    console.error('归一化过程中发生错误：', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  normalizeAppointmentHistory();
}

module.exports = { normalizeAppointmentHistory };