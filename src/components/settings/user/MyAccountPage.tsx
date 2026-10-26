"use client";

import { memo, useState } from "react";
import { useGT } from "gt-next";
import { ExternalLink, KeyRound, MonitorSmartphone } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SettingsCard, SettingsPageHeader, SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsButton, settingsButtonClass } from "@/components/settings/blocks/SettingsButton";
import { SettingsDangerZone } from "@/components/settings/blocks/SettingsDangerZone";
import { PasskeysSettingsRow } from "@/components/settings/PasskeysSettingsRow";
import { ACCOUNTS_SECURITY_URL } from "@/lib/accountsHandoff";
import { useStreamerHides } from "@/hooks/useStreamerMode";
import { cdnImage, cn } from "@/lib/utils";

/** Serika Accounts owns the username, email, password and account deletion. */
const ACCOUNTS_SETTINGS_URL = "https://accounts.serika.dev/settings";

/** "alex.smith@gmail.com" → "••••••••••@gmail.com" (Discord's hidden email). */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•".repeat(Math.max(8, email.length));
  return `${"•".repeat(Math.max(6, at))}${email.slice(at)}`;
}

export interface MyAccountUser {
  username: string;
  displayName?: string;
  email?: string;
  avatar?: string;
  banner?: string;
  customization?: { profileColor?: string; [key: string]: unknown };
}

/**
 * Discord's "My Account": a profile summary card (banner, avatar, name,
 * "Edit User Profile") with the account fields under it, then Password and
 * Authentication and an Account Removal danger zone. Account credentials live
 * on Serika Accounts, so those actions link there.
 */
export const MyAccountPage = memo(function MyAccountPage({
  user,
  onEditProfile,
  onOpenDevices,
}: {
  user: MyAccountUser | null;
  onEditProfile: () => void;
  onOpenDevices: () => void;
}) {
  const gt = useGT();
  const hidePersonal = useStreamerHides("personal");
  const [revealEmail, setRevealEmail] = useState(false);
  const email = user?.email || "";
  const showEmail = revealEmail && !hidePersonal;
  const name = user?.displayName || user?.username || "";
  const bannerColor = user?.customization?.profileColor || "var(--app-accent)";

  const accountsLink = (label: string) => (
    <a
      href={ACCOUNTS_SETTINGS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={settingsButtonClass("secondary", "sm")}
    >
      {label}
      <ExternalLink aria-hidden />
    </a>
  );

  return (
    <div className="space-y-10">
      <SettingsPageHeader title={gt("My Account")} description={gt("Your sign-in details and account security.")} />

      {/* Profile summary card */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
        <div
          className="h-[100px] bg-cover bg-center"
          style={user?.banner ? { backgroundImage: `url(${cdnImage(user.banner)})` } : { background: bannerColor }}
        />
        <div className="relative flex flex-wrap items-end gap-4 px-4 pb-4">
          <Avatar className="-mt-10 h-[84px] w-[84px] shrink-0 ring-[6px] ring-[var(--bg-app)]">
            <AvatarImage src={cdnImage(user?.avatar)} alt="" />
            <AvatarFallback className="bg-[var(--app-accent)] text-2xl text-[var(--text-on-accent)]">
              {name.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 pb-1">
            <p className="truncate text-xl font-bold leading-tight text-[var(--text-primary)]">{name}</p>
            {user?.username && <p className="truncate text-sm text-[var(--text-secondary)]">@{user.username}</p>}
          </div>
          <SettingsButton onClick={onEditProfile} className="mb-1 max-sm:w-full">
            {gt("Edit User Profile")}
          </SettingsButton>
        </div>

        <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
          <SettingsRow
            label={gt("Display Name")}
            description={user?.displayName || gt("You haven't set a display name yet.")}
            control={<SettingsButton variant="secondary" size="sm" onClick={onEditProfile}>{gt("Edit")}</SettingsButton>}
          />
          <SettingsRow
            label={gt("Username")}
            description={user?.username ? `@${user.username}` : undefined}
            control={accountsLink(gt("Edit"))}
          />
          <SettingsRow
            label={gt("Email")}
            description={
              email ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  <span className={cn(!showEmail && "tracking-wide")}>{showEmail ? email : maskEmail(email)}</span>
                  {!hidePersonal && (
                    <button
                      type="button"
                      onClick={() => setRevealEmail((v) => !v)}
                      className="font-medium text-[var(--app-accent)] hover:underline"
                    >
                      {showEmail ? gt("Hide") : gt("Reveal")}
                    </button>
                  )}
                </span>
              ) : (
                gt("No email on this account.")
              )
            }
            control={accountsLink(gt("Edit"))}
          />
        </div>
      </div>

      {/* Password and Authentication */}
      <SettingsSection
        title={gt("Password and Authentication")}
        description={gt("Your password and passkeys are managed in your Serika account.")}
      >
        <SettingsCard>
          <SettingsRow
            icon={KeyRound}
            label={gt("Password")}
            description={gt("Change the password you use to sign in.")}
            control={
              <a
                href={ACCOUNTS_SECURITY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={settingsButtonClass("primary", "sm")}
              >
                {gt("Change Password")}
                <ExternalLink aria-hidden />
              </a>
            }
          />
          <SettingsRow
            icon={MonitorSmartphone}
            label={gt("Devices")}
            description={gt("See where you're signed in and log out of other devices.")}
            control={<SettingsButton variant="secondary" size="sm" onClick={onOpenDevices}>{gt("View devices")}</SettingsButton>}
          />
        </SettingsCard>
        <PasskeysSettingsRow />
      </SettingsSection>

      {/* Account Removal */}
      <section className="space-y-3">
        <div className="px-0.5">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">{gt("Account Removal")}</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
            {gt("Deleting your account removes your profile and data for good. Servers you own pass to another member.")}
          </p>
        </div>
        <SettingsDangerZone>
          <SettingsRow
            label={gt("Delete Account")}
            description={gt("Done from your Serika account. This cannot be undone.")}
            danger
            stackOnMobile
            control={
              <a
                href={ACCOUNTS_SETTINGS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={settingsButtonClass("danger", "sm", "max-sm:w-full")}
              >
                {gt("Delete Account")}
                <ExternalLink aria-hidden />
              </a>
            }
          />
        </SettingsDangerZone>
      </section>
    </div>
  );
});
