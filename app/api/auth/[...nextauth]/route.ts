import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        console.log('[AUTH] Authorize attempt for username:', credentials?.username);
        if (!credentials?.username || !credentials.password) {
          console.error('[AUTH] Missing credentials');
          return null;
        }

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
          return user;
        } else {
          console.error(`[AUTH] Invalid password for: ${credentials.username}`);
          return null;
        }
      }
    })
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, user object is available.
      if (user) {
        console.log(`[AUTH] JWT: Initial sign-in for user ${user.username}`);
        token.id = user.id;
        token.username = user.username;
        token.name = user.name;
        token.phone = user.phone;
        token.dateOfBirth = user.dateOfBirth;
        token.gender = user.gender;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
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

export { handler as GET, handler as POST, authOptions }; // Export authOptions as well