const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRooms() {
  try {
    console.log('Checking all rooms...');
    const rooms = await prisma.room.findMany();
    console.log('All rooms:', JSON.stringify(rooms, null, 2));
    
    console.log('\nChecking doctor1 profile...');
    const doctor = await prisma.user.findUnique({
      where: { username: 'doctor1' },
      include: {
        doctorProfile: {
          include: {
            Room: true
          }
        }
      }
    });
    
    if (doctor && doctor.doctorProfile) {
      console.log('Doctor profile found');
      console.log('Associated rooms:', doctor.doctorProfile.Room);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRooms();