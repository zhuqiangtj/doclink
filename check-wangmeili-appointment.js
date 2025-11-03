const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkWangMeiliAppointment() {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: 'cmhify9po000jlhag8to227j3' },
      include: {
        patient: {
          include: {
            user: true
          }
        },
        history: true,
        doctor: {
          include: {
            user: true
          }
        },
        schedule: true
      }
    });
    
    console.log('王美麗預約的完整信息:');
    console.log(JSON.stringify(appointment, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWangMeiliAppointment();