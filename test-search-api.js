const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSearchLogic() {
  console.log('測試患者搜索邏輯...\n');

  const searchQuery = '李小明';
  console.log(`搜索查詢: "${searchQuery}"`);

  try {
    // 複製API中的查詢邏輯
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          {
            user: {
              username: {
                contains: searchQuery,
                mode: 'insensitive',
              },
            },
          },
          {
            user: {
              name: {
                contains: searchQuery,
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      select: {
        id: true,
        credibilityScore: true,
        isSuspended: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            phone: true,
            dateOfBirth: true,
            gender: true,
          },
        },
      },
      take: 10,
    });

    console.log('搜索結果:');
    console.log(JSON.stringify(patients, null, 2));

    // 測試其他搜索詞
    const testQueries = ['李小', '李雅', 'patient1', '王美'];
    
    for (const query of testQueries) {
      console.log(`\n測試搜索: "${query}"`);
      const results = await prisma.patient.findMany({
        where: {
          OR: [
            {
              user: {
                username: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            },
            {
              user: {
                name: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
        select: {
          id: true,
          user: {
            select: {
              username: true,
              name: true,
            },
          },
        },
        take: 10,
      });
      
      console.log(`結果數量: ${results.length}`);
      results.forEach(result => {
        console.log(`- ${result.user.name} (${result.user.username})`);
      });
    }

  } catch (error) {
    console.error('搜索失敗:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSearchLogic();