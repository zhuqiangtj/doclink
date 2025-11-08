const { PrismaClient } = require('@prisma/client');

async function checkAppointmentStatus() {
  const prisma = new PrismaClient();
  
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: 'cmhhlvgxm0003lh8cn5jcxowh' },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        schedule: true,
        room: true
      }
    });
    
    if (appointment) {
console.log('预约详情：', {
        id: appointment.id,
        patient: appointment.patient.user.name,
        doctor: appointment.doctor.user.name,
        date: appointment.schedule.date,
        time: appointment.time,
        status: appointment.status,
        reason: appointment.reason,
        room: appointment.room.name
      });
    } else {
console.log('预约已被删除或不存在');
    }
    
  } catch (error) {
console.error('检查预约状态时发生错误：', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAppointmentStatus();