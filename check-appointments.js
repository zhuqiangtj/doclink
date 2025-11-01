const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAppointments() {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log('Checking appointments for:', today);
    
    // Get all appointments and filter by schedule date
    const appointments = await prisma.appointment.findMany({
      include: { 
        schedule: { include: { doctor: true } }, 
        patient: true 
      }
    });
    
    // Filter by today's date from schedule
    const todayAppointments = appointments.filter(a => a.schedule.date === today);
    
    console.log('Today appointments:', todayAppointments.length);
    todayAppointments.forEach(a => {
      console.log('- Appointment:', a.id);
      console.log('  Schedule:', a.scheduleId);
      console.log('  Doctor:', a.schedule.doctor.name);
      console.log('  Patient:', a.patient.name);
      console.log('  Time:', a.time);
    });
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

checkAppointments();