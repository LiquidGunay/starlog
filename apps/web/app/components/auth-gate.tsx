"use client";

import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect } from "react";

import { AuthEntry } from "./auth-entry";
import { useSessionConfig } from "../session-provider";

const PUBLIC_ROUTES = ["/", "/login"];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) {
    return true;
  }

  return pathname.startsWith("/login/");
}
export function AuthGate({ children }: Readonly<PropsWithChildren>) {
  const pathname = usePathname() || "/";
  const { hydrated, token } = useSessionConfig();
  const router = useRouter();

  const hasSession = token.trim().length > 0;
  const publicRoute = isPublicRoute(pathname);

  useEffect(() => {
    if (hydrated && !hasSession && !publicRoute) {
      router.replace("/login");
    }
  }, [hydrated, hasSession, pathname, publicRoute, router]);

  if (!hydrated) {
    return <AuthEntry />;
  }

  if (hasSession || publicRoute) {
    return <>{children}</>;
  }

  return <AuthEntry />;
}
