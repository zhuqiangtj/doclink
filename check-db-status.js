const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkData() {
  try {
    console.log('檢查所有用戶:');
    const users = await prisma.user.findMany({
      select: { id: true, username: true, name: true, role: true }
    });
    
    console.log(`總用戶數: ${users.length}`);
    users.forEach((user, i) => {
      console.log(`  ${i+1}. ${user.name} (${user.username}) - ${user.role}`);
    });
    
    console.log('\n檢查所有患者:');
    const patients = await prisma.patient.findMany({
      include: { 
        user: { 
          select: { username: true, name: true } 
        } 
      }
    });
    
    console.log(`總患者數: ${patients.length}`);
    patients.forEach((patient, i) => {
      console.log(`  ${i+1}. ${patient.user.name} (${patient.user.username})`);
    });
    
    // 測試搜索
    console.log('\n測試搜索 "李":');
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
          select: { username: true, name: true }
        }
      }
    });
    
    console.log(`搜索結果數: ${searchResults.length}`);
    searchResults.forEach((patient, i) => {
      console.log(`  ${i+1}. ${patient.user.name} (${patient.user.username})`);
    });
    
  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();