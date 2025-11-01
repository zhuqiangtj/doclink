import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchQuery = searchParams.get('q') || '';

  try {
    console.log('[DEBUG] 搜索查詢:', searchQuery);

    // 首先獲取所有患者
    const allPatients = await prisma.patient.findMany({
      select: {
        id: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    console.log('[DEBUG] 所有患者數量:', allPatients.length);
    console.log('[DEBUG] 所有患者:', JSON.stringify(allPatients, null, 2));

    if (!searchQuery || searchQuery.length < 2) {
      return NextResponse.json({
        message: '搜索查詢太短',
        allPatients: allPatients,
        searchQuery: searchQuery
      });
    }

    // 執行搜索
    const searchResults = await prisma.patient.findMany({
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

    console.log('[DEBUG] 搜索結果數量:', searchResults.length);
    console.log('[DEBUG] 搜索結果:', JSON.stringify(searchResults, null, 2));

    return NextResponse.json({
      searchQuery: searchQuery,
      allPatientsCount: allPatients.length,
      searchResultsCount: searchResults.length,
      allPatients: allPatients,
      searchResults: searchResults
    });

  } catch (error) {
    console.error('[DEBUG] 搜索錯誤:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      searchQuery: searchQuery
    }, { status: 500 });
  }
}