"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, User, Mail, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGT } from "gt-next";

export default function AccountSettingsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const gt = useGT();

    return (
        <div className="flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)]">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-4 bg-[var(--bg-sidebar)] border-b border-[var(--border-subtle)] safe-area-top">
                <button
                    onClick={() => router.back()}
                    className="p-2 -ml-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
                >
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-xl font-bold text-[var(--text-primary)]">{gt("My Account")}</h1>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Profile Banner Card */}
                    <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden border border-[var(--border-subtle)]">
                        <div className={`h-24 ${user?.banner ? 'bg-cover bg-center' : 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]'}`}
                            style={user?.banner ? { backgroundImage: `url(${user.banner})` } : undefined}
                        />
                        <div className="px-5 pb-5 relative">
                            <div className="absolute -top-10 left-5">
                                <Avatar className="w-20 h-20 border-[6px] border-[var(--bg-card)]">
                                    <AvatarImage src={user?.avatar} />
                                    <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)] text-2xl font-bold">
                                        {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                            </div>
                            <div className="mt-12">
                                <h2 className="text-xl font-bold text-[var(--text-primary)]">{user?.displayName || user?.username}</h2>
                                <p className="text-[var(--text-secondary)]">@{user?.username}</p>
                            </div>
                        </div>
                    </div>

                    {/* Info Fields */}
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">{gt("Display Name")}</label>
                            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-between">
                                <span>{user?.displayName || user?.username}</span>
                                <button onClick={() => router.push("/channels/settings/profiles")} className="text-sm font-medium text-[#8B5CF6]">{gt("Edit")}</button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">{gt("Username")}</label>
                            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                                <span>{user?.username}</span>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">{gt("Email")}</label>
                            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                                <span>{user?.email || gt("No email linked")}</span>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">{gt("About Me")}</label>
                            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] min-h-[100px] flex items-start justify-between gap-3">
                                <span className="flex-1">{user?.bio || gt("No bio set.")}</span>
                                <button onClick={() => router.push("/channels/settings/profiles")} className="text-sm font-medium text-[#8B5CF6] shrink-0">{gt("Edit")}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
