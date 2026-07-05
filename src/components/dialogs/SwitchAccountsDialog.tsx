"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X, Plus, Check, ChevronLeft, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface SavedAccount {
  email: string;
  username: string;
  displayName?: string;
  avatar?: string;
  savedAt: number;
}

const STORAGE_KEY = "serika:savedAccounts";

function loadSavedAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: SavedAccount[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // ignore
  }
}

export function SwitchAccountsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, login, logout, refresh } = useAuth();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [mode, setMode] = useState<"list" | "login">("list");
  const [selectedAccount, setSelectedAccount] = useState<SavedAccount | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAccounts(loadSavedAccounts());
      setMode("list");
      setSelectedAccount(null);
      setError("");
      setPassword("");
    }
  }, [open]);

  const saveCurrentAccount = useCallback(() => {
    if (!user?.email) return;
    const accounts = loadSavedAccounts();
    const existing = accounts.find((a) => a.email === user.email);
    if (!existing) {
      const newAccount: SavedAccount = {
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        savedAt: Date.now(),
      };
      accounts.push(newAccount);
      saveAccounts(accounts);
      setAccounts(accounts);
    }
  }, [user]);

  const handleSelectAccount = (account: SavedAccount) => {
    setSelectedAccount(account);
    setEmail(account.email);
    setPassword("");
    setError("");
    setMode("login");
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your password");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Save current account before switching
      saveCurrentAccount();

      await login(email.trim(), password.trim());

      // Update saved account info after successful login
      await refresh();

      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || "Failed to login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAccount = (accountEmail: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = accounts.filter((a) => a.email !== accountEmail);
    saveAccounts(updated);
    setAccounts(updated);
  };

  const handleLogoutAndSwitch = async () => {
    setIsLoading(true);
    try {
      saveCurrentAccount();
      await logout();
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
      aria-label="Switch accounts"
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
              {mode === "list" ? "Switch Accounts" : `Login to ${selectedAccount?.displayName || selectedAccount?.username || email}`}
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

              {/* Saved accounts */}
              {accounts
                .filter((a) => a.email !== user?.email)
                .map((account) => (
                  <button
                    key={account.email}
                    onClick={() => handleSelectAccount(account)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#1a1a1a] transition-colors text-left group"
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={account.avatar} />
                      <AvatarFallback className="bg-[#5865F2] text-white text-sm">
                        {account.displayName?.charAt(0).toUpperCase() || account.username.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{account.displayName || account.username}</div>
                      <div className="text-xs text-[#888] truncate">{account.email}</div>
                    </div>
                    <button
                      onClick={(e) => handleRemoveAccount(account.email, e)}
                      className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#2a2a2a] transition-all"
                      title="Remove account"
                    >
                      <X className="w-4 h-4 text-[#888] hover:text-red-400" />
                    </button>
                  </button>
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
                <span className="text-sm font-medium text-[#b5bac1]">Add an account</span>
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
                <span className="text-sm font-medium text-red-400">Log out of {user?.displayName || "current account"}</span>
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
                  <label className="block text-xs font-bold uppercase text-[#b5bac1] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#1a1a1a] text-sm text-white placeholder:text-[#666] border border-[#333] focus:outline-none focus:border-[#5865F2] transition-colors"
                    placeholder="email@example.com"
                    autoFocus
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase text-[#b5bac1] mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLogin();
                  }}
                  className="w-full px-3 py-2 rounded bg-[#1a1a1a] text-sm text-white placeholder:text-[#666] border border-[#333] focus:outline-none focus:border-[#5865F2] transition-colors"
                  placeholder="Password"
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
                {isLoading ? "Logging in..." : "Login"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
