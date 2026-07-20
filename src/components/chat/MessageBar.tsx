"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  PlusCircle,
  ImageIcon,
  ImagePlay,
  Sticker,
  Smile,
  SendHorizontal, 
  X,
  FileText,
  Reply,
  Music,
  Hash,
  Ban,
  UserMinus,
  Volume2,
  Clock,
  Eraser,
  Shield,
  ShieldCheck,
  Info,
  UserCircle,
  Dice5,
  MessageSquare,
  CircleHelp,
  Timer,
  Gavel,
  Gauge,
  Megaphone,
  Bot,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import dynamic from "next/dynamic";
// Lazy-loaded: the emoji/GIF/sticker picker (+ its emoji dataset) is ~2k lines
// that only matter once the user opens it, so it stays out of the initial chat
// bundle. Radix only mounts PopoverContent on open, so this fetches on first use.
const CustomEmojiPicker = dynamic(
  () => import("@/components/chat/CustomEmojiPicker").then((m) => m.CustomEmojiPicker),
  { ssr: false, loading: () => <div className="w-[440px] max-w-[calc(100vw-1rem)] h-[420px]" /> }
);
import { RichComposer, type RichComposerHandle, type ComposerEmoji } from "@/components/chat/RichComposer";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { onHotkey } from "@/lib/keybinds";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { useAuth } from "@/contexts/AuthContext";

const COMMAND_ICONS: Record<string, React.ReactNode> = {
  clear: <Eraser className="w-3.5 h-3.5" />,
  kick: <UserMinus className="w-3.5 h-3.5" />,
  ban: <Ban className="w-3.5 h-3.5" />,
  unban: <ShieldCheck className="w-3.5 h-3.5" />,
  timeout: <Timer className="w-3.5 h-3.5" />,
  warn: <Megaphone className="w-3.5 h-3.5" />,
  slowmode: <Gauge className="w-3.5 h-3.5" />,
  nick: <Hash className="w-3.5 h-3.5" />,
  serverinfo: <Info className="w-3.5 h-3.5" />,
  userinfo: <UserCircle className="w-3.5 h-3.5" />,
  avatar: <UserCircle className="w-3.5 h-3.5" />,
  roll: <Dice5 className="w-3.5 h-3.5" />,
  tts: <Volume2 className="w-3.5 h-3.5" />,
  "8ball": <CircleHelp className="w-3.5 h-3.5" />,
  me: <MessageSquare className="w-3.5 h-3.5" />,
  shrug: <MessageSquare className="w-3.5 h-3.5" />,
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  moderation: <Shield className="w-3 h-3" />,
  utility: <Info className="w-3 h-3" />,
  fun: <Dice5 className="w-3 h-3" />,
};

export interface MessageBarAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  spoiler?: boolean;
}

export interface MessageBarHandle {
  getAttachments: () => File[];
  clearAttachments: () => void;
  uploadAttachments: () => Promise<MessageBarAttachment[]>;
  getComposer: () => RichComposerHandle | null;
  focus: () => void;
}

interface ServerEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  serverIcon?: string;
  animated?: boolean;
}

interface ServerSticker {
  id: string;
  name: string;
  imageUrl: string;
  serverId?: string;
  serverName?: string;
}

interface MentionSuggestion {
  id: string;
  kind: "user" | "role" | "everyone" | "here" | "emoji" | "unicode-emoji" | "command" | "param-user" | "param-duration" | "param-choice" | "param-hint" | "channel" | "app-command" | "app-option" | "app-choice";
  unicodeChar?: string;
  label: string;
  description?: string;
  color?: string;
  imageUrl?: string;
  animated?: boolean;
  usage?: string;
  paramName?: string;
  paramRequired?: boolean;
  paramValue?: string;
  commandName?: string;
  commandHint?: string;
  category?: string;
  appName?: string;
  appIcon?: string | null;
  botId?: string;
  emoji?: string;
  fullName?: string;
  optionType?: number;
  optionNames?: string[];
}

interface ReplyTarget {
  author?: { displayName?: string; username?: string };
  content?: string;
}

interface MessageBarProps {
  placeholder: string;
  ariaLabel?: string;
  onSend: () => void;
  onChange: (value: string, caret: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCaretMove?: (text: string, caret: number) => void;
  onEmojiSelect: (
    emoji: string,
    isCustom?: boolean,
    emojiData?: { id: string; name: string; animated?: boolean; url?: string }
  ) => void;
  onGifSelect: (gifUrl: string) => void;
  onStickerSelect: (sticker: ServerSticker) => void;

  isSending?: boolean;
  disabled?: boolean;

  // Picker data
  serverEmojis?: ServerEmoji[];
  availableServerEmojis?: ServerEmoji[];
  availableServerStickers?: ServerSticker[];
  serverId?: string;
  serverName?: string;

  // Reply
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;

  // Mentions
  mentionSuggestions?: MentionSuggestion[];
  onMentionSelect?: (suggestion: MentionSuggestion) => void;
  activeMentionIndex?: number;

  // Upload
  channelId?: string;
  uploadEndpoint?: string;

  /** Stable per-context id (channel/DM). When it changes, the unsent draft for
   *  the previous context is saved and the new context's draft is restored so
   *  switching channels no longer loses typed-but-unsent text. */
  draftKey?: string;
}

const DRAFT_PREFIX = "serika:draft:";
function loadDraft(key: string): string {
  try { return localStorage.getItem(DRAFT_PREFIX + key) || ""; } catch { return ""; }
}
function persistDraft(key: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_PREFIX + key, text);
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch { /* storage unavailable */ }
}

