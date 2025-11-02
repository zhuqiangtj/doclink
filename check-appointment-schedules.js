const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkAppointmentSchedules() {
  try {
    console.log('Checking appointment schedules...');
    
    // 獲取所有預約及其schedule
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
        room: true,
        schedule: true
      }
    });
    
    console.log(`Total appointments: ${appointments.length}`);
    
    appointments.forEach(apt => {
      console.log(`\n- Appointment ID: ${apt.id}`);
      console.log(`  Patient: ${apt.patient.user.name}`);
      console.log(`  Doctor: ${apt.doctor.user.name}`);
      console.log(`  Time: ${apt.time}`);
      console.log(`  Status: ${apt.status}`);
      console.log(`  Schedule ID: ${apt.scheduleId}`);
      if (apt.schedule) {
        console.log(`  Schedule Date: ${apt.schedule.date}`);
      } else {
        console.log(`  Schedule: NOT FOUND!`);
      }
    });
    
    // 檢查有多少個schedule
    const scheduleCount = await prisma.schedule.count();
    console.log(`\nTotal schedules: ${scheduleCount}`);
    
    const schedules = await prisma.schedule.findMany({
      include: {
        doctor: {
          include: {
            user: true
          }
        },
        room: true
      }
    });
    
    console.log('\nSchedules:');
    schedules.forEach(sch => {
      console.log(`- Schedule ID: ${sch.id}, Doctor: ${sch.doctor.user.name}, Date: ${sch.date}, Room: ${sch.room.name}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAppointmentSchedules();