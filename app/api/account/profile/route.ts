import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed


export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { username, name, phone, dateOfBirth, gender } = await request.json();
    const { id, role } = session.user;

    let updatedProfile;
    let entityType: string = 'User';
    let entityId: string = id;

    // Update User model fields
    const userDataToUpdate: { username?: string; name?: string; phone?: string; dateOfBirth?: Date; gender?: string } = {};
    if (username && username !== session.user.username) {
      const existingUserWithUsername = await prisma.user.findUnique({ where: { username } });
      if (existingUserWithUsername && existingUserWithUsername.id !== id) {
        return NextResponse.json({ error: 'Username already in use.' }, { status: 409 });
      }
      userDataToUpdate.username = username;
    }
    if (name) userDataToUpdate.name = name;
    if (phone) userDataToUpdate.phone = phone;
    if (dateOfBirth) userDataToUpdate.dateOfBirth = new Date(dateOfBirth);
    if (gender) userDataToUpdate.gender = gender;

    if (Object.keys(userDataToUpdate).length > 0) {
      await prisma.user.update({
        where: { id },
        data: userDataToUpdate,
      });
    }

    // Profile-specific updates (name is now on User, so only patient-specific fields remain)
    if (role === 'PATIENT') {
      // No patient-specific fields to update via this route currently, as name/phone are on User
      // If credibilityScore or isSuspended were editable by patient, they would go here.
      updatedProfile = await prisma.patient.findUnique({ where: { userId: id } }); // Just fetch to return
      entityType = 'Patient';
      entityId = updatedProfile?.id || id;
    } else if (role === 'DOCTOR') {
      // No doctor-specific fields to update via this route currently, as name is on User
      updatedProfile = await prisma.doctor.findUnique({ where: { userId: id } }); // Just fetch to return
      entityType = 'Doctor';
      entityId = updatedProfile?.id || id;
    } else { // ADMIN
      updatedProfile = await prisma.user.findUnique({ where: { id } });
    }

    if (!updatedProfile) {
      return NextResponse.json({ error: 'Profile not found for this user.' }, { status: 404 });
    }

    await createAuditLog(session, 'UPDATE_PROFILE', entityType, entityId, { username, name, phone, dateOfBirth, gender });
    return NextResponse.json(updatedProfile);

  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}