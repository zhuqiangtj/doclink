import { Role } from '@prisma/client';
import { prisma } from './prisma';

interface SessionUser {
  id?: string;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  role?: Role | null;
}

export async function createAuditLog(
  session: { user?: SessionUser | null } | null,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  console.log('Creating audit log with:', { session, action, entityType, entityId, details });
  try {
    await prisma.auditLog.create({
      data: {
        userId: session?.user?.id,
        userName: session?.user?.name,
        userUsername: session?.user?.username,
        userRole: session?.user?.role,
        action,
        entityType,
        entityId,
        details: details ? JSON.stringify(details) : undefined,
      },
    });
    console.log('Audit log created successfully.');
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}
