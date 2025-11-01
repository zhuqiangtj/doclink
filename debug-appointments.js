const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugAppointments() {
  try {
    console.log('=== 檢查今天的預約數據 ===');
    
    // 1. 檢查今天的所有預約
    const today = new Date('2025-11-01');
    const appointments = await prisma.appointment.findMany({
      include: {
        patient: {
          include: {
            user: true
          }
        },
        doctor: {
          include: {
            user: true
          }
        },
        schedule: {
          include: {
            room: true
          }
        }
      }
    });
    
    console.log('所有預約數量:', appointments.length);
    
    const todayAppointments = appointments.filter(apt => {
      const scheduleDate = new Date(apt.schedule.date);
      return scheduleDate.toDateString() === today.toDateString();
    });
    
    console.log('今天的預約數量:', todayAppointments.length);
    
    todayAppointments.forEach((apt, index) => {
      console.log(`\n預約 ${index + 1}:`);
      console.log('- ID:', apt.id);
      console.log('- 時間:', apt.time);
      console.log('- 狀態:', apt.status);
      console.log('- 患者:', apt.patient?.user?.name || '未找到患者');
      console.log('- 醫生:', apt.doctor?.user?.name || '未找到醫生');
      console.log('- 排程ID:', apt.scheduleId);
      console.log('- 排程日期:', apt.schedule?.date);
      console.log('- 診室:', apt.schedule?.room?.name || '未找到診室');
    });
    
    // 2. 檢查doctor1的排程
    const doctor1User = await prisma.user.findUnique({
      where: { username: 'doctor1' },
      include: {
        doctorProfile: {
          include: {
            schedules: {
              where: {
                date: '2025-11-01'
              },
              include: {
                room: true,
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
        }
      }
    });
    
    console.log('\n=== Doctor1 的排程數據 ===');
    if (doctor1User?.doctorProfile?.schedules) {
      doctor1User.doctorProfile.schedules.forEach((schedule, index) => {
        console.log(`\n排程 ${index + 1}:`);
        console.log('- ID:', schedule.id);
        console.log('- 日期:', schedule.date);
        console.log('- 診室:', schedule.room.name);
        console.log('- 預約數量:', schedule.appointments.length);
        
        schedule.appointments.forEach((apt, aptIndex) => {
          console.log(`  預約 ${aptIndex + 1}: ${apt.time} - ${apt.patient.user.name}`);
        });
        
        // 檢查時間段數據
        console.log('- 時間段數據:', JSON.stringify(schedule.timeSlots, null, 2));
      });
    }
    
  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugAppointments();