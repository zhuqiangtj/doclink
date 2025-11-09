import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');

  if (!username) {
    return NextResponse.json({ error: 'Username is required.' }, { status: 400 });
  }

  if (username.length < 3) {
    return NextResponse.json({ available: false, message: '用户名至少需要3个字符。' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return NextResponse.json({ available: false, message: '用户名已被占用。' });
    } else {
      return NextResponse.json({ available: true, message: '用户名可用。' });
    }
  } catch (error) {
    console.error('Error checking username availability:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
