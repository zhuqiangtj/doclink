const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testNewTimeSlotModel() {
  try {
    console.log('Testing new TimeSlot model...');
    
    // 檢查 TimeSlot 表結構
    const timeSlots = await prisma.timeSlot.findMany({
      take: 5,
      include: {
        schedule: {
          include: {
            room: true
          }
        },
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
    });
    
    console.log('Found TimeSlots:', timeSlots.length);
    
    if (timeSlots.length > 0) {
      console.log('Sample TimeSlot structure:');
      console.log(JSON.stringify(timeSlots[0], null, 2));
    }
    
    // 檢查 Schedule 表結構
    const schedules = await prisma.schedule.findMany({
      take: 3,
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
    
    console.log('\nFound Schedules:', schedules.length);
    
    if (schedules.length > 0) {
      console.log('Sample Schedule structure:');
      console.log(JSON.stringify(schedules[0], null, 2));
    }
    
  } catch (error) {
    console.error('Error testing TimeSlot model:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testNewTimeSlotModel();