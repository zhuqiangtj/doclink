import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export async function createAuditLog(session: { user: SessionUser } | null, action: string, entityType: string, entityId?: string, details?: any) {
  await prisma.auditLog.create({
    data: {
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      userRole: session?.user?.role,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}
