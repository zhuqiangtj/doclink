import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  checkResidentIdConsistency,
  getResidentIdValidationError,
} from '@/lib/china-resident-id';
import { prisma } from '@/lib/prisma';
import { normalizeGovernmentId } from '@/lib/patient-scan-auth';

export const dynamic = 'force-dynamic';

function formatDateOnly(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

function calculateAge(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;

  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < birth.getDate())
  ) {
    age -= 1;
  }

  return age;
}

function formatPatientSummary(patient: {
  id: string;
  credibilityScore: number;
  user: {
    username: string;
    name: string;
    phone: string | null;
    gender: string | null;
    dateOfBirth: Date | null;
    socialSecurityNumber: string | null;
  };
  appointments: Array<{ status: string }>;
}) {
  const visitCount = patient.appointments.filter((appointment) => appointment.status === 'COMPLETED').length;
  const noShowCount = patient.appointments.filter((appointment) => appointment.status === 'NO_SHOW').length;

  return {
    id: patient.id,
    username: patient.user.username,
    name: patient.user.name,
    gender: patient.user.gender,
    dateOfBirth: formatDateOnly(patient.user.dateOfBirth),
    age: calculateAge(patient.user.dateOfBirth),
    phone: patient.user.phone,
    socialSecurityNumber: patient.user.socialSecurityNumber,
    credibilityScore: patient.credibilityScore,
    visitCount,
    noShowCount,
    totalAppointments: patient.appointments.length,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only DOCTOR and ADMIN can view patient details
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: patientId } = await context.params;

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        user: {
          select: {
            username: true,
            name: true,
            phone: true,
            gender: true,
            dateOfBirth: true,
            socialSecurityNumber: true,
          }
        },
        appointments: {
          orderBy: [
            {
              schedule: {
                date: 'desc'
              }
            },
            {
              timeSlot: {
                startTime: 'desc'
              }
            }
          ],
          select: {
            id: true,
            time: true,
            status: true,
            symptoms: true,
            treatmentPlan: true,
            schedule: {
              select: {
                date: true
              }
            }
          }
        }
      }
    });

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    
    const formattedAppointments = patient.appointments.map(apt => ({
      id: apt.id,
      date: apt.schedule.date,
      time: apt.time,
      status: apt.status,
      symptoms: apt.symptoms,
      treatmentPlan: apt.treatmentPlan
    }));

    return NextResponse.json({
      patient: formatPatientSummary(patient),
      appointments: formattedAppointments
    });

  } catch (error) {
    console.error('Error fetching patient:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only DOCTOR and ADMIN can update patient details
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: patientId } = await context.params;
  
  try {
    const body = await request.json();
    const existingPatient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            phone: true,
            gender: true,
            dateOfBirth: true,
            socialSecurityNumber: true,
          },
        },
        appointments: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!existingPatient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const { credibilityScore } = body as { credibilityScore?: number };
    const hasProfileFields = ['name', 'phone', 'gender', 'dateOfBirth', 'socialSecurityNumber']
      .some((field) => Object.prototype.hasOwnProperty.call(body, field));

    if (!hasProfileFields) {
      if (credibilityScore === undefined || typeof credibilityScore !== 'number') {
        return NextResponse.json({ error: 'Valid credibilityScore is required' }, { status: 400 });
      }

      const updatedPatient = await prisma.patient.update({
        where: { id: patientId },
        data: {
          credibilityScore,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              phone: true,
              gender: true,
              dateOfBirth: true,
              socialSecurityNumber: true,
            },
          },
          appointments: {
            select: {
              status: true,
            },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          userName: session.user.name,
          userUsername: session.user.username,
          userRole: session.user.role,
          action: 'UPDATE_PATIENT_CREDIBILITY',
          entityType: 'Patient',
          entityId: patientId,
          details: JSON.stringify({
            oldScore: existingPatient.credibilityScore,
            newScore: credibilityScore,
            updatedBy: session.user.id,
          }),
        },
      });

      return NextResponse.json({
        patient: formatPatientSummary(updatedPatient),
      });
    }

    const nextName =
      typeof body.name === 'string' ? body.name.trim() : existingPatient.user.name;
    const nextPhone =
      typeof body.phone === 'string' ? body.phone.trim() : (existingPatient.user.phone || '');
    const nextGender =
      typeof body.gender === 'string' ? body.gender : (existingPatient.user.gender || '');
    const nextDateOfBirth =
      typeof body.dateOfBirth === 'string'
        ? body.dateOfBirth
        : (formatDateOnly(existingPatient.user.dateOfBirth) || '');

    if (nextName.length < 2) {
      return NextResponse.json({ error: '姓名至少需要 2 个字。' }, { status: 400 });
    }

    if (!['Male', 'Female', 'Other'].includes(nextGender)) {
      return NextResponse.json({ error: '请选择有效的性别。' }, { status: 400 });
    }

    if (!nextDateOfBirth) {
      return NextResponse.json({ error: '出生日期不能为空。' }, { status: 400 });
    }

    const birthDate = new Date(nextDateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      return NextResponse.json({ error: '出生日期格式无效。' }, { status: 400 });
    }

    if (!/^[1-9]\d{10}$/.test(nextPhone)) {
      return NextResponse.json({ error: '请输入有效的 11 位手机号码。' }, { status: 400 });
    }

    const hasSocialSecurityNumberField = Object.prototype.hasOwnProperty.call(
      body,
      'socialSecurityNumber'
    );
    const normalizedSocialSecurityNumber = hasSocialSecurityNumberField
      ? normalizeGovernmentId(body.socialSecurityNumber || null)
      : existingPatient.user.socialSecurityNumber;

    if (
      hasSocialSecurityNumberField &&
      body.socialSecurityNumber &&
      !normalizedSocialSecurityNumber
    ) {
      return NextResponse.json(
        {
          error:
            getResidentIdValidationError(body.socialSecurityNumber || null) ||
            '社保号格式无效，请核对后再保存。',
        },
        { status: 400 }
      );
    }

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
    }

    if (normalizedSocialSecurityNumber) {
      const conflictedUser = await prisma.user.findFirst({
        where: {
          socialSecurityNumber: normalizedSocialSecurityNumber,
          id: {
            not: existingPatient.user.id,
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
    }

    const updatedPatient = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existingPatient.user.id },
        data: {
          name: nextName,
          phone: nextPhone,
          gender: nextGender,
          dateOfBirth: new Date(nextDateOfBirth),
          socialSecurityNumber: normalizedSocialSecurityNumber,
        },
      });

      if (typeof credibilityScore === 'number') {
        await tx.patient.update({
          where: { id: patientId },
          data: {
            credibilityScore,
          },
        });
      }

      return tx.patient.findUnique({
        where: { id: patientId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              phone: true,
              gender: true,
              dateOfBirth: true,
              socialSecurityNumber: true,
            },
          },
          appointments: {
            select: {
              status: true,
            },
          },
        },
      });
    });

    if (!updatedPatient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userName: session.user.name,
        userUsername: session.user.username,
        userRole: session.user.role,
        action: 'UPDATE_PATIENT_PROFILE',
        entityType: 'Patient',
        entityId: patientId,
        details: JSON.stringify({
          before: {
            name: existingPatient.user.name,
            phone: existingPatient.user.phone,
            gender: existingPatient.user.gender,
            dateOfBirth: formatDateOnly(existingPatient.user.dateOfBirth),
            socialSecurityNumber: existingPatient.user.socialSecurityNumber,
            credibilityScore: existingPatient.credibilityScore,
          },
          after: {
            name: updatedPatient.user.name,
            phone: updatedPatient.user.phone,
            gender: updatedPatient.user.gender,
            dateOfBirth: formatDateOnly(updatedPatient.user.dateOfBirth),
            socialSecurityNumber: updatedPatient.user.socialSecurityNumber,
            credibilityScore: updatedPatient.credibilityScore,
          },
          updatedBy: session.user.id,
        }),
      },
    });

    return NextResponse.json({
      patient: formatPatientSummary(updatedPatient),
    });

  } catch (error) {
    console.error('Error updating patient:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only DOCTOR and ADMIN can delete patient records
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: patientId } = await context.params;

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          },
        },
        appointments: {
          select: {
            id: true,
            status: true,
            timeSlotId: true,
          },
        },
      },
    });

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const appointmentIds = patient.appointments.map((appointment) => appointment.id);
    const pendingReleaseByTimeSlot = new Map<string, number>();

    for (const appointment of patient.appointments) {
      if (appointment.status === 'PENDING' && appointment.timeSlotId) {
        pendingReleaseByTimeSlot.set(
          appointment.timeSlotId,
          (pendingReleaseByTimeSlot.get(appointment.timeSlotId) || 0) + 1
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const [timeSlotId, releaseCount] of pendingReleaseByTimeSlot.entries()) {
        await tx.timeSlot.updateMany({
          where: { id: timeSlotId },
          data: {
            availableBeds: {
              increment: releaseCount,
            },
          },
        });
      }

      if (appointmentIds.length > 0) {
        await tx.notification.deleteMany({
          where: {
            appointmentId: {
              in: appointmentIds,
            },
          },
        });

        await tx.patientNotification.deleteMany({
          where: {
            OR: [
              { userId: patient.userId },
              {
                appointmentId: {
                  in: appointmentIds,
                },
              },
            ],
          },
        });

        await tx.appointmentHistory.deleteMany({
          where: {
            appointmentId: {
              in: appointmentIds,
            },
          },
        });

        await tx.appointment.deleteMany({
          where: {
            id: {
              in: appointmentIds,
            },
          },
        });
      } else {
        await tx.patientNotification.deleteMany({
          where: { userId: patient.userId },
        });
      }

      await tx.account.deleteMany({
        where: { userId: patient.userId },
      });

      await tx.session.deleteMany({
        where: { userId: patient.userId },
      });

      await tx.patient.delete({
        where: { id: patientId },
      });

      await tx.user.delete({
        where: { id: patient.userId },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          userName: session.user.name,
          userUsername: session.user.username,
          userRole: session.user.role,
          action: 'DELETE_PATIENT',
          entityType: 'Patient',
          entityId: patientId,
          details: JSON.stringify({
            deletedPatientUserId: patient.userId,
            deletedPatientUsername: patient.user.username,
            deletedPatientName: patient.user.name,
            deletedPatientRole: patient.user.role,
            deletedAppointmentCount: appointmentIds.length,
            releasedPendingAppointmentCount: Array.from(pendingReleaseByTimeSlot.values()).reduce(
              (sum, count) => sum + count,
              0
            ),
          }),
        },
      });
    });

    return NextResponse.json({
      message: `已删除病人 ${patient.user.name}`,
      deletedAppointments: appointmentIds.length,
    });
  } catch (error) {
    console.error('Error deleting patient:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
