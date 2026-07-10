"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useGT } from "gt-next";

export interface ApplicationData {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  coverImage?: string;
  botId?: string;
  botPublic?: boolean;
  botRequireCodeGrant?: boolean;
  botToken?: string;
  clientSecret?: string;
  clientId?: string;
  redirectUris?: string[];
  scopes?: string[];
  verified?: boolean;
  serverCount?: number;
  teamId?: string;
  createdAt: string;
  tags?: string[];
  installParams?: {
    scopes?: string[];
    permissions?: string;
  };
  customInstallUrl?: string;
  emojiCount?: number;
  webhookCount?: number;
  gatewayIntents?: number;
  interactionsEndpointUrl?: string | null;
  publicKey?: string | null;
}

export function useApplication(appId: string) {
  const gt = useGT();
  const [app, setApp] = useState<ApplicationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApp = useCallback(async () => {
    try {
      const res = await fetch(`/api/developers/applications/${appId}`);
      if (res.ok) {
        const data = await res.json();
        setApp(data.application || data);
        setError(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to load application");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchApp();
  }, [fetchApp]);

  const saveApp = async (patch: Partial<ApplicationData>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setApp((prev) => ({ ...prev, ...data.application, ...patch }));
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to save changes"));
        return false;
      }
    } catch {
      toast.error(gt("Failed to save changes"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { app, loading, saving, error, saveApp, refetch: fetchApp };
}
