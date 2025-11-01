const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTodayAppointment() {
  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    console.log('Creating appointment for date:', todayStr);

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

    // Get or create a schedule for today
    let schedule = await prisma.schedule.findFirst({
      where: { date: todayStr },
      include: { doctor: true, room: true }
    });
    
    if (!schedule) {
      console.log('No schedule found for today, creating one...');
      
      // Get the first doctor and room
      const doctor = await prisma.doctor.findFirst();
      const room = await prisma.room.findFirst();
      
      if (!doctor || !room) {
        console.log('No doctor or room found');
        return;
      }
      
      // Create schedule for today
      schedule = await prisma.schedule.create({
        data: {
          doctorId: doctor.id,
          date: todayStr,
          roomId: room.id,
          timeSlots: [
            { time: '09:00', total: 4, booked: 0 },
            { time: '10:00', total: 4, booked: 0 },
            { time: '11:00', total: 4, booked: 0 },
            { time: '14:00', total: 4, booked: 0 },
            { time: '15:00', total: 4, booked: 0 },
            { time: '16:00', total: 4, booked: 0 }
          ]
        },
        include: { doctor: true, room: true }
      });
      
      console.log('Created new schedule:', schedule.id);
    }
    
    console.log('Using schedule:', schedule.id, 'Date:', schedule.date);

    // Create appointment for 09:00
    const appointment = await prisma.appointment.create({
      data: {
        userId: patient.id,
        patientId: patient.patientProfile.id,
        doctorId: schedule.doctorId,
        scheduleId: schedule.id,
        time: '09:00',
        roomId: schedule.roomId,
        bedId: 1,
        status: 'CONFIRMED'
      }
    });

    console.log('Created appointment:', appointment.id);

    // Update the schedule timeSlots to reflect the booking
    const updatedTimeSlots = schedule.timeSlots.map(slot => {
      if (slot.time === '09:00') {
        return { ...slot, booked: slot.booked + 1 };
      }
      return slot;
    });

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { timeSlots: updatedTimeSlots }
    });

    console.log('Updated schedule timeSlots for 09:00');

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

createTodayAppointment();