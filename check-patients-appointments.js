const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
  try {
    // 檢查患者
    const patients = await prisma.patient.findMany();
    console.log('所有患者:');
    patients.forEach(p => console.log({ id: p.id, name: p.name }));
    
    // 檢查預約（包含患者信息）
    const appointments = await prisma.appointment.findMany({
      include: {
        patient: true
      }
    });
    
    console.log('\n預約和患者關聯:');
    appointments.forEach(apt => {
      console.log({
        appointmentId: apt.id,
        patientId: apt.patientId,
        patient: apt.patient ? { id: apt.patient.id, name: apt.patient.name } : null,
        time: apt.time,
        status: apt.status
      });
    });
    
    // 查找王美麗
    const wangMeili = patients.find(p => p.name === '王美麗');
    if (wangMeili) {
      console.log('\n王美麗的信息:', wangMeili);
      
      const wangMeiliAppointments = appointments.filter(apt => apt.patientId === wangMeili.id);
      console.log('王美麗的預約:', wangMeiliAppointments);
    } else {
      console.log('\n未找到王美麗患者記錄');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();