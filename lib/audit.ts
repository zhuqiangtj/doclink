import { Role } from '@prisma/client';
import { prisma } from './prisma';

interface SessionUser {
  id: string;
  username: string; // New: for username-based login
  name: string;     // New: for all users
  phone?: string;   // New: optional for all users
  dateOfBirth?: Date; // New: optional for all users
  gender?: string;  // New: optional for all users
  role: Role;
}

export async function createAuditLog(session: { user: SessionUser } | null, action: string, entityType: string, entityId?: string, details?: Record<string, unknown>) {
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