"use client";

import { useRouter } from "next/navigation";
import { cdnImage } from "@/lib/utils";
import { ArrowLeft, Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGT } from "gt-next";
import { useStreamerHides } from "@/hooks/useStreamerMode";
import { maskEmail } from "@/lib/streamer/streamerMode";
import { getProfileBannerStyle } from "@/lib/userDisplayNameStyle";
import { PasskeysSettingsRow } from "@/components/settings/PasskeysSettingsRow";

export default function AccountSettingsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const gt = useGT();
    const hidePersonal = useStreamerHides("personal");
    const displayName = user?.displayName || user?.username || "";
    const editProfile = () => router.push("/channels/settings/profiles");
    const editClassName = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold text-[var(--app-accent)] transition-colors hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] touch-manipulation";

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
            {/* Header */}
            <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-app)] safe-area-top">
                <div className="mx-auto grid min-h-16 w-full max-w-2xl grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-3">
                    <button
                        type="button"
                        aria-label={gt("Back")}
                        onClick={() => router.back()}
                        className="flex size-11 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] touch-manipulation"
                    >
                        <ArrowLeft className="size-5" />
                    </button>
                    <h1 className="text-center text-lg font-semibold">{gt("My Account")}</h1>
                </div>
            </header>

            <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-5 sm:px-6" style={{ paddingBottom: "calc(var(--mobile-content-pb) + 1.5rem)" }}>
                    {/* Profile Banner Card */}
                    <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden border border-[var(--border-subtle)]">
                        <div className="h-28 bg-[var(--app-accent)] bg-cover bg-center sm:h-32"
                            style={user?.banner ? { backgroundImage: `url(${cdnImage(user.banner)})` } : getProfileBannerStyle(user?.customization)}
                        />
                        <div className="relative flow-root px-4 pb-5 sm:px-5">
                            {/* Keep the avatar in flow so names always start below it. */}
                            <div className="-mt-12 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                                <Avatar className="size-24 border-[6px] border-[var(--bg-card)] bg-[var(--bg-card)]">
                                    <AvatarImage src={cdnImage(user?.avatar)} alt="" />
                                    <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-3xl font-bold">
                                        {displayName.charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <button type="button" onClick={editProfile} className={`${editClassName} gap-2 border border-[var(--border-subtle)] bg-[var(--bg-card)]`}>
                                    <Pencil className="size-4 shrink-0" />
                                    {gt("Edit Profile")}
                                </button>
                            </div>
                            <div className="mt-3 min-w-0 space-y-1">
                                <h2 className="text-2xl font-bold leading-tight text-[var(--text-primary)] [overflow-wrap:anywhere]">{displayName}</h2>
                                <p className="text-sm text-[var(--text-secondary)] [overflow-wrap:anywhere]">@{user?.username}</p>
                            </div>
                        </div>
                    </div>

                    {/* Info Fields */}
                    <dl className="space-y-4">
                        <div className="space-y-1">
                            <dt className="px-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{gt("Display Name")}</dt>
                            <dd className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] py-2 pl-4 pr-2 text-[var(--text-primary)]">
                                <span className="min-w-0 [overflow-wrap:anywhere]">{displayName}</span>
                                <button type="button" onClick={editProfile} aria-label={gt("Edit Display Name")} className={editClassName}>{gt("Edit")}</button>
                            </dd>
                        </div>

                        <div className="space-y-1">
                            <dt className="px-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{gt("Username")}</dt>
                            <dd className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] [overflow-wrap:anywhere]">
                                {user?.username}
                            </dd>
                        </div>

                        <div className="space-y-1">
                            <dt className="px-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{gt("Email")}</dt>
                            <dd className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] [overflow-wrap:anywhere]">
                                {user?.email ? (hidePersonal ? maskEmail(user.email) : user.email) : gt("No email linked")}
                            </dd>
                        </div>

                        <div className="space-y-1">
                            <dt className="px-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{gt("About Me")}</dt>
                            <dd className="flex min-h-28 items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] py-2 pl-4 pr-2 text-[var(--text-primary)]">
                                <span className="min-w-0 flex-1 whitespace-pre-wrap py-2 leading-relaxed [overflow-wrap:anywhere]">{user?.bio || gt("No bio set.")}</span>
                                <button type="button" onClick={editProfile} aria-label={gt("Edit About Me")} className={editClassName}>{gt("Edit")}</button>
                            </dd>
                        </div>
                    </dl>

                    {/* Sign-in security: passkeys are managed on Serika Accounts */}
                    <section className="space-y-1">
                        <h3 className="px-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{gt("Sign-in & Security")}</h3>
                        <PasskeysSettingsRow className="rounded-xl" />
                    </section>
                </div>
            </ScrollArea>
        </div>
    );
}
