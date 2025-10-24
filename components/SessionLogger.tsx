'use client';

import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

export default function SessionLogger() {
  const { data: session, status } = useSession();

  useEffect(() => {
    console.log('Session from SessionLogger:', { session, status });
  }, [session, status]);

  return null;
}
