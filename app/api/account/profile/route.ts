import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed

const prisma = new PrismaClient();

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name, phone } = await request.json();
    const { id, role } = session.user;

    let updatedProfile;
    let entityType: string = 'User';
    let entityId: string = id;

    if (role === 'DOCTOR') {
      updatedProfile = await prisma.doctor.update({
        where: { userId: id },
        data: { name },
      });
      entityType = 'Doctor';
      entityId = updatedProfile.id;
    } else if (role === 'PATIENT') {
      updatedProfile = await prisma.patient.update({
        where: { userId: id },
        data: { name, phone },
      });
      entityType = 'Patient';
      entityId = updatedProfile.id;
    } else { // ADMIN
      // Admins might not have a separate profile table, update User name directly if needed
      // For now, just return the user object
      const adminUser = await prisma.user.findUnique({ where: { id } });
      updatedProfile = adminUser;
    }

    if (!updatedProfile) {
      return NextResponse.json({ error: 'Profile not found for this user.' }, { status: 404 });
    }

    await createAuditLog(session, 'UPDATE_PROFILE', entityType, entityId, { name, phone });
    return NextResponse.json(updatedProfile);

  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
