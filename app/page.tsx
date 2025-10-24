import { getServerSession } from 'next-auth/next';
import { authOptions } from './api/auth/[...nextauth]/route';
import HomePage from './home-page';

export default async function Page() {
  const session = await getServerSession(authOptions);

  return <HomePage session={session} />;
}
