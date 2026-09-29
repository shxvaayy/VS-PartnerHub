import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrf } from "./api";
import type { SessionUser } from "../../shared/domain";
type Session = { user: SessionUser | null; csrfToken: string; demo: boolean };
type Context = {
  user: SessionUser | null;
  loading: boolean;
  error: Error | null;
  demo: boolean;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{
    user?: SessionUser;
    requiresOtp?: boolean;
    challengeId?: string;
    verificationCode?: string;
  }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  accept: (result: any) => void;
};
const AuthContext = createContext<Context>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const session = useQuery<Session>({
    queryKey: ["session"],
    queryFn: async () => {
      const data = await api<Session>("/auth/session");
      setCsrf(data.csrfToken || "");
      return data;
    },
    staleTime: 60000,
    retry: 1,
  });
  const accept = (data: any) => {
    if (data.csrfToken) setCsrf(data.csrfToken);
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    client.setQueryData(["session"], { ...session.data, ...data });
  };
  const signIn = async (email: string, password: string) => {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (data.user) accept(data);
    return data;
  };
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" });
    setCsrf("");
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    client.setQueryData(["session"], {
      user: null,
      demo: session.data?.demo,
      csrfToken: "",
    });
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["session"] });
  };
  return (
    <AuthContext.Provider
      value={{
        user: session.data?.user || null,
        loading: session.isPending,
        error: session.error,
        demo: session.data?.demo || false,
        signIn,
        signOut,
        refresh,
        accept,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
