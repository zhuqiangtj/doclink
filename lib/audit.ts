import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

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
  await prisma.auditLog.create({
    data: {
      userId: session?.user?.id,
      userUsername: session?.user?.username, // Log username instead of email
      userRole: session?.user?.role,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}