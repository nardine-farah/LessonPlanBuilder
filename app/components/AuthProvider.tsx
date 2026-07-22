"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  authErrorMessage,
  signInWithGoogle,
  signOut,
  watchAuth,
  type User,
} from "@/lib/firebase";

interface AuthState {
  user: User | null;
  /** True until the first auth-state callback fires. */
  loading: boolean;
  error: string;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: "",
  signIn: async () => {},
  signOutUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return watchAuth((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    setError("");
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  const signOutUser = async () => {
    setError("");
    await signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
