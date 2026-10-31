import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  onSessionEnded,
  refreshSession,
  setAccessToken,
  type SessionBody,
  type User,
} from "../api/client";

type AuthState =
  { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; user: User };

// Signing in either finishes, or stops halfway to ask for a two-factor code.
export type SignInResult = { done: true } | { done: false; challengeToken: string };

export type SecondFactor = { code: string } | { backupCode: string };

interface AuthContextValue {
  state: AuthState;
  signIn(email: string, password: string): Promise<SignInResult>;
  completeSignIn(challengeToken: string, factor: SecondFactor): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  signOutEverywhere(): Promise<void>;
  // Applies a new session after something changed it, such as turning on two-factor.
  updateSession(body: SessionBody): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const queryClient = useQueryClient();

  const begin = useCallback((body: SessionBody) => {
    setAccessToken(body.accessToken);
    setState({ status: "signedIn", user: body.user });
  }, []);

  const end = useCallback(() => {
    setAccessToken(null);
    // Nothing from the previous account may linger in the cache for the next one.
    queryClient.clear();
    setState({ status: "signedOut" });
  }, [queryClient]);

  // On load, the refresh cookie (if any) restores the session without a password.
  // Without one there was no account, so the cache holds nothing to clear, only
  // what a public page (an acknowledge link) is fetching right now.
  useEffect(() => {
    onSessionEnded(end);
    void refreshSession().then((body) => (body ? begin(body) : setState({ status: "signedOut" })));
  }, [begin, end]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async signIn(email, password) {
        const res = await api<SessionBody | { twoFactorRequired: true; challengeToken: string }>(
          "/auth/login",
          { method: "POST", body: { email, password }, auth: false },
        );
        if ("challengeToken" in res) return { done: false, challengeToken: res.challengeToken };
        begin(res);
        return { done: true };
      },
      async completeSignIn(challengeToken, factor) {
        begin(
          await api<SessionBody>("/auth/2fa/challenge", {
            method: "POST",
            body: { challengeToken, ...factor },
            auth: false,
          }),
        );
      },
      async signUp(email, password) {
        begin(
          await api<SessionBody>("/auth/register", {
            method: "POST",
            body: { email, password },
            auth: false,
          }),
        );
      },
      async signOut() {
        await api("/auth/logout", { method: "POST", auth: false }).catch(() => {});
        end();
      },
      async signOutEverywhere() {
        await api("/auth/logout-all", { method: "POST" });
        end();
      },
      updateSession: begin,
    }),
    [state, begin, end],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

// For screens that only render behind <RequireAuth>.
export function useUser(): User {
  const { state } = useAuth();
  if (state.status !== "signedIn") throw new Error("useUser needs a signed-in user");
  return state.user;
}
