"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Shield, Check, Server, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
}

interface ApplicationData {
  application: {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
  };
  scopes: string[];
  redirect_uri: string | null;
}

const COMMON_PERMISSIONS = [
  { name: "Administrator", bit: 3n, desc: "Grants all permissions and bypasses channel permission overwrites. Extremely dangerous." },
  { name: "Manage Server", bit: 5n, desc: "Allows changing server name, region, and local settings." },
  { name: "Manage Roles", bit: 28n, desc: "Allows creating, editing, and deleting roles below this bot's role." },
  { name: "Manage Channels", bit: 4n, desc: "Allows creating, editing, and deleting channels." },
  { name: "Kick Members", bit: 1n, desc: "Allows removing members from the server." },
  { name: "Ban Members", bit: 2n, desc: "Allows banning members from the server." },
  { name: "Send Messages", bit: 11n, desc: "Allows sending text messages in channels." },
  { name: "Manage Messages", bit: 13n, desc: "Allows deleting and pinning messages sent by other users." },
  { name: "Read Message History", bit: 16n, desc: "Allows viewing past messages in text channels." },
  { name: "Mention Everyone", bit: 17n, desc: "Allows using @everyone, @here, and mentioning roles." },
  { name: "Speak", bit: 21n, desc: "Allows speaking in voice channels." },
  { name: "Mute Members", bit: 22n, desc: "Allows muting other members in voice channels." },
];

function AuthorizeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Query Params
  const clientId = searchParams.get("client_id") || "";
  const scopeParam = searchParams.get("scope") || "";
  const permissionsParam = searchParams.get("permissions") || "0";
  const redirectUri = searchParams.get("redirect_uri") || "";
  const responseType = searchParams.get("response_type") || "code";
  const state = searchParams.get("state") || "";

  // Component States
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [appData, setAppData] = useState<ApplicationData | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>("");
  const [botPermissions, setBotPermissions] = useState<bigint>(BigInt(permissionsParam));
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Authenticate user & load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        // 1. Fetch current user
        const userRes = await fetch("/api/users/@me");
        if (!userRes.ok) {
          // Redirect to login with current search string
          const currentUrl = window.location.pathname + window.location.search;
          router.push(`/login?redirect=${encodeURIComponent(currentUrl)}`);
          return;
        }
        const userData = await userRes.json();
        setCurrentUser(userData);

        // 2. Fetch application details
        if (!clientId) {
          setError("client_id query parameter is required.");
          setIsLoading(false);
          return;
        }

        const appRes = await fetch(`/api/oauth2/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopeParam)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
        if (!appRes.ok) {
          const appErr = await appRes.json();
          setError(appErr.error || "Failed to fetch application details.");
          setIsLoading(false);
          return;
        }
        const appInfo = await appRes.json();
        setAppData(appInfo);

        // 3. Fetch user guilds (only if scope contains bot)
        const scopes = scopeParam.split(" ");
        if (scopes.includes("bot")) {
          const guildsRes = await fetch("/api/users/@me/guilds");
          if (guildsRes.ok) {
            const allGuilds: Guild[] = await guildsRes.json();
            // Filter guilds where user has Administrator (bit 3) or Manage Server (bit 5)
            const eligible = allGuilds.filter((g) => {
              const perms = BigInt(g.permissions);
              const isOwner = g.owner;
              const isAdmin = (perms & (1n << 3n)) !== 0n;
              const isManager = (perms & (1n << 5n)) !== 0n;
              return isOwner || isAdmin || isManager;
            });
            setGuilds(eligible);
            if (eligible.length > 0) {
              setSelectedGuildId(eligible[0].id);
            }
          }
        }
      } catch (err) {
        setError("An unexpected error occurred while loading authorization data.");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [clientId, scopeParam, redirectUri, router]);

  const handlePermissionToggle = (bit: bigint) => {
    setBotPermissions((prev) => {
      if ((prev & (1n << bit)) !== 0n) {
        return prev & ~(1n << bit);
      } else {
        return prev | (1n << bit);
      }
    });
  };

  const handleAuthorize = async () => {
    setIsSubmitting(true);
    setError(null);

    const scopes = scopeParam.split(" ").filter(Boolean);

    try {
      const response = await fetch("/api/oauth2/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          serverId: selectedGuildId || undefined,
          permissions: scopes.includes("bot") ? String(botPermissions) : undefined,
          scopes,
          redirect_uri: redirectUri || undefined,
          state: state || undefined,
          response_type: responseType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to authorize application.");
      }

      if (data.redirect) {
        // If the window is a popup (has opener), post the message and close
        if (window.opener) {
          window.opener.postMessage({ type: "SERIKACORD_AUTH_SUCCESS", url: data.redirect }, "*");
          window.close();
        } else {
          window.location.href = data.redirect;
        }
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authorize application.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (redirectUri) {
      const cancelUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=access_denied&error_description=The+user+denied+access.`;
      if (window.opener) {
        window.opener.postMessage({ type: "SERIKACORD_AUTH_CANCEL", url: cancelUrl }, "*");
        window.close();
      } else {
        window.location.href = cancelUrl;
      }
    } else {
      if (window.opener) {
        window.close();
      } else {
        router.push("/channels/me");
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#070708] text-white">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B5CF6] mb-4" />
        <p className="text-[#888888] text-sm font-medium animate-pulse">Loading authorization details...</p>
      </div>
    );
  }

  if (error && !appData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070708] p-4 text-white">
        <div className="max-w-md w-full bg-[#0a0a0a]/90 border border-red-500/20 rounded-2xl p-8 shadow-2xl shadow-black/60 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">OAuth2 Error</h2>
          <p className="text-[#888888] text-sm mb-6">{error}</p>
          <Button onClick={handleCancel} className="w-full bg-[#1e1f22] hover:bg-[#2b2d31] text-white">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070708] p-4 text-white">
        <div className="max-w-md w-full bg-[#0a0a0a]/90 border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/60 text-center">
          <div className="w-16 h-16 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-[#8B5CF6]" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Authorized!</h2>
          <p className="text-[#888888] text-sm mb-6">
            You can now close this window or return to your app.
          </p>
          <Button onClick={() => window.close()} className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold">
            Close Window
          </Button>
        </div>
      </div>
    );
  }

  const scopes = scopeParam.split(" ").filter(Boolean);
  const isBotScope = scopes.includes("bot");

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#070708] p-4 text-white">
      <div className="max-w-[520px] w-full bg-[#0a0a0a]/95 backdrop-blur-md border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/80 overflow-hidden">
        {/* User Card Header */}
        <div className="bg-[#111214] px-8 py-4 border-b border-white/[0.04] flex items-center justify-between text-xs text-[#888888]">
          <span className="font-medium">Signed in as <strong className="text-white">{currentUser?.username}</strong></span>
          <button onClick={() => router.push("/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search))} className="text-[#8B5CF6] hover:underline font-semibold">
            Not you?
          </button>
        </div>

        <div className="p-8 space-y-6">
          {/* App Info header */}
          <div className="flex items-center space-y-0 space-x-5">
            <div className="w-16 h-16 bg-gradient-to-tr from-[#8B5CF6]/10 to-[#EC4899]/10 rounded-2xl border border-white/[0.08] flex items-center justify-center overflow-hidden flex-shrink-0 shadow-[0_0_15px_rgba(139,92,246,0.15)]">
              {appData?.application.icon ? (
                <img src={appData.application.icon} alt={appData.application.name} className="w-full h-full object-cover" />
              ) : (
                <img 
                  src={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(appData?.application.name || 'bot')}`}
                  alt=""
                  className="w-full h-full object-cover" 
                />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-1.5">
                {appData?.application.name}
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/20">
                  APP
                </span>
              </h1>
              <p className="text-xs text-[#888888] mt-1 font-medium max-w-[320px] line-clamp-2">
                {appData?.application.description || "No description provided."}
              </p>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-6 space-y-5">
            {/* Scopes section */}
            <div>
              <h3 className="text-xs font-semibold text-[#888888] uppercase tracking-wider mb-3">
                This app wants to access:
              </h3>
              <div className="space-y-2">
                {scopes.map((s) => (
                  <div key={s} className="flex items-start gap-2.5 text-sm text-[#e3e5e8]">
                    <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span>
                      {s === "bot" ? "Add a bot user to your server" : s === "applications.commands" ? "Create commands in your server" : `Access details matching scope '${s}'`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Server selection (if bot scope) */}
            {isBotScope && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-[#888888] uppercase tracking-wider">
                  Add Bot to Server:
                </h3>
                {guilds.length > 0 ? (
                  <div className="relative">
                    <select
                      value={selectedGuildId}
                      onChange={(e) => setSelectedGuildId(e.target.value)}
                      className="w-full h-11 bg-[#111111] border border-white/[0.08] rounded-xl px-4 text-white text-sm focus:outline-none focus:border-[#8B5CF6] transition-colors appearance-none cursor-pointer"
                    >
                      {guilds.map((g) => (
                        <option key={g.id} value={g.id} className="bg-[#111214] text-white">
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#888888]">
                      <Server className="w-4 h-4" />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3 text-amber-400 text-xs">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>You do not have Manage Server permissions in any server to add this bot.</span>
                  </div>
                )}
              </div>
            )}

            {/* Permissions Checkboxes (if bot scope and eligible server selected) */}
            {isBotScope && selectedGuildId && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-[#888888] uppercase tracking-wider">
                  Permissions Requested:
                </h3>
                <div className="max-h-[180px] overflow-y-auto border border-white/[0.06] bg-[#111111] rounded-xl p-4 space-y-3 scrollbar-thin">
                  {COMMON_PERMISSIONS.map((perm) => {
                    const isChecked = (botPermissions & (1n << perm.bit)) !== 0n;

                    return (
                      <label key={perm.name} className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handlePermissionToggle(perm.bit)}
                          className="mt-1 rounded border-white/[0.1] bg-[#1a1b1e] text-[#8B5CF6] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <div>
                          <span className="text-xs font-semibold text-white group-hover:text-[#8B5CF6] transition-colors">
                            {perm.name}
                          </span>
                          <p className="text-[10px] text-[#888888] leading-normal mt-0.5">
                            {perm.desc}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium leading-relaxed">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              className="flex-1 h-11 bg-transparent hover:bg-white/[0.04] text-white rounded-xl border border-white/[0.08] hover:border-white/[0.15] font-semibold transition-colors"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || (isBotScope && !selectedGuildId)}
              onClick={handleAuthorize}
              className="flex-1 h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Authorize"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#070708] text-white">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B5CF6] mb-4" />
        <p className="text-[#888888] text-sm font-medium animate-pulse">Loading authorization details...</p>
      </div>
    }>
      <AuthorizeForm />
    </Suspense>
  );
}
