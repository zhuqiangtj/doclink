const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestTimeSlotData() {
  try {
    console.log('Creating test data for new TimeSlot model...');
    
    // 首先檢查是否有醫生和診室
    const doctors = await prisma.doctor.findMany({
      include: {
        user: true,
        Room: true
      }
    });
    
    console.log('Found doctors:', doctors.length);
    
    if (doctors.length === 0) {
      console.log('No doctors found. Checking for existing test user...');
      
      // 檢查是否已有測試用戶
      let testUser = await prisma.user.findUnique({
        where: { username: 'testdoctor' }
      });
      
      if (!testUser) {
        // 創建測試用戶
        testUser = await prisma.user.create({
          data: {
            username: 'testdoctor',
            name: '測試醫生',
            password: 'password123',
            role: 'DOCTOR'
          }
        });
        console.log('Created test user:', testUser.id);
      } else {
        console.log('Using existing test user:', testUser.id);
      }
      
      // 檢查是否已有測試醫生
      let testDoctor = await prisma.doctor.findUnique({
        where: { userId: testUser.id },
        include: { Room: true }
      });
      
      if (!testDoctor) {
        // 創建測試醫生
        testDoctor = await prisma.doctor.create({
          data: {
            userId: testUser.id
          }
        });
        console.log('Created test doctor:', testDoctor.id);
      } else {
        console.log('Using existing test doctor:', testDoctor.id);
      }
      
      // 檢查是否已有測試診室
      let testRoom = testDoctor.Room && testDoctor.Room.length > 0 ? testDoctor.Room[0] : null;
      
      if (!testRoom) {
        // 創建測試診室
        testRoom = await prisma.room.create({
          data: {
            name: '測試診室',
            bedCount: 10,
            doctorId: testDoctor.id
          }
        });
        console.log('Created test room:', testRoom.id);
      } else {
        console.log('Using existing test room:', testRoom.id);
      }
      
      doctors.push({
        ...testDoctor,
        user: testUser,
        Room: [testRoom]
      });
    }
    
    const doctor = doctors[0];
    const room = doctor.Room[0];
    
    if (!room) {
      console.log('Doctor has no room assigned. Cannot create schedule.');
      return;
    }
    
    console.log('Using doctor:', doctor.user.name, 'Room:', room.name);
    
    // 創建今天的排程
    const today = new Date().toISOString().split('T')[0]; // 格式: YYYY-MM-DD
    
    // 檢查是否已有今天的排程
    let schedule = await prisma.schedule.findFirst({
      where: {
        date: today,
        roomId: room.id
      }
    });
    
    if (!schedule) {
      schedule = await prisma.schedule.create({
        data: {
          date: today,
          roomId: doctor.Room[0].id,
          doctorId: doctor.id
        }
      });
      console.log('Created schedule:', schedule.id);
    } else {
      console.log('Using existing schedule:', schedule.id);
    }
    
    // 創建測試時段
    const timeSlots = [
      {
        startTime: '09:00',
        endTime: '10:00',
        bedCount: 5,
        availableBeds: 5,
        type: 'MORNING',
        isActive: true
      },
      {
        startTime: '10:00',
        endTime: '11:00',
        bedCount: 8,
        availableBeds: 8,
        type: 'MORNING',
        isActive: true
      },
      {
        startTime: '14:00',
        endTime: '15:00',
        bedCount: 6,
        availableBeds: 6,
        type: 'AFTERNOON',
        isActive: true
      }
    ];
    
    for (const slotData of timeSlots) {
      // 檢查是否已存在相同時間的時段
      const existingSlot = await prisma.timeSlot.findFirst({
        where: {
          scheduleId: schedule.id,
          startTime: slotData.startTime,
          endTime: slotData.endTime
        }
      });
      
      if (!existingSlot) {
        const timeSlot = await prisma.timeSlot.create({
          data: {
            ...slotData,
            scheduleId: schedule.id
          }
        });
        console.log(`Created TimeSlot: ${slotData.startTime}-${slotData.endTime}`);
      } else {
        console.log(`TimeSlot already exists: ${slotData.startTime}-${slotData.endTime}`);
      }
    }
    
    // 驗證創建的數據
    const finalSchedule = await prisma.schedule.findUnique({
      where: { id: schedule.id },
      include: {
        room: true,
        timeSlots: {
          include: {
            appointments: {
              include: {
                patient: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });
    
    console.log('\nFinal schedule structure:');
    console.log(JSON.stringify(finalSchedule, null, 2));
    
  } catch (error) {
    console.error('Error creating test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestTimeSlotData();