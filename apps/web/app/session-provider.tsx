"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type SessionConfig = {
  apiBase: string;
  token: string;
  setApiBase: (apiBase: string) => void;
  setToken: (token: string) => void;
};

const SessionContext = createContext<SessionConfig | null>(null);

export function SessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [apiBase, setApiBaseState] = useState("http://localhost:8000");
  const [token, setTokenState] = useState("");

  useEffect(() => {
    const storedApi = window.localStorage.getItem("starlog-api-base");
    const storedToken = window.localStorage.getItem("starlog-token");
    if (storedApi) {
      setApiBaseState(storedApi);
    }
    if (storedToken) {
      setTokenState(storedToken);
    }
  }, []);

  const setApiBase = (next: string) => {
    setApiBaseState(next);
    window.localStorage.setItem("starlog-api-base", next);
  };

  const setToken = (next: string) => {
    setTokenState(next);
    window.localStorage.setItem("starlog-token", next);
  };

  const value = useMemo(
    () => ({ apiBase, token, setApiBase, setToken }),
    [apiBase, token],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionConfig(): SessionConfig {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionConfig must be used within SessionProvider");
  }
  return context;
}
