import { LoginForm } from "@/components/login-form";
import { authMethod } from "@/server/auth";

// AUTH_METHOD is read at request time, so switching it in the env file needs a restart, not a rebuild.
export const dynamic = "force-dynamic";

export default function Login() {
  return <main className="admin-bg grid min-h-dvh place-items-center p-5"><LoginForm method={authMethod()} /></main>;
}
