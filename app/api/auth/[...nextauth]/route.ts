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
        if (!credentials?.username || !credentials.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username }
        });

        if (!user || !user.password) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);

        if (isValid) {
          // Return user object that will be encoded in the JWT
          return { 
            id: user.id, 
            username: user.username, 
            name: user.name, 
            phone: user.phone, 
            dateOfBirth: user.dateOfBirth, 
            gender: user.gender, 
            role: user.role 
          };
        } else {
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
      // On initial sign-in, the user object is available. Persist the required data to the token.
      if (user) {
        return {
          ...token,
          id: user.id,
          username: user.username,
          name: user.name,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          role: user.role,
        };
      }
      // On subsequent requests, the token is available. Return it as is.
      return token;
    },
    async session({ session, token }) {
      // The session callback is called whenever a session is checked.
      // We assign the user's id, username, role, and other details from the token to the session object.
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.role = token.role as 'PATIENT' | 'DOCTOR' | 'ADMIN';
        session.user.phone = token.phone as string | undefined;
        session.user.dateOfBirth = token.dateOfBirth as Date | undefined;
        session.user.gender = token.gender as string | undefined;
      }
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