const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
  try {
    // 檢查患者（包含用戶信息）
    const patients = await prisma.patient.findMany({
      include: {
        user: true
      }
    });
    console.log('所有患者:');
    patients.forEach(p => console.log({ 
      id: p.id, 
      userId: p.userId,
      name: p.user.name,
      username: p.user.username 
    }));
    
    // 檢查預約（包含患者和用戶信息）
    const appointments = await prisma.appointment.findMany({
      include: {
        patient: {
          include: {
            user: true
          }
        }
      }
    });
    
    console.log('\n預約和患者關聯:');
    appointments.forEach(apt => {
      console.log({
        appointmentId: apt.id,
        patientId: apt.patientId,
        patientName: apt.patient?.user?.name,
        time: apt.time,
        status: apt.status,
        appointmentDate: apt.appointmentDate
      });
    });
    
    // 查找王美麗
    const wangMeili = patients.find(p => p.user.name === '王美麗');
    if (wangMeili) {
      console.log('\n王美麗的信息:', {
        patientId: wangMeili.id,
        userId: wangMeili.userId,
        name: wangMeili.user.name,
        username: wangMeili.user.username
      });
      
      const wangMeiliAppointments = appointments.filter(apt => apt.patientId === wangMeili.id);
      console.log('王美麗的預約:', wangMeiliAppointments.map(apt => ({
        id: apt.id,
        time: apt.time,
        status: apt.status,
        appointmentDate: apt.appointmentDate
      })));
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