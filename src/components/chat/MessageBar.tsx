"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PlusCircle,
  ImageIcon,
  Sticker,
  Smile,
  SendHorizontal,
  Loader2,
  X,
  FileText,
  Reply,
  Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CustomEmojiPicker } from "@/components/chat/CustomEmojiPicker";
import { RichComposer, type RichComposerHandle, type ComposerEmoji } from "@/components/chat/RichComposer";

export interface MessageBarAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size?: number;
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
  kind: "user" | "role" | "everyone" | "here" | "emoji";
  label: string;
  description?: string;
  color?: string;
  imageUrl?: string;
  animated?: boolean;
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
    },
    ref
  ) {
    const composerRef = useRef<RichComposerHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [attachments, setAttachments] = useState<File[]>([]);
    const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [pickerTab, setPickerTab] = useState<"emoji" | "gifs" | "stickers">("emoji");
    const [hasText, setHasText] = useState(false);

    // ---- File upload ----
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const maxFree = 100 * 1024 * 1024; // 100MB
      const maxPremium = 500 * 1024 * 1024; // 500MB

      const validFiles: File[] = [];
      for (const file of files) {
        if (file.size > maxPremium) {
          toast.error(`${file.name} is too large`, { description: `Maximum is 500MB (Serika+). File is ${(file.size / 1024 / 1024).toFixed(1)}MB.` });
          continue;
        }
        if (file.size > maxFree) {
          toast.error(`${file.name} exceeds 100MB`, { description: "Upgrade to Serika+ for up to 500MB uploads." });
          continue;
        }
        validFiles.push(file);
      }

      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const newFiles = validFiles.slice(0, 10 - attachments.length);
      setAttachments((prev) => [...prev, ...newFiles]);

      newFiles.forEach((file) => {
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachmentPreviews((prev) => [...prev, reader.result as string]);
          };
          reader.readAsDataURL(file);
        } else if (file.type.startsWith("video/")) {
          const url = URL.createObjectURL(file);
          setAttachmentPreviews((prev) => [...prev, url]);
        } else {
          setAttachmentPreviews((prev) => [...prev, ""]);
        }
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }, [attachments.length]);

    const removeAttachment = useCallback((index: number) => {
      const preview = attachmentPreviews[index];
      if (preview && preview.startsWith("blob:")) {
        URL.revokeObjectURL(preview);
      }
      setAttachments((prev) => prev.filter((_, i) => i !== index));
      setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
    }, [attachmentPreviews]);

    // ---- Upload attachments to server ----
    const uploadAttachments = useCallback(async (): Promise<MessageBarAttachment[]> => {
      const uploaded: MessageBarAttachment[] = [];
      for (const file of attachments) {
        const formData = new FormData();
        formData.append("file", file);
        if (channelId) {
          formData.append("channelId", channelId);
        }
        try {
          const response = await fetch(uploadEndpoint, {
            method: "POST",
            body: formData,
          });
          if (response.ok) {
            const data = await response.json();
            uploaded.push(data.attachment);
          } else {
            const data = await response.json().catch(() => null);
            const errorMsg = data?.error || `Failed to upload ${file.name}`;
            toast.error(errorMsg, { description: file.name });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Network error";
          toast.error(`Failed to upload ${file.name}`, { description: msg });
        }
      }
      return uploaded;
    }, [attachments, channelId, uploadEndpoint]);

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
      },
      getComposer: () => composerRef.current,
      focus: () => composerRef.current?.focus(),
      uploadAttachments: () => uploadRef.current(),
    }), [attachments]);

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

    const canSend = (hasText || attachments.length > 0) && !isSending && !isUploading;

    return (
      <>
        {/* Hidden file input — outside the visual container to prevent event interference */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          accept="*/*"
          style={{ display: "none" }}
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="px-2 sm:px-4 pb-2">
            <div className="flex flex-wrap gap-2 p-2 bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)]">
              {attachments.map((file, index) => (
                <div key={index} className="relative group">
                  {file.type.startsWith("image/") && attachmentPreviews[index] ? (
                    <img src={attachmentPreviews[index]} alt={file.name} className="w-20 h-20 object-cover rounded-md" />
                  ) : file.type.startsWith("video/") && attachmentPreviews[index] ? (
                    <div className="relative w-20 h-20 rounded-md overflow-hidden bg-black">
                      <video src={attachmentPreviews[index]} className="w-full h-full object-cover" preload="metadata" muted />
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
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Input */}
        <div className="px-2 sm:px-4 pb-2 sm:pb-3 flex-shrink-0">
          {/* Reply preview */}
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-lg flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <Reply className="w-4 h-4 text-[var(--app-muted)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--app-muted)] mb-0.5">
                    Replying to {replyTo.author?.displayName || replyTo.author?.username || "message"}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] truncate">{replyTo.content || "(attachment)"}</p>
                </div>
              </div>
              {onCancelReply && (
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                  title="Cancel reply"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div className="bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)] overflow-hidden">
            {/* Mention suggestions overlay */}
            {mentionSuggestions.length > 0 && (
              <div className="absolute left-2 right-2 bottom-[calc(100%+8px)] z-20 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden">
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
                        ? "bg-[var(--app-accent)]/20 text-[var(--text-primary)]"
                        : "hover:bg-[var(--app-surface)] text-[var(--text-primary)]"
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0 text-sm">
                      {suggestion.kind === "emoji" ? (
                        <>
                          <img src={suggestion.imageUrl} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />
                          <span className="truncate">:{suggestion.label}:</span>
                        </>
                      ) : (
                        <span className="truncate">@{suggestion.label}</span>
                      )}
                    </span>
                    <span className="text-xs text-[var(--app-muted)] truncate">
                      {suggestion.kind === "role" ? "Role" : suggestion.description}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Editor row: upload button + composer + right buttons */}
            <div className="relative flex items-center">
              {/* Upload button (left side, pinned to editor row) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors z-10"
                title="Upload file"
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
                disabled={disabled || isSending}
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
                title="Open GIF picker"
              >
                <ImageIcon className="w-6 h-6" />
              </button>

              {/* Sticker picker button */}
              <button
                type="button"
                onClick={() => {
                  setPickerTab("stickers");
                  setShowEmojiPicker(true);
                }}
                className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
                title="Open sticker picker"
              >
                <Sticker className="w-6 h-6" />
              </button>

              {/* Emoji picker button */}
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

              {/* Send button */}
              {canSend && (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={isSending || isUploading}
                  className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors disabled:opacity-50"
                >
                  {isSending || isUploading ? (
                    <Loader2 className="w-5 sm:w-6 h-5 sm:h-6 animate-spin" />
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
