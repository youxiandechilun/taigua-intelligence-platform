/*
 * 中文导读：共享基础能力：server-session.ts。相关类型、配置或辅助实现集中在本文件。
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { apiPath } from "@/src/lib/links";

export interface ConsoleSession {
  userId: string;
  userRole: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
  activeOrganizationId: string;
}

interface RawSessionResponse {
  user?: {
    id: string;
    name: string;
    email: string;
    role?: string | null;
    image?: string | null;
  };
  session?: {
    activeOrganizationId?: string | null;
  };
}

function sessionUrl() {
  return apiPath("/auth/get-session");
}

// Fetches the Better Auth session over HTTP, forwarding the browser cookies.
// Importing the server's `auth` directly doesn't work here — the server uses
// Node ESM `.js` import extensions that Next's webpack cannot resolve.
async function fetchSession(): Promise<RawSessionResponse | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const forwarded = await headers();
  const ua = forwarded.get("user-agent") ?? "";

  try {
    const res = await fetch(sessionUrl(), {
      headers: {
        cookie: cookieHeader,
        "user-agent": ua,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as RawSessionResponse | null;
    if (!body || !body.user) return null;
    return body;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<ConsoleSession> {
  const sess = await fetchSession();
  if (!sess?.user) {
    redirect("/login");
  }
  const activeOrganizationId = sess.session?.activeOrganizationId ?? null;
  if (!activeOrganizationId) {
    redirect("/login");
  }
  return {
    userId: sess.user.id,
    userRole: sess.user.role ?? "user",
    userName: sess.user.name,
    userEmail: sess.user.email,
    userImage: sess.user.image ?? null,
    activeOrganizationId,
  };
}

export async function getSession() {
  return fetchSession();
}

export async function requireCompanyAccess(){
 const cookieStore=await cookies();const res=await fetch(apiPath('/company/context'),{headers:{cookie:cookieStore.getAll().map(c=>`${c.name}=${c.value}`).join('; ')},cache:'no-store'});
 if(!res.ok)redirect('/login');
 const body=await res.json() as {data:import("./api/resources/company").CompanyContext};return body.data;
}
