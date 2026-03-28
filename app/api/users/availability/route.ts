import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function findAvailableUsername(baseUsername: string): Promise<string> {
  let candidate = baseUsername;
  let counter = 1;

  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${baseUsername}${counter}`;
    counter += 1;
  }

  return candidate;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');

  if (!username) {
    return NextResponse.json({ error: '缺少用户名。' }, { status: 400 });
  }

  if (username.length < 3) {
    return NextResponse.json({ available: false, message: '用户名至少需要3个字符。' });
  }

  try {
    const suggestedUsername = await findAvailableUsername(username);

    if (suggestedUsername === username) {
      return NextResponse.json({
        available: true,
        message: '用户名可用。',
        suggestedUsername,
      });
    }

    return NextResponse.json({
      available: false,
      message: `用户名已被占用，可改用 ${suggestedUsername}。`,
      suggestedUsername,
    });
  } catch (error) {
    console.error('Error checking username availability:', error);
    return NextResponse.json({ error: '服务器内部错误。' }, { status: 500 });
  }
}
