const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
  try {
    // Check patients
    const patients = await prisma.user.findMany({
      where: { role: 'PATIENT' },
      take: 5
    });
    console.log('Patients found:', patients.length);
    patients.forEach(p => console.log('- Patient:', p.id, p.name, p.username));

    // Check schedules
    const schedules = await prisma.schedule.findMany({
      include: { appointments: true },
      take: 1
    });
    
    if (schedules.length > 0) {
      console.log('\nSchedule found:', schedules[0].id);
      console.log('Date:', schedules[0].date);
      console.log('Time slots JSON:', JSON.stringify(schedules[0].timeSlots, null, 2));
      console.log('Appointments:', schedules[0].appointments.length);
      
      // Show appointments details
      schedules[0].appointments.forEach(apt => {
        console.log('- Appointment:', apt.id, 'Time:', apt.time, 'Status:', apt.status);
      });
    } else {
      console.log('No schedules found');
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

checkData();