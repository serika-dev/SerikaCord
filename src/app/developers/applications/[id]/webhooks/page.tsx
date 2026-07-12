"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Plus, Trash2, Webhook, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface Webhook {
  id: string;
  url: string;
  name: string;
  events?: string[];
  active?: boolean;
  createdAt: string;
}

const WEBHOOK_EVENTS = [
  "application.command.create",
  "application.command.delete",
  "application.command.update",
  "message.create",
  "message.update",
  "message.delete",
  "guild.join",
  "guild.leave",
  "user.update",
];

export default function WebhooksPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading } = useApplication(appId);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetchWebhooks();
  }, [appId]);

  const fetchWebhooks = async () => {
    try {
      const res = await fetch(`/api/developers/applications/${appId}/webhooks`);
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks || []);
      }
    } catch {
      // ignore
    }
  };

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim(), events: newEvents }),
      });
      if (res.ok) {
        const data = await res.json();
        setWebhooks([...webhooks, data.webhook]);
        setNewName("");
        setNewUrl("");
        setNewEvents([]);
        setShowAdd(false);
        toast.success(gt("Webhook created!"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to create webhook"));
      }
    } catch {
      toast.error(gt("Failed to create webhook"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(gt("Delete this webhook?"))) return;
    try {
      const res = await fetch(`/api/developers/applications/${appId}/webhooks/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setWebhooks(webhooks.filter((w) => w.id !== id));
        toast.success(gt("Webhook deleted"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to delete webhook"));
      }
    } catch {
      toast.error(gt("Failed to delete webhook"));
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !current }),
      });
      if (res.ok) {
        setWebhooks(webhooks.map((w) => w.id === id ? { ...w, active: !current } : w));
        toast.success(gt("Webhook {state}", { state: !current ? gt("activated") : gt("deactivated") }));
      } else {
        toast.error(gt("Failed to toggle webhook"));
      }
    } catch {
      toast.error(gt("Failed to toggle webhook"));
    } finally {
      setTogglingId(null);
    }
  };

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{gt("Webhooks")}</h1>
          <p className="text-sm text-[#888] mt-1">
            {gt("Manage webhooks for your application to receive real-time events.")}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="size-4" /> {gt("Add Webhook")}
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
              {gt("Name")}
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Webhook"
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
              {gt("Webhook URL")}
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-site.com/webhook"
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
              {gt("Events")}
            </label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    newEvents.includes(event)
                      ? "bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-[#8B5CF6]"
                      : "bg-[#1a1a1a] border-white/[0.08] text-[#888] hover:text-white"
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim() || !newUrl.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {creating ? <Loader size={24} className="size-4" /> : null}
            {gt("Create Webhook")}
          </button>
        </div>
      )}

      {webhooks.length === 0 ? (
        <div className="text-center py-20">
          <Webhook className="size-12 text-[#333] mx-auto mb-4" />
          <p className="text-[#888] text-sm">{gt("No webhooks yet. Add one to receive events.")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0">
                  <Webhook className="size-5 text-[#8B5CF6]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{webhook.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      webhook.active ? "bg-green-500/10 text-green-400" : "bg-[#333] text-[#888]"
                    }`}>
                      {webhook.active ? gt("Active") : gt("Inactive")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-[#777] truncate font-mono">{webhook.url}</code>
                    <button
                      onClick={() => copyUrl(webhook.id, webhook.url)}
                      className="p-1 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors shrink-0"
                    >
                      {copiedId === webhook.id ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleToggleActive(webhook.id, webhook.active ?? true)}
                  disabled={togglingId === webhook.id}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                    webhook.active ? "bg-[#8B5CF6]" : "bg-[#333]"
                  }`}
                >
                  {togglingId === webhook.id && <Loader size={24} className="size-3 absolute inset-0 m-auto" />}
                  <span
                    className={`absolute top-0.5 left-0.5 size-5 bg-white rounded-full transition-transform ${
                      webhook.active ? "translate-x-5" : ""
                    }`}
                  />
                </button>
                <button
                  onClick={() => handleDelete(webhook.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-[#888] hover:text-red-400 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {webhook.events && webhook.events.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.04]">
                  {webhook.events.map((event) => (
                    <span key={event} className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-[#888]">
                      {event}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
