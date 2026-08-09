import { useUser } from '@clerk/react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';

/**
 * Local app user (with role) for the signed-in Clerk session.
 * `role` is null while loading or when signed out.
 */
export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useUser();
  const query = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: isLoaded && !!isSignedIn,
      retry: false,
      staleTime: 60_000,
    },
  });
  return {
    isSignedIn: !!isSignedIn,
    isLoaded,
    user: query.data ?? null,
    role: query.data?.role ?? null,
    isLoading: (isSignedIn && query.isLoading) || !isLoaded,
  };
}
