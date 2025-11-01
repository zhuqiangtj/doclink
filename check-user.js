const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { username: 'doctor1' }
    });
    console.log('User found:', user ? { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      hasPassword: !!user.password 
    } : 'Not found');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();