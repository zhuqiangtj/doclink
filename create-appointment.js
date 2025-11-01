const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTestAppointment() {
  try {
    // Get the first patient
    const patient = await prisma.user.findFirst({
      where: { role: 'PATIENT' },
      include: { patientProfile: true }
    });
    
    if (!patient) {
      console.log('No patient found');
      return;
    }
    
    console.log('Using patient:', patient.name, patient.username);

    // Get the schedule
    const schedule = await prisma.schedule.findFirst({
      include: { doctor: true, room: true }
    });
    
    if (!schedule) {
      console.log('No schedule found');
      return;
    }
    
    console.log('Using schedule:', schedule.id, 'Date:', schedule.date);
    console.log('Doctor ID:', schedule.doctorId);
    console.log('Room ID:', schedule.roomId);

    // Create appointment
    const appointment = await prisma.appointment.create({
      data: {
        userId: patient.id,
        patientId: patient.patientProfile.id,
        doctorId: schedule.doctorId,
        scheduleId: schedule.id,
        time: '15:00',
        roomId: schedule.roomId,
        bedId: 1,
        status: 'CONFIRMED'
      }
    });

    console.log('Created appointment:', appointment.id);

    // Update the schedule timeSlots to reflect the booking
    const updatedTimeSlots = schedule.timeSlots.map(slot => {
      if (slot.time === '15:00') {
        return { ...slot, booked: slot.booked + 1 };
      }
      return slot;
    });

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { timeSlots: updatedTimeSlots }
    });

    console.log('Updated schedule timeSlots');

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

createTestAppointment();