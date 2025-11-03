const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAppointments() {
  try {
    const appointments = await prisma.appointment.findMany({
      include: {
        patient: true,
        history: true
      }
    });
    
    console.log('所有預約:');
    appointments.forEach(apt => {
      console.log({
        id: apt.id,
        patientName: apt.patient.name,
        appointmentDate: apt.appointmentDate,
        time: apt.time,
        status: apt.status,
        historyCount: apt.history.length
      });
    });
    
    const wangMeili = appointments.find(apt => apt.patient.name === '王美麗');
    if (wangMeili) {
      console.log('\n王美麗的預約詳情:', wangMeili);
    } else {
      console.log('\n未找到王美麗的預約');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAppointments();