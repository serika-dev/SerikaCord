"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    X,
    User,
    Settings,
    Bell,
    Palette,
    Shield,
    HelpCircle,
    LogOut,
    ChevronRight,
    Sparkles,
    Users,
    Plus,
    MessageSquare,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";

interface DrawerItem {
    icon: React.ElementType;
    label: string;
    href?: string;
    onClick?: () => void;
    badge?: string;
    danger?: boolean;
}

interface DrawerSection {
    title?: string;
    items: DrawerItem[];
}

interface MobileDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateServer?: () => void;
    onAddFriend?: () => void;
}

export function MobileDrawer({
    isOpen,
    onClose,
    onCreateServer,
    onAddFriend,
}: MobileDrawerProps) {
    const router = useRouter();
    const { user, logout } = useAuth();
    const gt = useGT();

    // Prevent body scroll when drawer is open
    useEffect(() => {
        if (isOpen) {
            document.body.classList.add("drawer-open");
        } else {
            document.body.classList.remove("drawer-open");
        }
        return () => {
            document.body.classList.remove("drawer-open");
        };
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, onClose]);

    const handleLogout = useCallback(async () => {
        await logout();
        router.push("/login");
        onClose();
    }, [logout, router, onClose]);

    const handleNavigation = useCallback((href: string) => {
        router.push(href);
        onClose();
    }, [router, onClose]);

    const quickActions: DrawerItem[] = [
        {
            icon: Plus,
            label: gt("Create Server"),
            onClick: () => {
                onCreateServer?.();
                onClose();
            }
        },
        {
            icon: Users,
            label: gt("Add Friend"),
            onClick: () => {
                onAddFriend?.();
                onClose();
            }
        },
    ];

    const settingsSections: DrawerSection[] = [
        {
            title: gt("Account"),
            items: [
                { icon: User, label: gt("My Account"), href: "/channels/settings/account" },
                { icon: Bell, label: gt("Notifications"), href: "/channels/settings/notifications" },
                { icon: Shield, label: gt("Privacy & Safety"), href: "/channels/settings/privacy" },
            ],
        },
        {
            title: gt("App Settings"),
            items: [
                { icon: Palette, label: gt("Appearance"), href: "/channels/settings/appearance" },
                {
                    icon: Sparkles,
                    label: gt("SerikaCord Premium"),
                    href: "/channels/settings/premium",
                    badge: user?.isPremium ? gt("Active") : undefined,
                },
            ],
        },
        {
            title: gt("Support"),
            items: [
                { icon: HelpCircle, label: gt("Help & Support"), href: "/channels/settings/help" },
            ],
        },
    ];

    const statusColors: Record<string, string> = {
        online: "#23A559",
        idle: "#F0B232",
        dnd: "#EF4444",
        offline: "#80848e",
    };

    return (
        <>
            {/* Overlay */}
            <div
                className={cn("mobile-drawer-overlay", isOpen && "open")}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Drawer Panel */}
            <aside
                className={cn("mobile-drawer", isOpen && "open")}
                role="dialog"
                aria-modal="true"
                aria-label={gt("Navigation menu")}
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors z-10"
                    aria-label={gt("Close menu")}
                >
                    <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>

                <ScrollArea className="h-full">
                    <div className="px-4 py-6 space-y-6">
                        {/* User Profile Section */}
                        <div className="flex items-center gap-4 p-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)]">
                            <div className="relative">
                                <Avatar className="w-14 h-14">
                                    <AvatarImage src={cdnImage(user?.avatar)} />
                                    <AvatarFallback className="bg-[var(--app-accent)] text-white text-xl font-bold">
                                        {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div
                                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-[var(--bg-card)]"
                                    style={{ backgroundColor: statusColors[user?.status || "online"] }}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-[var(--text-primary)] truncate">
                                    {user?.displayName || user?.username}
                                </p>
                                <p className="text-sm text-[var(--text-muted)] truncate">@{user?.username}</p>
                            </div>
                            <button
                                onClick={() => handleNavigation("/channels/profile")}
                                className="p-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />
                            </button>
                        </div>

                        {/* Quick Actions */}
                        <div className="grid grid-cols-2 gap-2">
                            {quickActions.map((action) => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.label}
                                        onClick={action.onClick}
                                        className="flex items-center gap-3 p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] active:scale-[0.98] transition-all"
                                    >
                                        <Icon className="w-5 h-5 text-[var(--app-accent)]" />
                                        <span className="text-sm font-medium text-[var(--text-primary)]">{action.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Settings Sections */}
                        {settingsSections.map((section, sectionIndex) => (
                            <div key={sectionIndex}>
                                {section.title && (
                                    <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] mb-2 px-1 tracking-wider">
                                        {section.title}
                                    </h3>
                                )}
                                <div className="space-y-1">
                                    {section.items.map((item) => {
                                        const Icon = item.icon;
                                        return (
                                            <button
                                                key={item.label}
                                                onClick={() => item.onClick?.() || (item.href && handleNavigation(item.href))}
                                                className={cn(
                                                    "w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]",
                                                    item.danger
                                                        ? "hover:bg-red-500/10 text-red-400"
                                                        : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                                                )}
                                            >
                                                <Icon className={cn("w-5 h-5", item.danger ? "text-red-400" : "text-[var(--text-muted)]")} />
                                                <span className="flex-1 text-left font-medium">{item.label}</span>
                                                {item.badge && (
                                                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-[var(--app-accent)]/20 text-[var(--app-accent)]">
                                                        {item.badge}
                                                    </span>
                                                )}
                                                <ChevronRight className={cn("w-4 h-4", item.danger ? "text-red-400/50" : "text-[var(--text-muted)]")} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {/* Logout */}
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-500/10 transition-all active:scale-[0.98] text-red-400"
                        >
                            <LogOut className="w-5 h-5" />
                            <span className="flex-1 text-left font-medium">{gt("Log Out")}</span>
                            <ChevronRight className="w-4 h-4 text-red-400/50" />
                        </button>

                        {/* App Version */}
                        <div className="text-center pt-4">
                            <p className="text-xs text-[var(--text-muted)]">SerikaCord v1.1.2</p>
                        </div>
                    </div>
                </ScrollArea>
            </aside>
        </>
    );
}
