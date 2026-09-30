import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrf } from "./api";
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
    expiresAt?: string;
    resendAt?: string;
  }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  accept: (result: any) => void;
};
const AuthContext = createContext<Context>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const channel = useRef<BroadcastChannel | null>(null);
  const previousUser = useRef<string | null | undefined>(undefined);
  const clearPrivateData = () => {
    void client.cancelQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
  };
  const session = useQuery<Session>({
    queryKey: ["session"],
    queryFn: async ({ signal }) => {
      const data = await api<Session>("/auth/session", { signal });
      const id = data.user?.id || null;
      if (previousUser.current !== undefined && previousUser.current !== id)
        clearPrivateData();
      previousUser.current = id;
      setCsrf(data.csrfToken || "");
      return data;
    },
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
  useEffect(() => {
    const invalidate = () => {
      previousUser.current = null;
      setCsrf("");
      client.setQueryData<Session>(["session"], (previous) => ({
        user: null,
        demo: previous?.demo || false,
        csrfToken: "",
      }));
      clearPrivateData();
    };
    window.addEventListener("partnerhub:session-invalid", invalidate);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("vs-partnerhub-session");
      channel.current.onmessage = () => {
        clearPrivateData();
        void client.invalidateQueries({ queryKey: ["session"] });
      };
    }
    return () => {
      window.removeEventListener("partnerhub:session-invalid", invalidate);
      channel.current?.close();
      channel.current = null;
    };
  }, [client]);
  const accept = (data: any) => {
    void client.cancelQueries({ queryKey: ["session"] });
    previousUser.current = data.user?.id || null;
    if (data.csrfToken) setCsrf(data.csrfToken);
    clearPrivateData();
    client.setQueryData(["session"], { ...session.data, ...data });
    channel.current?.postMessage("changed");
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
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    previousUser.current = null;
    setCsrf("");
    clearPrivateData();
    client.setQueryData(["session"], {
      user: null,
      demo: session.data?.demo,
      csrfToken: "",
    });
    channel.current?.postMessage("changed");
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["session"] });
    channel.current?.postMessage("changed");
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