export const MessageBar = forwardRef<MessageBarHandle, MessageBarProps>(
  function MessageBar(
    {
      placeholder,
      ariaLabel,
      onSend,
      onChange,
      onKeyDown,
      onCaretMove,
      onEmojiSelect,
      onGifSelect,
      onStickerSelect,
      isSending = false,
      disabled = false,
      serverEmojis,
      availableServerEmojis,
      availableServerStickers,
      serverId,
      serverName,
      replyTo,
      onCancelReply,
      mentionSuggestions = [],
      onMentionSelect,
      activeMentionIndex = 0,
      channelId,
      uploadEndpoint = "/api/upload/attachment",
      draftKey,
    },
    ref
  ) {
    const gt = useGT();
    const { user } = useAuth();
    const emojiPickerEnabled = user?.settings?.textImages?.emojiPicker !== false;
    const stickerSuggestionsEnabled = user?.settings?.textImages?.stickerSuggestions !== false;
    const composerRef = useRef<RichComposerHandle>(null);

    // Draft persistence: save the previous context's unsent text and restore the
    // new one whenever draftKey changes. Reads the live composer text at save
    // time (empty right after a send), so sent messages never leave a stale draft.
    const prevDraftKeyRef = useRef<string | undefined>(undefined);
    useEffect(() => {
      const prev = prevDraftKeyRef.current;
      if (prev === draftKey) return;
      if (prev !== undefined) persistDraft(prev, composerRef.current?.getText() ?? "");
      const composer = composerRef.current;
      if (composer && draftKey !== undefined) {
        composer.clear();
        const draft = loadDraft(draftKey);
        if (draft) composer.insertTextAtCaret(draft);
      }
      prevDraftKeyRef.current = draftKey;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftKey]);

    // Save the current draft on unmount and when the tab is hidden/closed.
    useEffect(() => {
      const save = () => {
        if (prevDraftKeyRef.current !== undefined) {
          persistDraft(prevDraftKeyRef.current, composerRef.current?.getText() ?? "");
        }
      };
      const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
      window.addEventListener("pagehide", save);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("pagehide", save);
        document.removeEventListener("visibilitychange", onVisibility);
        save();
      };
    }, []);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [attachments, setAttachments] = useState<File[]>([]);
    const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [spoilerFlags, setSpoilerFlags] = useState<Set<number>>(new Set());
    /** Per-attachment upload progress (0-100), keyed by attachment index. */
    const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [pickerTab, setPickerTab] = useState<"emoji" | "gifs" | "stickers">("emoji");
    // Mirror picker state into refs so the (once-registered) hotkey handlers can
    // read the latest values for tab-aware toggling.
    const showEmojiPickerRef = useRef(showEmojiPicker);
    const pickerTabRef = useRef(pickerTab);
    useEffect(() => { showEmojiPickerRef.current = showEmojiPicker; }, [showEmojiPicker]);
    useEffect(() => { pickerTabRef.current = pickerTab; }, [pickerTab]);
    const [hasText, setHasText] = useState(false);
    const [acceptFileTypes, setAcceptFileTypes] = useState<string>("*/*");

    useEffect(() => {
      fetch("/api/platform/file-types-accept")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const accept = data?.accept as string | undefined;
          if (accept && accept.length > 0) {
            setAcceptFileTypes(accept);
          }
        })
        .catch(() => {});
    }, []);

    // Broadcast keyboard-shortcut actions owned by the composer.
    useEffect(() => {
      // Pressing a picker hotkey opens that tab; pressing the same one again
      // (while that tab is showing) closes the picker.
      const toggleTab = (tab: "emoji" | "gifs" | "stickers") => {
        if (showEmojiPickerRef.current && pickerTabRef.current === tab) {
          setShowEmojiPicker(false);
        } else {
          setPickerTab(tab);
          setShowEmojiPicker(true);
        }
      };
      const unsubs = [
        onHotkey("toggle-emoji", () => toggleTab("emoji")),
        onHotkey("toggle-gifs", () => toggleTab("gifs")),
        onHotkey("toggle-stickers", () => toggleTab("stickers")),
        onHotkey("upload-file", () => fileInputRef.current?.click()),
      ];
      return () => unsubs.forEach((u) => u());
    }, []);

    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        // 1. Only capture keydown when tab is visible
        if (document.visibilityState !== "visible") return;

        // 2. Ignore modifier key combinations (Ctrl/Meta/Alt)
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // 3. Only capture single character keys (printable characters)
        if (!e.key || e.key.length !== 1) return;

        // 4. Ignore if user is already focused on an editable element
        const active = document.activeElement;
        if (active) {
          const tagName = active.tagName.toLowerCase();
          const isEditable =
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select" ||
            active.getAttribute("contenteditable") === "true" ||
            (active as HTMLElement).isContentEditable;
          if (isEditable) return;
        }

        // 5. Ignore if any modal, dialog, or context menu is open
        const isModalOpen = document.querySelector('[role="dialog"], [role="menu"]') !== null;
        if (isModalOpen) return;

        // 6. Focus the message bar input
        composerRef.current?.focus();
      };

      window.addEventListener("keydown", handleGlobalKeyDown);
      return () => {
        window.removeEventListener("keydown", handleGlobalKeyDown);
      };
    }, []);

    // Ref mirror of attachments.length so addFiles doesn't depend on state
    // (prevents stale closures on mobile where the file picker can suspend the page).
    const attachmentsCountRef = useRef(0);
    attachmentsCountRef.current = attachments.length;

    // ---- File upload ----
    const addFiles = useCallback((files: File[]) => {
      if (files.length === 0) return;

      const maxFree = 500 * 1024 * 1024; // 500MB
      const maxPremium = 2 * 1024 * 1024 * 1024; // 2GB

      const validFiles: File[] = [];
      for (const file of files) {
        if (file.size > maxPremium) {
          toast.error(`${file.name} ${gt("is too large")}`, { description: `${gt("Maximum is 2GB (Serika+). File is")} ${(file.size / 1024 / 1024).toFixed(1)}MB.` });
          continue;
        }
        if (file.size > maxFree) {
          toast.error(`${file.name} ${gt("exceeds 500MB")}`, { description: gt("Upgrade to Serika+ for up to 2GB uploads.") });
          continue;
        }
        validFiles.push(file);
      }

      if (validFiles.length === 0) return;

      const currentCount = attachmentsCountRef.current;
      const remainingSlots = 10 - currentCount;
      if (validFiles.length > remainingSlots) {
        toast.error(gt("Attachment limit reached"), { description: gt("You can attach up to 10 files per message.") });
      }
      const newFiles = validFiles.slice(0, Math.max(0, remainingSlots));
      if (newFiles.length === 0) return;
      setAttachments((prev) => [...prev, ...newFiles]);
      if (newFiles.length === 1) {
        toast.success(`${gt("Attached")} ${newFiles[0].name}`);
      } else {
        toast.success(`${gt("Attached")} ${newFiles.length} ${gt("files")}`);
      }

      // Previews are index-aligned with attachments, so use object URLs
      // synchronously (FileReader callbacks could land out of order).
      const newPreviews = newFiles.map((file) =>
        file.type.startsWith("image/") || file.type.startsWith("video/")
          ? URL.createObjectURL(file)
          : ""
      );
      setAttachmentPreviews((prev) => [...prev, ...newPreviews]);
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      // Clear input value immediately so re-selecting the same file works
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      addFiles(files);
    }, [addFiles]);

    // Tauri fallback: WebKitGTK/WebView2 webviews often don't expose pasted
    // images through the standard clipboard event. When that happens, read the
    // image natively via the Tauri clipboard-manager plugin and convert the
    // RGBA bytes to a PNG File via canvas.
    const readTauriClipboardImage = useCallback(async (): Promise<File | null> => {
      const tauri = (window as any).__TAURI__;
      if (!tauri?.core?.invoke) return null;
      try {
        const img = await tauri.core.invoke('plugin:clipboard-manager|read_image');
        if (!img || !img.rgba || !img.width || !img.height) return null;
        const byteStr = atob(img.rgba);
        const bytes = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const imageData = ctx.createImageData(img.width, img.height);
        imageData.data.set(bytes);
        ctx.putImageData(imageData, 0, 0);
        const blob: Blob = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/png');
        });
        if (!blob) return null;
        const name = `clipboard-${Date.now()}.png`;
        return new File([blob], name, { type: 'image/png' });
      } catch {
        return null;
      }
    }, []);

    // Paste-to-attach (screenshots, copied images)
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      // `files` is empty on some webviews (e.g. WebKitGTK in the desktop app),
      // where pasted images arrive as clipboard `items` of kind "file" instead.
      const files: File[] = Array.from(dt.files || []);
      if (files.length === 0 && dt.items) {
        for (const item of Array.from(dt.items)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      } else if ((window as any).__TAURI__) {
        e.preventDefault();
        readTauriClipboardImage().then((file) => {
          if (file) addFiles([file]);
        });
      }
    }, [addFiles, readTauriClipboardImage]);

    // Global paste-to-attach: when the composer isn't focused, a Ctrl/Cmd+V of an
    // image (screenshot, copied file) still attaches it here — matching how the
    // focused composer behaves. Skips when another editable element is focused
    // (let it handle its own paste) or a modal/menu is open.
    useEffect(() => {
      const onWindowPaste = (e: ClipboardEvent) => {
        const active = document.activeElement as HTMLElement | null;
        if (active) {
          const tagName = active.tagName.toLowerCase();
          const isEditable =
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select" ||
            active.getAttribute("contenteditable") === "true" ||
            active.isContentEditable;
          // Any focused editable (including the composer, a contenteditable) handles
          // its own paste — the composer's React onPaste covers the focused case.
          if (isEditable) return;
        }
        if (document.querySelector('[role="dialog"], [role="menu"]') !== null) return;

        const dt = e.clipboardData;
        if (!dt) return;
        const files: File[] = Array.from(dt.files || []);
        if (files.length === 0 && dt.items) {
          for (const item of Array.from(dt.items)) {
            if (item.kind === "file") {
              const f = item.getAsFile();
              if (f) files.push(f);
            }
          }
        }
        // Only intercept actual files; plain-text pastes should focus + type.
        if (files.length > 0) {
          e.preventDefault();
          addFiles(files);
          composerRef.current?.focus();
        } else if ((window as any).__TAURI__) {
          e.preventDefault();
          readTauriClipboardImage().then((file) => {
            if (file) {
              addFiles([file]);
              composerRef.current?.focus();
            }
          });
        }
      };
      window.addEventListener("paste", onWindowPaste);
      return () => window.removeEventListener("paste", onWindowPaste);
    }, [addFiles, readTauriClipboardImage]);

    // Drag & drop attach
    const [isDragOver, setIsDragOver] = useState(false);
    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      addFiles(Array.from(e.dataTransfer?.files || []));
    }, [addFiles]);

    const removeAttachment = useCallback((index: number) => {
      const preview = attachmentPreviews[index];
      if (preview && preview.startsWith("blob:")) {
        URL.revokeObjectURL(preview);
      }
      setAttachments((prev) => prev.filter((_, i) => i !== index));
      setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
      setSpoilerFlags((prev) => {
        const next = new Set<number>();
        for (const idx of prev) {
          if (idx < index) next.add(idx);
          else if (idx > index) next.add(idx - 1);
        }
        return next;
      });
    }, [attachmentPreviews]);

    const toggleSpoiler = useCallback((index: number) => {
      setSpoilerFlags((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    }, []);

    // ---- Upload attachments to server (XHR for real progress events) ----
    const uploadSingleFile = useCallback(
      (file: File, index: number): Promise<MessageBarAttachment | null> =>
        new Promise((resolve) => {
          const formData = new FormData();
          formData.append("file", file);
          if (channelId) {
            formData.append("channelId", channelId);
          }
          formData.append("spoiler", spoilerFlags.has(index) ? "true" : "false");

          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadEndpoint);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              setUploadProgress((prev) => ({ ...prev, [index]: percent }));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                setUploadProgress((prev) => ({ ...prev, [index]: 100 }));
                resolve(data.attachment ?? null);
                return;
              } catch {
                // fall through to error toast
              }
            }
            let errorMsg = `${gt("Failed to upload")} ${file.name}`;
            try {
              const data = JSON.parse(xhr.responseText);
              if (data?.error) errorMsg = data.error;
            } catch {
              // keep default message
            }
            toast.error(errorMsg, { description: file.name });
            resolve(null);
          };
          xhr.onerror = () => {
            toast.error(`${gt("Failed to upload")} ${file.name}`, { description: gt("Network error — check your connection.") });
            resolve(null);
          };
          xhr.send(formData);
        }),
      [channelId, uploadEndpoint]
    );

    const uploadAttachments = useCallback(async (): Promise<MessageBarAttachment[]> => {
      if (attachments.length === 0) return [];
      setIsUploading(true);
      setUploadProgress({});
      try {
        const results = await Promise.all(
          attachments.map((file, index) => uploadSingleFile(file, index))
        );
        return results.filter((r): r is MessageBarAttachment => r !== null);
      } finally {
        setIsUploading(false);
        setUploadProgress({});
      }
    }, [attachments, uploadSingleFile]);

    // Expose uploadAttachments via a stable callback on the ref
    // We store it on a ref so the parent can call it
    const uploadRef = useRef(uploadAttachments);
    uploadRef.current = uploadAttachments;

    // Override the ref to include uploadAttachments
    useImperativeHandle(ref, () => ({
      getAttachments: () => attachments,
      clearAttachments: () => {
        attachmentPreviews.forEach((p) => {
          if (p.startsWith("blob:")) URL.revokeObjectURL(p);
        });
        setAttachments([]);
        setAttachmentPreviews([]);
        setSpoilerFlags(new Set());
      },
      getComposer: () => composerRef.current,
      focus: () => composerRef.current?.focus(),
      uploadAttachments: () => uploadRef.current(),
    }), [attachments, spoilerFlags]);

    // ---- Handlers ----
    const handleComposerChange = useCallback((value: string, caret: number) => {
      setHasText(value.trim().length > 0);
      onChange(value, caret);
    }, [onChange]);

    const handlePickerEmojiSelect = useCallback((
      emoji: string,
      isCustom?: boolean,
      emojiData?: { id: string; name: string; animated?: boolean; url?: string }
    ) => {
      onEmojiSelect(emoji, isCustom, emojiData);
      setShowEmojiPicker(false);
    }, [onEmojiSelect]);

    const handlePickerGifSelect = useCallback((gifUrl: string) => {
      onGifSelect(gifUrl);
      setShowEmojiPicker(false);
    }, [onGifSelect]);

    const handlePickerStickerSelect = useCallback((sticker: ServerSticker) => {
      onStickerSelect(sticker);
      setShowEmojiPicker(false);
    }, [onStickerSelect]);

    const canSend = (hasText || attachments.length > 0) && !isUploading;

    return (
      <>
        {/* Hidden file input — outside the visual container to prevent event interference */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          accept={acceptFileTypes}
          style={{ display: "none" }}
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="px-1 sm:px-2 pb-1">
            <div className="flex flex-wrap gap-2 p-2 bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)]">
              {attachments.map((file, index) => {
                const isSpoiler = spoilerFlags.has(index);
                const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
                return (
                <div key={index} className="relative group">
                  {file.type.startsWith("image/") && attachmentPreviews[index] ? (
                    <img src={attachmentPreviews[index]} alt={file.name} className={cn("w-20 h-20 object-cover rounded-md", isSpoiler && "blur-[6px]")} />
                  ) : file.type.startsWith("video/") && attachmentPreviews[index] ? (
                    <div className="relative w-20 h-20 rounded-md overflow-hidden bg-black">
                      <video src={attachmentPreviews[index]} className={cn("w-full h-full object-cover", isSpoiler && "blur-[6px]")} preload="metadata" muted />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-6 h-6 bg-black/60 rounded-full flex items-center justify-center">
                          <div className="w-0 h-0 border-l-[8px] border-l-white border-y-[5px] border-y-transparent ml-0.5" />
                        </div>
                      </div>
                    </div>
                  ) : file.type.startsWith("audio/") ? (
                    <div className="w-20 h-20 bg-[var(--app-surface-alt)] rounded-md flex flex-col items-center justify-center p-2">
                      <Music className="w-6 h-6 text-[#8B5CF6] mb-1" />
                      <span className="text-xs text-[var(--app-muted)] truncate w-full text-center">{file.name.slice(0, 10)}</span>
                    </div>
                  ) : (
                    <div className="w-20 h-20 bg-[var(--app-surface-alt)] rounded-md flex flex-col items-center justify-center p-2">
                      <FileText className="w-6 h-6 text-[#8B5CF6] mb-1" />
                      <span className="text-xs text-[var(--app-muted)] truncate w-full text-center">{file.name.slice(0, 10)}</span>
                    </div>
                  )}
                  {/* Upload progress overlay */}
                  {isUploading && (
                    <div className="absolute inset-0 rounded-md bg-black/50 flex flex-col items-center justify-center gap-1">
                      <span className="text-[10px] font-semibold text-white">
                        {uploadProgress[index] ?? 0}%
                      </span>
                      <div className="w-14 h-1 rounded-full bg-white/30 overflow-hidden">
                        <div
                          className="h-full bg-[#8B5CF6] transition-[width] duration-200"
                          style={{ width: `${uploadProgress[index] ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {!isUploading && isMedia && (
                    <button
                      type="button"
                      onClick={() => toggleSpoiler(index)}
                      className={cn(
                        "absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center transition-opacity z-10",
                        isSpoiler
                          ? "bg-[#8B5CF6] opacity-100"
                          : "bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      )}
                      aria-label={isSpoiler ? gt("Remove spoiler") : gt("Mark as spoiler")}
                      title={isSpoiler ? gt("Remove spoiler") : gt("Mark as spoiler")}
                    >
                      {isSpoiler ? <EyeOff className="w-3 h-3 text-white" /> : <Eye className="w-3 h-3 text-white" />}
                    </button>
                  )}
                  {!isUploading && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      aria-label={`${gt("Remove")} ${file.name}`}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Message Input */}
        <div
          className={cn(
            "px-1 sm:px-2 pb-1 sm:pb-1.5 flex-shrink-0 relative",
            isDragOver && "after:absolute after:inset-1 after:rounded-lg after:border-2 after:border-dashed after:border-[#8B5CF6] after:bg-[#8B5CF6]/10 after:pointer-events-none"
          )}
          onPaste={handlePaste}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
              setIsDragOver(true);
            }
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Reply preview */}
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-lg flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <Reply className="w-4 h-4 text-[var(--app-muted)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--app-muted)] mb-0.5">
                    {gt("Replying to")} {replyTo.author?.displayName || replyTo.author?.username || gt("message")}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    {replyTo.content ? decodeHtmlEntities(replyTo.content) : gt("(attachment)")}
                  </p>
                </div>
              </div>
              {onCancelReply && (
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                  title={gt("Cancel reply")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div className="bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)] overflow-hidden">
            {/* Mention suggestions overlay */}
            {mentionSuggestions.length > 0 && (
              <div className="absolute left-2 right-2 bottom-[calc(100%+8px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden max-h-80 overflow-y-auto">
                {/* Command list — bot commands grouped by application, then
                    built-in commands grouped by category (Discord-style). */}
                {mentionSuggestions.length > 0 && mentionSuggestions.every(s => s.kind === "command" || s.kind === "app-command") && (() => {
                  // Preserve first-seen order so the running index matches the
                  // flat suggestion array used for keyboard navigation.
                  const groups: { key: string; kind: "app" | "cat"; label: string; icon?: string | null; items: MentionSuggestion[] }[] = [];
                  const indexOf = new Map<string, number>();
                  const catMeta: Record<string, { label: string; color: string }> = {
                    moderation: { label: gt("Moderation"), color: "text-red-400" },
                    utility: { label: gt("Utility"), color: "text-blue-400" },
                    fun: { label: gt("Fun"), color: "text-amber-400" },
                  };
                  for (const s of mentionSuggestions) {
                    const key = s.kind === "app-command" ? `app:${s.appName}` : `cat:${s.category || "utility"}`;
                    if (!indexOf.has(key)) {
                      indexOf.set(key, groups.length);
                      groups.push({
                        key,
                        kind: s.kind === "app-command" ? "app" : "cat",
                        label: s.kind === "app-command" ? (s.appName || gt("Bot")) : catMeta[s.category || "utility"].label,
                        icon: s.kind === "app-command" ? s.appIcon : undefined,
                        items: [],
                      });
                    }
                    groups[indexOf.get(key)!].items.push(s);
                  }
                  let globalIdx = 0;
                  return groups.map((group) => (
                    <div key={group.key}>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface)]/50 border-b border-[var(--app-border)]/50 sticky top-0 z-10">
                        {group.kind === "app" ? (
                          group.icon ? (
                            <img src={cdnImage(group.icon)} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0" />
                          ) : (
                            <Bot className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />
                          )
                        ) : (
                          <span className={cn("shrink-0", catMeta[group.key.slice(4)]?.color)}>{CATEGORY_ICONS[group.key.slice(4)]}</span>
                        )}
                        <span className={cn("text-[10px] font-bold uppercase tracking-wider truncate", group.kind === "app" ? "text-[#a78bfa]" : catMeta[group.key.slice(4)]?.color)}>{group.label}</span>
                        <span className="text-[10px] text-[var(--app-muted)] ml-auto">{group.items.length}</span>
                      </div>
                      {group.items.map((suggestion) => {
                        const idx = globalIdx++;
                        const isApp = suggestion.kind === "app-command";
                        const cmdIcon = isApp
                          ? (suggestion.appIcon
                              ? <img src={cdnImage(suggestion.appIcon)} alt="" className="w-full h-full rounded-md object-cover" />
                              : <Bot className="w-3.5 h-3.5" />)
                          : (COMMAND_ICONS[suggestion.id as keyof typeof COMMAND_ICONS] || <Hash className="w-3.5 h-3.5" />);
                        return (
                          <button
                            key={`${suggestion.kind}-${suggestion.id}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              onMentionSelect?.(suggestion);
                            }}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                              idx === activeMentionIndex
                                ? "bg-[var(--app-accent)]/15 text-[var(--text-primary)]"
                                : "hover:bg-[var(--app-surface)]/60 text-[var(--text-primary)]"
                            )}
                          >
                            <span className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md bg-[#8B5CF6]/15 text-[#a78bfa] overflow-hidden">
                              {cmdIcon}
                            </span>
                            <span className="flex flex-col min-w-0 gap-0.5">
                              <span className="truncate font-mono text-sm text-[#a78bfa]">/{suggestion.label}</span>
                              <span className="truncate text-xs text-[var(--app-muted)]">{suggestion.description}</span>
                              {suggestion.commandHint && (
                                <span className="truncate text-[10px] text-[var(--app-muted)]/60 italic">{suggestion.commandHint}</span>
                              )}
                            </span>
                            {isApp && suggestion.appName ? (
                              <span className="ml-auto text-[11px] text-[var(--app-muted)] truncate shrink-0 max-w-[140px]">
                                {suggestion.appName}
                              </span>
                            ) : suggestion.usage ? (
                              <span className="ml-auto text-[10px] font-mono text-[var(--app-muted)]/70 truncate shrink-0 max-w-[140px]">
                                {suggestion.usage}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()}

                {/* App command OPTIONS list (screenshot: difficulty / mode / anilist) */}
                {mentionSuggestions.length > 0 && mentionSuggestions.every(s => s.kind === "app-option") && mentionSuggestions[0].id !== "__app-option-hint__" && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface)]/50 border-b border-[var(--app-border)]/50">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-muted)]">{gt("Options")}</span>
                      <span className="font-mono text-[10px] text-[#a78bfa] ml-auto truncate">/{mentionSuggestions[0].commandName}</span>
                    </div>
                    {mentionSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion.kind}-${suggestion.id}`}
                        type="button"
                        onMouseDown={(event) => { event.preventDefault(); onMentionSelect?.(suggestion); }}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                          index === activeMentionIndex
                            ? "bg-[var(--app-accent)]/15 text-[var(--text-primary)]"
                            : "hover:bg-[var(--app-surface)]/60 text-[var(--text-primary)]"
                        )}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-sm text-[var(--text-primary)] truncate">{suggestion.label}</span>
                          {suggestion.paramRequired && (
                            <span className="text-[9px] font-bold uppercase text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded shrink-0">{gt("required")}</span>
                          )}
                        </span>
                        {suggestion.description && (
                          <span className="text-xs text-[var(--app-muted)] truncate shrink-0 max-w-[55%]">{suggestion.description}</span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* App command choice list (screenshot: 🎵 Audio — guess from theme song) */}
                {mentionSuggestions.length > 0 && mentionSuggestions.every(s => s.kind === "app-choice") && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface)]/50 border-b border-[var(--app-border)]/50">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-muted)]">{mentionSuggestions[0].paramName}</span>
                      <span className="font-mono text-[10px] text-[#a78bfa] ml-auto truncate">/{mentionSuggestions[0].commandName}</span>
                    </div>
                    {mentionSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion.kind}-${suggestion.id}`}
                        type="button"
                        onMouseDown={(event) => { event.preventDefault(); onMentionSelect?.(suggestion); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          index === activeMentionIndex
                            ? "bg-[var(--app-accent)]/15 text-[var(--text-primary)]"
                            : "hover:bg-[var(--app-surface)]/60 text-[var(--text-primary)]"
                        )}
                      >
                        {suggestion.emoji && <span className="text-base shrink-0">{suggestion.emoji}</span>}
                        <span className="text-sm text-[var(--text-primary)] truncate">{suggestion.label}</span>
                        {suggestion.description && (
                          <span className="text-xs text-[var(--app-muted)] truncate">— {suggestion.description}</span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* App free-text option hint (single card) */}
                {mentionSuggestions.length === 1 && mentionSuggestions[0].kind === "app-option" && mentionSuggestions[0].id === "__app-option-hint__" && (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-sm text-[#a78bfa]">/{mentionSuggestions[0].commandName}</span>
                      <span className="text-xs text-[var(--app-muted)]">—</span>
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">{mentionSuggestions[0].paramName}</span>
                      {mentionSuggestions[0].paramRequired && (
                        <span className="text-[9px] font-bold uppercase text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded">{gt("required")}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--app-muted)] leading-relaxed">{mentionSuggestions[0].description}</p>
                    <p className="text-[10px] text-[var(--app-muted)]/60 mt-1.5">{gt("Type your value and press space…")}</p>
                  </div>
                )}

                {/* Param hint card (single item) */}
                {mentionSuggestions.length === 1 && mentionSuggestions[0].kind === "param-hint" && (() => {
                  const s = mentionSuggestions[0];
                  const cmdIcon = s.commandName ? COMMAND_ICONS[s.commandName as keyof typeof COMMAND_ICONS] : null;
                  const isTts = s.commandName === "tts";
                  return (
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        {cmdIcon && (
                          <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md bg-[#8B5CF6]/15 text-[#a78bfa]">
                            {cmdIcon}
                          </span>
                        )}
                        <span className="font-mono text-sm text-[#a78bfa]">/{s.commandName}</span>
                        <span className="text-xs text-[var(--app-muted)]">—</span>
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">{s.paramName}</span>
                        {s.paramRequired && (
                          <span className="text-[9px] font-bold uppercase text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded">{gt("required")}</span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--app-muted)] leading-relaxed pl-8">{s.description}</p>
                      {isTts ? (
                        <div className="mt-2.5 pl-8 space-y-1.5">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[f]</span>
                            <span className="text-[var(--app-muted)]">{gt("Female voice")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[m]</span>
                            <span className="text-[var(--app-muted)]">{gt("Male voice")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[2x]</span>
                            <span className="text-[var(--app-muted)]">{gt("Speed (also: [1.5x], [slow], [fast], [turbo])")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[vol:50]</span>
                            <span className="text-[var(--app-muted)]">{gt("Volume 0–500% (also: [vol:BASS] bass boost, [vol:EAR] max loudness)")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[steven]</span>
                            <span className="text-[var(--app-muted)]">{gt("Stephen Hawking robotic voice")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[fish:miku]</span>
                            <span className="text-[var(--app-muted)]">{gt("FishAudio AI voice (also: [fish:model-id])")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#a78bfa] font-mono font-semibold">[f-japanese]</span>
                            <span className="text-[var(--app-muted)]">{gt("Gender + accent (also: [m-dutch], [scottish]…)")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <Volume2 className="w-3 h-3 shrink-0 text-emerald-400/70" />
                            <span className="text-[var(--app-muted)]">{gt("Switch speakers mid-message: [m] hi [f] hello")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <Music className="w-3 h-3 shrink-0 text-amber-400/70" />
                            <span className="text-[var(--app-muted)]">{gt("Trigger words auto-play sound effects mid-speech")}</span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-[var(--app-border)]/40">
                            <p className="text-[10px] text-[var(--app-muted)]/70 font-mono">
                              <span className="text-[#a78bfa]">/tts</span> [m] whoa nice day [f] ik right
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-[var(--app-muted)]/60 mt-1.5 pl-8">{gt("Type your value and press space…")}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Param user suggestions */}
                {mentionSuggestions.length > 0 && mentionSuggestions[0].kind === "param-user" && (() => {
                  const cmdName = mentionSuggestions[0].commandName;
                  const paramName = mentionSuggestions[0].paramName;
                  const cmdIcon = cmdName ? COMMAND_ICONS[cmdName as keyof typeof COMMAND_ICONS] : null;
                  return (
                    <>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface)]/50 border-b border-[var(--app-border)]/50">
                        {cmdIcon && (
                          <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded bg-[#8B5CF6]/15 text-[#a78bfa]">
                            {cmdIcon}
                          </span>
                        )}
                        <span className="font-mono text-xs text-[#a78bfa]">/{cmdName}</span>
                        <span className="text-[10px] text-[var(--app-muted)]">— {gt("select a member for")}</span>
                        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{paramName}</span>
                      </div>
                      {mentionSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.kind}-${suggestion.id}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            onMentionSelect?.(suggestion);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                            index === activeMentionIndex
                              ? "bg-[var(--app-accent)]/15 text-[var(--text-primary)]"
                              : "hover:bg-[var(--app-surface)]/60 text-[var(--text-primary)]"
                          )}
                        >
                          <span
                            className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-xs font-bold"
                            style={suggestion.color ? { backgroundColor: suggestion.color + "30", color: suggestion.color } : undefined}
                          >
                            {(suggestion.label || "?").charAt(0).toUpperCase()}
                          </span>
                          <span className="flex flex-col min-w-0">
                            <span className="truncate text-sm" style={suggestion.color ? { color: suggestion.color } : undefined}>
                              {suggestion.label}
                            </span>
                            {suggestion.description && (
                              <span className="truncate text-xs text-[var(--app-muted)]">@{suggestion.description}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </>
                  );
                })()}

                {/* Param duration / choice suggestions */}
                {mentionSuggestions.length > 0 && (mentionSuggestions[0].kind === "param-duration" || mentionSuggestions[0].kind === "param-choice") && (() => {
                  const cmdName = mentionSuggestions[0].commandName;
                  const paramName = mentionSuggestions[0].paramName;
                  const isDuration = mentionSuggestions[0].kind === "param-duration";
                  const cmdIcon = cmdName ? COMMAND_ICONS[cmdName as keyof typeof COMMAND_ICONS] : null;
                  return (
                    <>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface)]/50 border-b border-[var(--app-border)]/50">
                        {cmdIcon && (
                          <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded bg-[#8B5CF6]/15 text-[#a78bfa]">
                            {cmdIcon}
                          </span>
                        )}
                        <span className="font-mono text-xs text-[#a78bfa]">/{cmdName}</span>
                        <span className="text-[10px] text-[var(--app-muted)]">— {gt("choose")} {isDuration ? gt("a duration") : gt("an option")} {gt("for")}</span>
                        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{paramName}</span>
                      </div>
                      {mentionSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.kind}-${suggestion.id}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            onMentionSelect?.(suggestion);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                            index === activeMentionIndex
                              ? "bg-[var(--app-accent)]/15 text-[var(--text-primary)]"
                              : "hover:bg-[var(--app-surface)]/60 text-[var(--text-primary)]"
                          )}
                        >
                          <span className="flex items-center gap-2.5 min-w-0 text-sm">
                            {isDuration ? (
                              <Clock className="w-4 h-4 shrink-0 text-[var(--app-muted)]" />
                            ) : (
                              <span className="w-4 h-4 shrink-0 rounded-sm border-2 border-[var(--app-muted)]/40" />
                            )}
                            <span className="truncate">{suggestion.label}</span>
                          </span>
                          {suggestion.description && (
                            <span className="text-xs font-mono text-[var(--app-muted)] truncate shrink-0">
                              {suggestion.description}
                            </span>
                          )}
                        </button>
                      ))}
                    </>
                  );
                })()}

                {/* Regular mention/emoji suggestions (non-command, non-param) */}
                {mentionSuggestions.length > 0 && !mentionSuggestions.some(s => s.kind === "command" || s.kind === "app-command" || s.kind === "app-option" || s.kind === "app-choice" || s.kind === "param-user" || s.kind === "param-duration" || s.kind === "param-choice" || s.kind === "param-hint") && mentionSuggestions.map((suggestion, index) => {
                  return (
                    <button
                      key={`${suggestion.kind}-${suggestion.id}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onMentionSelect?.(suggestion);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                        index === activeMentionIndex
                          ? "bg-[var(--app-accent)]/20 text-[var(--text-primary)]"
                          : "hover:bg-[var(--app-surface)] text-[var(--text-primary)]"
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0 text-sm">
                        {suggestion.kind === "emoji" ? (
                          <>
                            <img src={cdnImage(suggestion.imageUrl)} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />
                            <span className="truncate">:{suggestion.label}:</span>
                          </>
                        ) : suggestion.kind === "unicode-emoji" ? (
                          <>
                            <span className="text-base shrink-0">{suggestion.unicodeChar}</span>
                            <span className="truncate">:{suggestion.label}:</span>
                          </>
                        ) : suggestion.kind === "channel" ? (
                          <span className="truncate flex items-center gap-1 font-medium"><Hash className="w-4 h-4 text-[var(--text-muted)] shrink-0" />{suggestion.label}</span>
                        ) : (
                          <span className="truncate">@{suggestion.label}</span>
                        )}
                      </span>
                      <span className="text-xs text-[var(--app-muted)] truncate shrink-0">
                        {suggestion.kind === "role" ? gt("Role") : suggestion.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Editor row: upload button + composer + right buttons */}
            <div className="relative flex items-center">
              {/* Upload button (left side, pinned to editor row) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors z-10"
                title={gt("Upload file")}
              >
                <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
              </button>
              {attachments.length > 0 && (
                <span className="absolute left-9 sm:left-11 top-1/2 -translate-y-1/2 text-xs text-[var(--app-muted)] z-10">{attachments.length}</span>
              )}

              {/* Composer */}
              <RichComposer
                ref={composerRef}
                onChange={handleComposerChange}
                onCaretMove={onCaretMove}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                aria-label={ariaLabel ?? placeholder}
                disabled={disabled}
              />

              {/* Right-side buttons (pinned to editor row) */}
              <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
              {/* GIF / Image picker button */}
              <button
                type="button"
                onClick={() => {
                  setPickerTab("gifs");
                  setShowEmojiPicker(true);
                }}
                className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
                title={gt("Open GIF picker")}
              >
                <ImagePlay className="w-6 h-6" />
              </button>

              {/* Sticker picker button */}
              {stickerSuggestionsEnabled && (
              <button
                type="button"
                onClick={() => {
                  setPickerTab("stickers");
                  setShowEmojiPicker(true);
                }}
                className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
                title={gt("Open sticker picker")}
              >
                <Sticker className="w-6 h-6" />
              </button>
              )}

              {/* Emoji picker button */}
              {emojiPickerEnabled && (
              <Popover
                open={showEmojiPicker}
                onOpenChange={(open) => {
                  setShowEmojiPicker(open);
                  if (!open) {
                    setPickerTab("emoji");
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => setPickerTab("emoji")}
                  >
                    <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  className="p-0 border-none bg-transparent shadow-xl w-[440px] max-w-[calc(100vw-1rem)]"
                >
                  <CustomEmojiPicker
                    onEmojiSelect={handlePickerEmojiSelect}
                    onGifSelect={handlePickerGifSelect}
                    onStickerSelect={handlePickerStickerSelect}
                    initialTab={pickerTab}
                    serverId={serverId}
                    serverEmojis={serverEmojis}
                    serverName={serverName}
                    availableServerEmojis={availableServerEmojis}
                    availableServerStickers={availableServerStickers}
                  />
                </PopoverContent>
              </Popover>
              )}

              {/* Send button (shows spinner while sending/uploading, but stays clickable) */}
              {(canSend || isSending || isUploading) && (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={isUploading}
                  aria-label={isUploading ? gt("Uploading attachments") : isSending ? gt("Sending") : gt("Send message")}
                  className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors disabled:opacity-70"
                >
                  {isSending || isUploading ? (
                    <Loader size={20} className="sm:w-6 sm:h-6" />
                  ) : (
                    <SendHorizontal className="w-5 sm:w-6 h-5 sm:h-6" />
                  )}
                </button>
              )}
            </div>
            </div>
          </div>
        </div>
      </>
    );
  }
);
