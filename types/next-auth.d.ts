import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";
import { Role } from "@prisma/client";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      /** The user's id. */
      id: string;
      /** The user's username. */
      username: string;
      /** The user's name. */
      name: string;
      /** The user's phone. */
      phone?: string | null;
      /** The user's date of birth. */
      dateOfBirth?: Date | null;
      /** The user's gender. */
      gender?: string | null;
      /** The user's role. */
      role: Role;
    } & DefaultSession["user"];
  }

  /**
   * The shape of the user object returned in the OAuth providers' `profile` callback,
   * or the second parameter of the `session` callback, when using a database.
   */
  interface User extends DefaultUser {
    username: string;
    name: string;
    phone?: string | null;
    dateOfBirth?: Date | null;
    gender?: string | null;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  /** Returned by the `jwt` callback and `getToken`, when using JWT sessions */
  interface JWT extends DefaultJWT {
    /** User ID */
    id: string;
    /** User Username */
    username: string;
    /** User Name */
    name: string;
    /** User Phone */
    phone?: string | null;
    /** User Date of Birth */
    dateOfBirth?: Date | null;
    /** User Gender */
    gender?: string | null;
    /** User Role */
    role: Role;
  }
}