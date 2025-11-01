const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDoctorProfile() {
  try {
    const user = await prisma.user.findUnique({
      where: { username: 'doctor1' },
      include: { doctorProfile: true }
    });
    
    if (user) {
      console.log('User found:', {
        id: user.id,
        username: user.username,
        role: user.role,
        doctorProfile: user.doctorProfile
      });
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDoctorProfile();