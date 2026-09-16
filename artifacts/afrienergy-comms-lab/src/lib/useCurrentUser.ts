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
      // Two retries, because one dropped packet used to cost a facilitator
      // their console: with no role the app concluded they had never been given
      // access and told them so, minutes before a class.
      retry: 2,
      staleTime: 60_000,
    },
  });
  return {
    isSignedIn: !!isSignedIn,
    isLoaded,
    user: query.data ?? null,
    role: query.data?.role ?? null,
    isLoading: (isSignedIn && query.isLoading) || !isLoaded,
    /**
     * We asked and could not get an answer — which is a different thing from
     * being told no, and must not be shown as "you do not have access".
     */
    unreachable: !!query.isError,
    retry: () => { void query.refetch(); },
  };
}
