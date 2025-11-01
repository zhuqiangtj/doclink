const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkPatients() {
  try {
    console.log('檢查所有用戶...');
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
      }
    });
    console.log('用戶數據:', users);

    console.log('\n檢查所有患者...');
    const patients = await prisma.patient.findMany({
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          }
        }
      }
    });
    console.log('患者數據:', patients);

    console.log('\n搜索包含"李"的患者...');
    const searchResults = await prisma.patient.findMany({
      where: {
        OR: [
          {
            user: {
              username: {
                contains: '李',
                mode: 'insensitive',
              },
            },
          },
          {
            user: {
              name: {
                contains: '李',
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          }
        }
      }
    });
    console.log('搜索結果:', searchResults);

  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPatients();