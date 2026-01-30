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
import { cn } from "@/lib/utils";

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
            label: "Create Server",
            onClick: () => {
                onCreateServer?.();
                onClose();
            }
        },
        {
            icon: Users,
            label: "Add Friend",
            onClick: () => {
                onAddFriend?.();
                onClose();
            }
        },
    ];

    const settingsSections: DrawerSection[] = [
        {
            title: "Account",
            items: [
                { icon: User, label: "My Account", href: "/channels/settings/account" },
                { icon: Bell, label: "Notifications", href: "/channels/settings/notifications" },
                { icon: Shield, label: "Privacy & Safety", href: "/channels/settings/privacy" },
            ],
        },
        {
            title: "App Settings",
            items: [
                { icon: Palette, label: "Appearance", href: "/channels/settings/appearance" },
                {
                    icon: Sparkles,
                    label: "SerikaCord Premium",
                    href: "/channels/settings/premium",
                    badge: user?.isPremium ? "Active" : undefined,
                },
            ],
        },
        {
            title: "Support",
            items: [
                { icon: HelpCircle, label: "Help & Support", href: "/channels/settings/help" },
            ],
        },
    ];

    const statusColors: Record<string, string> = {
        online: "#8B5CF6",
        idle: "#A78BFA",
        dnd: "#EF4444",
        offline: "#555555",
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
                aria-label="Navigation menu"
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl hover:bg-white/5 transition-colors z-10"
                    aria-label="Close menu"
                >
                    <X className="w-5 h-5 text-neutral-400" />
                </button>

                <ScrollArea className="h-full">
                    <div className="px-4 py-6 space-y-6">
                        {/* User Profile Section */}
                        <div className="flex items-center gap-4 p-4 bg-[#111111] rounded-2xl border border-white/5">
                            <div className="relative">
                                <Avatar className="w-14 h-14">
                                    <AvatarImage src={user?.avatar} />
                                    <AvatarFallback className="bg-[#8B5CF6] text-white text-xl font-bold">
                                        {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div
                                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-[#111111]"
                                    style={{ backgroundColor: statusColors[user?.status || "online"] }}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-white truncate">
                                    {user?.displayName || user?.username}
                                </p>
                                <p className="text-sm text-neutral-400 truncate">@{user?.username}</p>
                            </div>
                            <button
                                onClick={() => handleNavigation("/channels/profile")}
                                className="p-2 rounded-xl hover:bg-white/5 transition-colors"
                            >
                                <ChevronRight className="w-5 h-5 text-neutral-500" />
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
                                        className="flex items-center gap-3 p-3 bg-[#111111] rounded-xl border border-white/5 hover:bg-[#1a1a1a] active:scale-[0.98] transition-all"
                                    >
                                        <Icon className="w-5 h-5 text-[#8B5CF6]" />
                                        <span className="text-sm font-medium text-white">{action.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Settings Sections */}
                        {settingsSections.map((section, sectionIndex) => (
                            <div key={sectionIndex}>
                                {section.title && (
                                    <h3 className="text-xs font-bold uppercase text-neutral-500 mb-2 px-1 tracking-wider">
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
                                                        : "hover:bg-white/5 text-neutral-300"
                                                )}
                                            >
                                                <Icon className={cn("w-5 h-5", item.danger ? "text-red-400" : "text-neutral-400")} />
                                                <span className="flex-1 text-left font-medium">{item.label}</span>
                                                {item.badge && (
                                                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6]">
                                                        {item.badge}
                                                    </span>
                                                )}
                                                <ChevronRight className={cn("w-4 h-4", item.danger ? "text-red-400/50" : "text-neutral-600")} />
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
                            <span className="flex-1 text-left font-medium">Log Out</span>
                            <ChevronRight className="w-4 h-4 text-red-400/50" />
                        </button>

                        {/* App Version */}
                        <div className="text-center pt-4">
                            <p className="text-xs text-neutral-600">SerikaCord v1.0.0</p>
                        </div>
                    </div>
                </ScrollArea>
            </aside>
        </>
    );
}
