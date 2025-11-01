const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixRooms() {
  try {
    // 獲取 doctor1 的醫生資料ID
    const doctor1 = await prisma.user.findUnique({
      where: { username: 'doctor1' },
      include: {
        doctorProfile: true
      }
    });
    
    if (!doctor1 || !doctor1.doctorProfile) {
      console.log('Doctor1 profile not found');
      return;
    }
    
    const doctorProfileId = doctor1.doctorProfile.id;
    console.log('Doctor1 profile ID:', doctorProfileId);
    
    // 將所有房間分配給 doctor1
    const updatedRooms = await prisma.room.updateMany({
      data: {
        doctorId: doctorProfileId
      }
    });
    
    console.log('Updated rooms count:', updatedRooms.count);
    
    // 驗證更新
    const rooms = await prisma.room.findMany({
      where: {
        doctorId: doctorProfileId
      }
    });
    
    console.log('Rooms now assigned to doctor1:', JSON.stringify(rooms, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixRooms();