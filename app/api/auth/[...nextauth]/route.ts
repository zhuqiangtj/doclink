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
      console.log('JWT callback', { token, user });
      // When the user signs in, the user object is passed to the JWT callback.
      // We add the user's id, username, and role to the token.
      if (user) {
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
      console.log('Session callback', { session, token });
      // The session callback is called whenever a session is checked.
      // We add the id, username, and role from the token to the session object.
      if (session.user) {
        session.user.id = token.id;
        session.user.username = token.username;
        session.user.name = token.name;
        session.user.phone = token.phone;
        session.user.dateOfBirth = token.dateOfBirth;
        session.user.gender = token.gender;
        session.user.role = token.role;
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