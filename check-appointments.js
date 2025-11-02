const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkAppointments() {
  try {
    console.log('Connecting to database...');
    
    // 檢查預約數量
    const appointmentCount = await prisma.appointment.count();
    console.log(`Total appointments: ${appointmentCount}`);
    
    // 獲取所有預約
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
    
    console.log('Appointments:');
    appointments.forEach(apt => {
      console.log(`- ID: ${apt.id}, Patient: ${apt.patient.user.name}, Doctor: ${apt.doctor.user.name}, Date: ${apt.date}, Time: ${apt.time}, Status: ${apt.status}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAppointments();