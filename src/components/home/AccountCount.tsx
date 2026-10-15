import { getGT, getLocale } from "gt-next/server";
import { getSerikaAccountCount } from "@/lib/services/accountsStats";
import { formatCompactCount } from "@/lib/utils/formatCompactCount";

/**
 * "{count} people have a Serika account": the live total of Serika accounts
 * (one account works across every Serika app), not SerikaCord activity.
 * Streams in after the hero (Suspense) and renders nothing when the number is
 * unavailable, so it never shows 0 or a made-up figure.
 */
export async function AccountCount() {
  const users = await getSerikaAccountCount();
  if (!users) return null;
  const [gt, locale] = await Promise.all([getGT(), getLocale()]);
  const count = formatCompactCount(users, locale);

  return (
    <p className="text-center text-sm">
      <span className="font-semibold text-[var(--hm-ink)]">{gt("{count} people have a Serika account", { count })}</span>
      <span className="hidden text-[var(--hm-faint)] sm:inline"> · {gt("one account for every Serika app")}</span>
    </p>
  );
}
