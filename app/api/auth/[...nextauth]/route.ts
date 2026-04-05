import NextAuth, {
  type NextAuthOptions,
  type Session,
  type User as NextAuthUser,
} from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter } from 'next-auth/adapters';
import type { JWT } from 'next-auth/jwt';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import {
  resolveExistingPatientFromScan,
  resolvePatientFromScan,
} from '@/lib/patient-scan-auth';

function toAuthUser(user: {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
}): NextAuthUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone ?? undefined,
    dateOfBirth: user.dateOfBirth ?? undefined,
    gender: user.gender ?? undefined,
    role: user.role,
  };
}

const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials, _req) {
        console.log('[AUTH] Authorize attempt for username:', credentials?.username);
        if (!credentials?.username || !credentials.password) {
          console.error('[AUTH] Missing credentials');
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { username: credentials.username }
          });

          if (!user || !user.password) {
            console.error(`[AUTH] User not found or no password for: ${credentials.username}`);
            return null;
          }

          const isValid = await bcrypt.compare(credentials.password, user.password);

          if (isValid) {
            console.log(`[AUTH] Success for: ${user.username}, Role: ${user.role}`);
            return toAuthUser(user);
          } else {
            console.error(`[AUTH] Invalid password for: ${credentials.username}`);
            return null;
          }
        } catch (error) {
          console.error('[AUTH] Database error:', error);
          return null;
        }
      }
    }),
    CredentialsProvider({
      id: 'patient-card-login',
      name: 'Patient Card Login',
      credentials: {
        socialSecurityNumber: { label: 'Social Security Number', type: 'text' },
        name: { label: 'Name', type: 'text' },
        gender: { label: 'Gender', type: 'text' },
        dateOfBirth: { label: 'Date of Birth', type: 'text' },
      },
      async authorize(credentials, _req) {
        console.log(
          '[AUTH] Patient card login attempt for socialSecurityNumber:',
          credentials?.socialSecurityNumber
        );

        try {
          const user = await resolveExistingPatientFromScan({
            socialSecurityNumber: credentials?.socialSecurityNumber,
            name: credentials?.name,
            gender: credentials?.gender,
            dateOfBirth: credentials?.dateOfBirth,
          });

          console.log(`[AUTH] Patient card login success for: ${user.username}`);
          return toAuthUser(user);
        } catch (error) {
          console.error('[AUTH] Patient card login failed:', error);
          return null;
        }
      }
    }),
    CredentialsProvider({
      id: 'patient-scan',
      name: 'Patient Scan',
      credentials: {
        socialSecurityNumber: { label: 'Social Security Number', type: 'text' },
        name: { label: 'Name', type: 'text' },
        gender: { label: 'Gender', type: 'text' },
        dateOfBirth: { label: 'Date of Birth', type: 'text' },
      },
      async authorize(credentials, _req) {
        console.log(
          '[AUTH] Patient scan authorize attempt for socialSecurityNumber:',
          credentials?.socialSecurityNumber
        );

        try {
          const result = await resolvePatientFromScan({
            socialSecurityNumber: credentials?.socialSecurityNumber,
            name: credentials?.name,
            gender: credentials?.gender,
            dateOfBirth: credentials?.dateOfBirth,
          });

          console.log(
            `[AUTH] Patient scan success for: ${result.user.username}, created=${result.created}, linked=${result.linked}`
          );
          return toAuthUser(result.user);
        } catch (error) {
          console.error('[AUTH] Patient scan failed:', error);
          return null;
        }
      }
    })
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({
      token,
      user,
      trigger,
    }: {
      token: JWT;
      user?: NextAuthUser;
      trigger?: 'signIn' | 'signUp' | 'update';
    }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.name = user.name ?? undefined;
        token.phone = user.phone;
        token.dateOfBirth = user.dateOfBirth;
        token.gender = user.gender;
        token.role = user.role;
      }
      if (trigger === 'update' && token?.id) {
        try {
          const fresh = await prisma.user.findUnique({ where: { id: token.id as string } });
          if (fresh) {
            token.username = fresh.username;
            token.name = fresh.name;
            token.phone = fresh.phone ?? undefined;
            token.dateOfBirth = fresh.dateOfBirth ?? undefined;
            token.gender = fresh.gender ?? undefined;
            token.role = fresh.role;
          }
        } catch {}
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      // The session object is what the client-side receives.
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.role = token.role as 'PATIENT' | 'DOCTOR' | 'ADMIN';
        session.user.phone = token.phone as string | undefined;
        session.user.dateOfBirth = token.dateOfBirth as Date | undefined;
        session.user.gender = token.gender as string | undefined;
      }
      // console.log('[AUTH] Session created:', session);
      return session;
    }
  },
  pages: {
    signIn: '/auth/signin', // A custom sign-in page
    // error: '/auth/error', // A custom error page
  },
  secret: process.env.AUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
export { authOptions };
