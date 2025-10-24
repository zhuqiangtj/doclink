import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      phone?: string;
      dateOfBirth?: Date;
      gender?: string;
      role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
    username: string;
    phone?: string;
    dateOfBirth?: Date;
    gender?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    phone?: string;
    dateOfBirth?: Date;
    gender?: string;
    role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  }
}