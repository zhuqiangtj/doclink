const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDoctor1() {
  try {
    // Find doctor1 user
    const doctor1 = await prisma.user.findFirst({
      where: { username: 'doctor1' },
      include: { doctorProfile: true }
    });
    
    console.log('Doctor1 user:', doctor1?.id, doctor1?.name);
    console.log('Doctor1 profile:', doctor1?.doctorProfile?.id);
    
    if (!doctor1?.doctorProfile) {
      console.log('No doctor profile found for doctor1');
      await prisma.$disconnect();
      return;
    }
    
    // Find schedules for doctor1
    const schedules = await prisma.schedule.findMany({
      where: { doctorId: doctor1.doctorProfile.id },
      include: { appointments: true }
    });
    
    console.log('Schedules for doctor1:', schedules.length);
    schedules.forEach(s => {
      console.log('- Schedule:', s.id, s.date, 'Appointments:', s.appointments.length);
      console.log('  TimeSlots:', JSON.stringify(s.timeSlots, null, 2));
    });
    
    // Check today's date
    const today = new Date().toISOString().split('T')[0];
    console.log('Today:', today);
    
    const todaySchedule = schedules.find(s => s.date === today);
    if (todaySchedule) {
      console.log('Found today\'s schedule:', todaySchedule.id);
    } else {
      console.log('No schedule found for today');
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

checkDoctor1();