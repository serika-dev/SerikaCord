"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X, Plus, Check, ChevronLeft, LogOut } from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import {
  type SavedAccountToken,
  parseSavedAccountsCookie,
  removeSavedAccountToken,
} from "@/lib/services/savedAccountsCookie";
import { clearMessageCache } from "@/hooks/useChatSession";

export function SwitchAccountsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, login, logout } = useAuth();
  const gt = useGT();
  const [accounts, setAccounts] = useState<SavedAccountToken[]>([]);
  const [mode, setMode] = useState<"list" | "login">("list");
  const [selectedAccount, setSelectedAccount] = useState<SavedAccountToken | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      // Only show accounts that have a saved token (switchable) and dedupe by username
      const seen = new Set<string>();
      setAccounts(
        parseSavedAccountsCookie()
          .filter((a) => a.token)
          .filter((a) => {
            const key = a.username.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
      );
      setMode("list");
      setSelectedAccount(null);
      setError("");
      setPassword("");
    }
  }, [open]);

  const handleSelectAccount = async (account: SavedAccountToken) => {
    setIsLoading(true);
    setError("");
    try {
      // Server handles saving current account before switching

      // Use server endpoint to switch accounts
      if (account.token) {
        const response = await fetch("/api/auth/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: account.email }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || gt("Failed to switch account"));
        }

        onOpenChange(false);
        // Clear cached messages from the previous account before reloading
        // to prevent cross-account message leakage via localStorage SWR cache.
        clearMessageCache();
        // Full reload to refresh all context (servers, DMs, etc.)
        window.location.reload();
      } else {
        // Fallback to password login if no token
        setSelectedAccount(account);
        setEmail(account.email);
        setPassword("");
        setError("");
        setMode("login");
      }
    } catch (err: any) {
      setError(err.message || gt("Failed to switch account"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError(gt("Please enter your password"));
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Server handles saving current account before login
      await login(email.trim(), password.trim());

      onOpenChange(false);
      // Clear cached messages from the previous account before reloading.
      clearMessageCache();
      // Full reload to refresh all context (servers, DMs, etc.)
      window.location.reload();
    } catch (err: any) {
      setError(err.message || gt("Failed to login"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAccount = (accountEmail: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeSavedAccountToken(accountEmail);
    setAccounts(parseSavedAccountsCookie().filter((a) => a.token));
  };

  const handleLogoutAndSwitch = async () => {
    setIsLoading(true);
    try {
      await logout();
      clearMessageCache();
      onOpenChange(false);
      window.location.href = "/login";
    } catch {
      setIsLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={gt("Switch accounts")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[400px] max-w-[95vw] bg-[#111214] rounded-xl shadow-2xl border border-[#1e1f22] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1f22]">
          <div className="flex items-center gap-2">
            {mode === "login" && (
              <button
                onClick={() => {
                  setMode("list");
                  setSelectedAccount(null);
                  setError("");
                }}
                className="p-1 rounded hover:bg-[#1a1a1a] transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-[#b5bac1]" />
              </button>
            )}
            <h2 className="text-lg font-bold text-white">
              {mode === "list" ? gt("Switch Accounts") : gt("Login to {name}", { name: selectedAccount?.displayName || selectedAccount?.username || email })}
            </h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-[#1a1a1a] transition-colors"
          >
            <X className="w-5 h-5 text-[#b5bac1]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {mode === "list" ? (
            <div className="space-y-2">
              {/* Current account */}
              {user && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1e1f22] border border-[#5865F2]/30">
                  <div className="relative">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={user.avatar} />
                      <AvatarFallback className="bg-[#5865F2] text-white text-sm">
                        {user.displayName?.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#57F287] border-2 border-[#1e1f22]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{user.displayName}</div>
                    <div className="text-xs text-[#888] truncate">@{user.username}</div>
                  </div>
                  <Check className="w-5 h-5 text-[#57F287] flex-shrink-0" />
                </div>
              )}

              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 rounded p-2">{error}</div>
              )}

              {/* Saved accounts */}
              {accounts
                .filter((a) => {
                  const currentEmail = user?.email || `${user?.username}@serika.dev`;
                  return a.email.toLowerCase() !== currentEmail.toLowerCase() && a.username.toLowerCase() !== user?.username?.toLowerCase();
                })
                .map((account) => (
                  <div
                    key={account.email}
                    className="group relative"
                  >
                    <button
                      onClick={() => void handleSelectAccount(account)}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#1a1a1a] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={account.avatar} />
                        <AvatarFallback className="bg-[#5865F2] text-white text-sm">
                          {account.displayName?.charAt(0).toUpperCase() || account.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{account.displayName || account.username}</div>
                        <div className="text-xs text-[#888] truncate">@{account.username}</div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleRemoveAccount(account.email, e)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#2a2a2a] transition-all"
                      title={gt("Remove account")}
                    >
                      <X className="w-4 h-4 text-[#888] hover:text-red-400" />
                    </button>
                  </div>
                ))}

              {/* Add new account */}
              <button
                onClick={() => {
                  setMode("login");
                  setSelectedAccount(null);
                  setEmail("");
                  setPassword("");
                  setError("");
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#1a1a1a] transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-[#1e1f22] flex items-center justify-center">
                  <Plus className="w-5 h-5 text-[#b5bac1]" />
                </div>
                <span className="text-sm font-medium text-[#b5bac1]">{gt("Add an account")}</span>
              </button>

              {/* Divider */}
              <div className="h-px bg-[#1e1f22] my-3" />

              {/* Log out */}
              <button
                onClick={handleLogoutAndSwitch}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-red-500/10 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-[#1e1f22] flex items-center justify-center">
                  <LogOut className="w-5 h-5 text-red-400" />
                </div>
                <span className="text-sm font-medium text-red-400">{gt("Log out of {name}", { name: user?.displayName || gt("current account") })}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedAccount && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1e1f22]">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={selectedAccount.avatar} />
                    <AvatarFallback className="bg-[#5865F2] text-white">
                      {selectedAccount.displayName?.charAt(0).toUpperCase() || selectedAccount.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{selectedAccount.displayName || selectedAccount.username}</div>
                    <div className="text-xs text-[#888] truncate">{selectedAccount.email}</div>
                  </div>
                </div>
              )}

              {!selectedAccount && (
                <div>
                  <label className="block text-xs font-bold uppercase text-[#b5bac1] mb-1.5">{gt("Email")}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#1a1a1a] text-sm text-white placeholder:text-[#666] border border-[#333] focus:outline-none focus:border-[#5865F2] transition-colors"
                    placeholder={gt("email@example.com")}
                    autoFocus
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase text-[#b5bac1] mb-1.5">{gt("Password")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLogin();
                  }}
                  className="w-full px-3 py-2 rounded bg-[#1a1a1a] text-sm text-white placeholder:text-[#666] border border-[#333] focus:outline-none focus:border-[#5865F2] transition-colors"
                  placeholder={gt("Password")}
                  autoFocus={!!selectedAccount}
                />
              </div>

              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 rounded p-2">{error}</div>
              )}

              <button
                onClick={() => void handleLogin()}
                disabled={isLoading || !password.trim()}
                className={cn(
                  "w-full py-2.5 rounded-lg font-medium text-sm transition-all",
                  isLoading || !password.trim()
                    ? "bg-[#1e1f22] text-[#666] cursor-not-allowed"
                    : "bg-[#5865F2] hover:bg-[#4752c4] text-white"
                )}
              >
                {isLoading ? gt("Logging in...") : gt("Login")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
