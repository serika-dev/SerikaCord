"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronLeft, ChevronRight, LogOut, Pencil, Search, X } from "lucide-react";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cdnImage, cn } from "@/lib/utils";

export interface MobileSettingsItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface MobileSettingsSection<Id extends string = string> {
  title: string;
  items: MobileSettingsItem<Id>[];
}

/**
 * Discord-mobile style "You → Settings" root: a full-screen list of grouped,
 * rounded rows (icon, label, chevron) that push a sub-page. Phone-only; the
 * caller hides it at md+ where the desktop sidebar takes over.
 */
export function MobileSettingsHome<Id extends string>({
  user,
  sections,
  searchQuery,
  onSearchChange,
  onSelect,
  onEditProfile,
  onLogout,
  onClose,
  footer,
}: {
  user: { avatar?: string | null; displayName?: string | null; username?: string | null } | null | undefined;
  sections: MobileSettingsSection<Id>[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: Id) => void;
  onEditProfile: () => void;
  onLogout: () => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const gt = useGT();
  const name = user?.displayName || user?.username || "";

  return (
    <div className="md:hidden flex flex-col h-full min-h-0 bg-[var(--bg-app)] animate-in fade-in-0 duration-150">
      <MobileSettingsHeader title={gt("Settings")} onClose={onClose} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+var(--safe-area-bottom))]">
        {/* Account card */}
        <div className="mt-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex items-center gap-3">
          <Avatar className="w-14 h-14 shrink-0">
            <AvatarImage src={cdnImage(user?.avatar || undefined)} />
            <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-lg">
              {name.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base text-[var(--text-primary)] truncate">{name}</p>
            {user?.username && (
              <p className="text-sm text-[var(--text-secondary)] truncate">@{user.username}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onEditProfile}
            className="shrink-0 min-h-11 px-3 rounded-full bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)] text-sm font-medium flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Pencil className="w-4 h-4" />
            {gt("Edit Profile")}
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={gt("Search settings")}
            aria-label={gt("Search settings")}
            className="w-full h-11 rounded-xl pl-10 pr-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]"
          />
        </div>

        {sections.length === 0 && (
          <p className="mt-8 text-center text-sm text-[var(--text-muted)]">{gt("No settings match your search.")}</p>
        )}

        {sections.map((section) => (
          <section key={section.title} className="mt-6">
            <h3 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {section.title}
            </h3>
            <div className="rounded-2xl overflow-hidden bg-[var(--bg-card)] border border-[var(--border-subtle)]">
              {section.items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "w-full min-h-[52px] flex items-center gap-3 px-4 text-left text-[15px] text-[var(--text-primary)] active:bg-[var(--bg-active)] transition-colors",
                    i > 0 && "border-t border-[var(--border-subtle)]",
                  )}
                >
                  <item.icon className="w-5 h-5 shrink-0 text-[var(--text-secondary)]" />
                  <span className="flex-1 min-w-0 truncate">{item.label}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                </button>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-6 rounded-2xl overflow-hidden bg-[var(--bg-card)] border border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[52px] flex items-center gap-3 px-4 text-left text-[15px] font-medium text-red-500 active:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {gt("Log Out")}
          </button>
        </div>

        {footer && <div className="mt-6 px-1">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Sticky top bar for a phone settings screen: a back chevron (pushed page) or
 * a close button (root), with the title centred like Discord's mobile app.
 */
export function MobileSettingsHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const gt = useGT();
  return (
    <div className="md:hidden shrink-0 pt-[var(--safe-area-top)] bg-[var(--bg-app)] border-b border-[var(--border-subtle)]">
      <div className="relative h-12 flex items-center justify-center px-14">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={gt("Back")}
            className="absolute left-1 top-1/2 -translate-y-1/2 size-11 flex items-center justify-center rounded-full text-[var(--text-primary)] active:bg-[var(--bg-active)]"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">{title}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={gt("Close")}
            className="absolute right-1 top-1/2 -translate-y-1/2 size-11 flex items-center justify-center rounded-full text-[var(--text-secondary)] active:bg-[var(--bg-active)]"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
