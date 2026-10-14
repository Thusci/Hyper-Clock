import { AccountSecurity } from "@/components/account-security";
import { accountStatus } from "@/server/auth";
import { requirePageUser } from "@/server/page-auth";

export default async function Page() {
  const user = await requirePageUser();
  return <AccountSecurity username={user.username} {...await accountStatus(user.username)} />;
}
