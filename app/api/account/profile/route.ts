import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed
import {
  checkResidentIdConsistency,
  getResidentIdValidationError,
} from '@/lib/china-resident-id';
import { normalizeGovernmentId } from '@/lib/patient-scan-auth';


export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { username, name, phone, dateOfBirth, gender, socialSecurityNumber } = body;
    const { id, role } = session.user;

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        name: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        socialSecurityNumber: true,
      },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    let updatedProfile;
    let entityType: string = 'User';
    let entityId: string = id;

    // Update User model fields
    const userDataToUpdate: {
      username?: string;
      name?: string;
      phone?: string;
      dateOfBirth?: Date;
      gender?: string;
      socialSecurityNumber?: string | null;
    } = {};
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

    const hasSocialSecurityNumberField = Object.prototype.hasOwnProperty.call(
      body,
      'socialSecurityNumber'
    );
    const normalizedSocialSecurityNumber = hasSocialSecurityNumberField
      ? normalizeGovernmentId(socialSecurityNumber || null)
      : existingUser.socialSecurityNumber;

    if (hasSocialSecurityNumberField && socialSecurityNumber && !normalizedSocialSecurityNumber) {
      return NextResponse.json(
        {
          error:
            getResidentIdValidationError(socialSecurityNumber || null) ||
            '社保号格式无效，请核对后再保存。',
        },
        { status: 400 }
      );
    }

    const nextGender = typeof gender === 'string' && gender ? gender : (existingUser.gender || '');
    const nextDateOfBirth =
      typeof dateOfBirth === 'string' && dateOfBirth
        ? dateOfBirth
        : (existingUser.dateOfBirth ? existingUser.dateOfBirth.toISOString().split('T')[0] : '');

    if (normalizedSocialSecurityNumber) {
      const consistency = checkResidentIdConsistency({
        governmentId: normalizedSocialSecurityNumber,
        gender: nextGender,
        dateOfBirth: nextDateOfBirth,
      });

      if (!consistency.isConsistent) {
        return NextResponse.json(
          { error: consistency.message || '社保号与出生日期或性别不一致，请核对后再保存。' },
          { status: 400 }
        );
      }

      const conflictedUser = await prisma.user.findFirst({
        where: {
          socialSecurityNumber: normalizedSocialSecurityNumber,
          id: {
            not: id,
          },
        },
        select: {
          name: true,
          username: true,
        },
      });

      if (conflictedUser) {
        return NextResponse.json(
          {
            error: `该社保号已关联病人 ${conflictedUser.name}，用户名是 ${conflictedUser.username}。`,
            existingUsername: conflictedUser.username,
          },
          { status: 409 }
        );
      }

      userDataToUpdate.socialSecurityNumber = normalizedSocialSecurityNumber;
    }

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

    await createAuditLog(session, 'UPDATE_PROFILE', entityType, entityId, {
      username,
      name,
      phone,
      dateOfBirth,
      gender,
      socialSecurityNumber: normalizedSocialSecurityNumber,
    });
    return NextResponse.json(updatedProfile);

  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
