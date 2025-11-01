const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixAppointment() {
  try {
    // Get doctor1's schedule for today
    const doctor1 = await prisma.user.findFirst({
      where: { username: 'doctor1' },
      include: { doctorProfile: true }
    });
    
    if (!doctor1?.doctorProfile) {
      console.log('Doctor1 not found');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const schedule = await prisma.schedule.findFirst({
      where: { 
        doctorId: doctor1.doctorProfile.id,
        date: today 
      }
    });
    
    if (!schedule) {
      console.log('No schedule found for doctor1 today');
      return;
    }
    
    console.log('Found doctor1 schedule:', schedule.id);
    
    // Get first patient
    const patient = await prisma.patient.findFirst({
      include: { user: true }
    });
    
    if (!patient) {
      console.log('No patient found');
      return;
    }
    
    console.log('Using patient:', patient.user.name);
    
    // Create appointment for doctor1's schedule
    const appointment = await prisma.appointment.create({
      data: {
        userId: patient.userId,
        patientId: patient.id,
        doctorId: doctor1.doctorProfile.id,
        scheduleId: schedule.id,
        time: '09:00',
        roomId: schedule.roomId,
        bedId: 1,
        status: 'confirmed'
      }
    });
    
    console.log('Created appointment:', appointment.id);
    
    // Update schedule timeSlots
    const timeSlots = JSON.parse(JSON.stringify(schedule.timeSlots));
    const slot = timeSlots.find(s => s.time === '09:00');
    if (slot) {
      slot.booked = 1;
      slot.appointments = [appointment.id];
    }
    
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { timeSlots: timeSlots }
    });
    
    console.log('Updated schedule timeSlots');
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

fixAppointment();