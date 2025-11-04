const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// 預設時間段模板
const DEFAULT_TIME_SLOTS = [
  // 上午時段
  {
    startTime: '08:00',
    endTime: '09:00',
    bedCount: 4,
    type: 'MORNING'
  },
  {
    startTime: '09:00',
    endTime: '10:00',
    bedCount: 4,
    type: 'MORNING'
  },
  {
    startTime: '10:00',
    endTime: '10:30',
    bedCount: 3,
    type: 'MORNING'
  },
  {
    startTime: '10:30',
    endTime: '11:00',
    bedCount: 2,
    type: 'MORNING'
  },
  // 下午時段
  {
    startTime: '13:30',
    endTime: '14:30',
    bedCount: 4,
    type: 'AFTERNOON'
  },
  {
    startTime: '14:30',
    endTime: '15:30',
    bedCount: 4,
    type: 'AFTERNOON'
  },
  {
    startTime: '15:30',
    endTime: '16:00',
    bedCount: 3,
    type: 'AFTERNOON'
  }
];

async function seedTimeSlots() {
  try {
    console.log('開始為現有排班添加時間段...');

    // 獲取所有現有的排班
    const schedules = await prisma.schedule.findMany({
      include: {
        timeSlots: true
      }
    });

    console.log(`找到 ${schedules.length} 個排班記錄`);

    for (const schedule of schedules) {
      // 如果該排班還沒有時間段，則添加預設時間段
      if (schedule.timeSlots.length === 0) {
        console.log(`為排班 ${schedule.id} (日期: ${schedule.date}) 添加時間段...`);
        
        for (const slot of DEFAULT_TIME_SLOTS) {
          await prisma.timeSlot.create({
            data: {
              scheduleId: schedule.id,
              startTime: slot.startTime,
              endTime: slot.endTime,
              bedCount: slot.bedCount,
              availableBeds: slot.bedCount, // 初始時所有床位都可用
              type: slot.type,
              isActive: true
            }
          });
        }
        
        console.log(`✓ 已為排班 ${schedule.id} 添加 ${DEFAULT_TIME_SLOTS.length} 個時間段`);
      } else {
        console.log(`排班 ${schedule.id} 已有時間段，跳過`);
      }
    }

    console.log('✅ 時間段種子數據添加完成');
  } catch (error) {
    console.error('❌ 添加時間段種子數據時發生錯誤:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 如果直接運行此腳本
if (require.main === module) {
  seedTimeSlots()
    .then(() => {
      console.log('腳本執行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('腳本執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { seedTimeSlots, DEFAULT_TIME_SLOTS };