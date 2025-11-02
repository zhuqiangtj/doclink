const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixAppointmentDates() {
  try {
    console.log('Fixing appointment dates...');
    
    // 獲取今天的日期
    const today = new Date().toISOString().split('T')[0];
    console.log('Setting date to:', today);
    
    // 更新所有沒有日期的預約
    const result = await prisma.appointment.updateMany({
      where: {
        OR: [
          { date: null },
          { date: undefined }
        ]
      },
      data: {
        date: today
      }
    });
    
    console.log(`Updated ${result.count} appointments`);
    
    // 檢查更新後的結果
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
        room: true
      }
    });
    
    console.log('Updated appointments:');
    appointments.forEach(apt => {
      console.log(`- ID: ${apt.id}, Patient: ${apt.patient.user.name}, Date: ${apt.date}, Time: ${apt.time}, Status: ${apt.status}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixAppointmentDates();