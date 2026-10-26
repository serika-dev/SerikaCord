"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useGT } from "gt-next";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { SettingsCard, SettingsPageHeader, SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsRadioCards } from "@/components/settings/blocks/SettingsRadioCards";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { DeviceSelect, InputSensitivity } from "@/components/settings/VoiceDeviceSettings";
import { deviceConstraint, getPreferredDevice } from "@/lib/voice/devices";
import { DEFAULT_SENSITIVITY_DB } from "@/lib/voice/voiceActivity";
import type { SaveSettingsPatch, SaveSettingsPatchDebounced, UserSettingsValue } from "@/components/settings/user/types";

/** Label + live value over a full-width range input (Discord's volume sliders). */
function SliderField({
  label,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{label}</span>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full cursor-pointer accent-[var(--app-accent)]"
      />
    </div>
  );
}

/**
 * Discord's Voice & Video: input/output devices and volumes side by side, the
 * mic test meter, input mode, then video and grouped advanced processing.
 */
export const VoiceVideoPage = memo(function VoiceVideoPage({
  userSettings,
  saveSettingsPatch,
  saveSettingsPatchDebounced,
}: {
  userSettings: UserSettingsValue;
  saveSettingsPatch: SaveSettingsPatch;
  saveSettingsPatchDebounced: SaveSettingsPatchDebounced;
}) {
  const gt = useGT();
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startVideoPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: 640, height: 360, ...deviceConstraint(getPreferredDevice("video")) },
      });
      streamRef.current = stream;
      setVideoStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast.error(gt("Camera access denied"));
    }
  };

  const stopVideoPreview = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVideoStream(null);
  };

  // Attach the stream once the <video> exists, and stop the camera on unmount.
  useEffect(() => {
    if (videoRef.current && videoStream) videoRef.current.srcObject = videoStream;
  }, [videoStream]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const vv = userSettings?.voiceVideo || {};
  const a11y = userSettings?.accessibility || {};
  const saveVoice = (patch: Record<string, unknown>) => saveSettingsPatch({ voiceVideo: { ...vv, ...patch } }, "voice-video");
  const saveA11y = (patch: Record<string, unknown>) => saveSettingsPatch({ accessibility: { ...a11y, ...patch } }, "voice-video");

  return (
    <div className="space-y-10">
      <SettingsPageHeader title={gt("Voice & Video")} description={gt("Pick your microphone, speakers and camera, and tune how you sound.")} />

      {!userSettings ? (
        <SettingsSkeleton variant="rows" count={5} />
      ) : (
        <>
          {/* Devices + volumes, side by side on wide screens */}
          <SettingsSection title={gt("Voice Settings")}>
            <div className="grid gap-x-6 gap-y-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 sm:grid-cols-2">
              <DeviceSelect role="input" label={gt("Input Device")} />
              <DeviceSelect role="output" label={gt("Output Device")} />
              <SliderField
                label={gt("Input Volume")}
                value={vv.inputVolume ?? 100}
                suffix={`${vv.inputVolume ?? 100}%`}
                min={0}
                max={200}
                onChange={(v) => saveSettingsPatchDebounced({ voiceVideo: { inputVolume: v } }, "voice-video")}
              />
              <SliderField
                label={gt("Output Volume")}
                value={vv.outputVolume ?? 100}
                suffix={`${vv.outputVolume ?? 100}%`}
                min={0}
                max={200}
                onChange={(v) => saveSettingsPatchDebounced({ voiceVideo: { outputVolume: v } }, "voice-video")}
              />
            </div>
          </SettingsSection>

          {/* Mic test + input sensitivity */}
          <SettingsSection title={gt("Mic Test")} description={gt("Having mic issues? Start a test and say something fun. We'll play your voice back to you.")}>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
              <InputSensitivity
                auto={vv.autoSensitivity !== false}
                thresholdDb={typeof vv.inputSensitivity === "number" ? vv.inputSensitivity : DEFAULT_SENSITIVITY_DB}
                pushToTalk={Boolean(vv.pushToTalk)}
                echoCancellation={vv.echoCancellation !== false}
                noiseSuppression={vv.noiseSuppression !== false}
                autoGainControl={vv.autoGainControl !== false}
                onAutoChange={(checked) => saveVoice({ autoSensitivity: checked })}
                onThresholdChange={(db) => saveSettingsPatchDebounced({ voiceVideo: { inputSensitivity: db } }, "voice-video")}
              />
            </div>
          </SettingsSection>

          {/* Input mode */}
          <SettingsSection title={gt("Input Mode")}>
            <SettingsRadioCards
              ariaLabel={gt("Input Mode")}
              value={vv.pushToTalk ? "ptt" : "voice"}
              onChange={(mode) => saveVoice({ pushToTalk: mode === "ptt" })}
              options={[
                { value: "voice", label: gt("Voice Activity") },
                { value: "ptt", label: gt("Push to Talk"), description: gt("Hold a key to transmit voice") },
              ]}
            />
            {vv.pushToTalk && (
              <SettingsCard>
                <SettingsRow
                  label={gt("Push to Talk Key")}
                  control={
                    <input
                      type="text"
                      value={vv.pushToTalkKey || "V"}
                      onChange={(e) => saveVoice({ pushToTalkKey: e.target.value.toUpperCase().slice(0, 1) })}
                      aria-label={gt("Push to Talk Key")}
                      className="h-9 w-14 rounded-md border border-b-2 border-[var(--border-strong)] bg-[var(--bg-input)] text-center font-mono text-base font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]"
                      maxLength={1}
                    />
                  }
                />
              </SettingsCard>
            )}
          </SettingsSection>

          <SettingsSection title={gt("Soundboard")}>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
              <SliderField
                label={gt("Soundboard Volume")}
                value={vv.soundboardVolume ?? 100}
                suffix={`${vv.soundboardVolume ?? 100}%`}
                min={0}
                max={200}
                onChange={(v) => saveSettingsPatchDebounced({ voiceVideo: { soundboardVolume: v } }, "voice-video")}
              />
            </div>
          </SettingsSection>

          {/* Video */}
          <SettingsSection title={gt("Video Settings")}>
            <div className="grid gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]">
                {videoStream ? (
                  <video ref={videoRef} autoPlay playsInline muted className="video-mirror h-full w-full object-cover" />
                ) : (
                  <Video className="h-10 w-10 text-[var(--text-muted)]" aria-hidden />
                )}
              </div>
              <div className="flex flex-col justify-between gap-4">
                <DeviceSelect role="video" label={gt("Camera")} />
                <div>
                  <SettingsButton
                    variant={videoStream ? "danger" : "primary"}
                    size="sm"
                    onClick={videoStream ? stopVideoPreview : () => void startVideoPreview()}
                  >
                    {videoStream ? gt("Stop Preview") : gt("Start Preview")}
                  </SettingsButton>
                </div>
              </div>
            </div>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Stream Preview")}
                checked={Boolean(vv.streamPreview)}
                onCheckedChange={(checked) => saveVoice({ streamPreview: checked })}
              />
            </SettingsCard>
          </SettingsSection>

          {/* Advanced: voice processing */}
          <SettingsSection title={gt("Voice Processing")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Echo Cancellation")}
                description={gt("Prevent echo from speakers into your microphone")}
                checked={Boolean(vv.echoCancellation)}
                onCheckedChange={(checked) => saveVoice({ echoCancellation: checked })}
              />
              <SettingsToggleRow
                label={gt("Noise Suppression")}
                description={gt("Reduce background noise from your microphone")}
                checked={Boolean(vv.noiseSuppression)}
                onCheckedChange={(checked) => saveVoice({ noiseSuppression: checked })}
              />
              <SettingsToggleRow
                label={gt("Automatic Gain Control")}
                description={gt("Automatically adjust microphone volume")}
                checked={Boolean(vv.autoGainControl)}
                onCheckedChange={(checked) => saveVoice({ autoGainControl: checked })}
              />
            </SettingsCard>
          </SettingsSection>

          {/* Text-to-Speech */}
          <SettingsSection title={gt("Text-to-Speech")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Text-to-Speech")}
                description={gt("Read incoming messages aloud")}
                checked={Boolean(a11y.tts)}
                onCheckedChange={(checked) => saveA11y({ tts: checked })}
              />
              <SettingsToggleRow
                label={gt("Play text-to-speech from others")}
                description={gt("Read /tts messages other people send aloud")}
                checked={a11y.ttsFromOthers !== false}
                onCheckedChange={(checked) => saveA11y({ ttsFromOthers: checked })}
              />
              <SettingsToggleRow
                label={gt("TTS sound effects")}
                description={gt("Play sound triggers and loud effects like [vol:EAR] and [vol:BASS]. When off, trigger words are spoken and volume is capped at 100%.")}
                checked={a11y.ttsSoundEffects !== false}
                onCheckedChange={(checked) => saveA11y({ ttsSoundEffects: checked })}
              />
            </SettingsCard>

            {/* Usage guide */}
            <div className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("TTS Usage Guide")}</p>
              <p className="text-[13px] text-[var(--text-secondary)]">
                {gt("Type")} <code className="rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[var(--text-primary)]">/tts</code> {gt("before your message to send it as speech.")}
              </p>
              <p className="pl-3 text-[13px] text-[var(--text-primary)]">
                <code className="rounded bg-[var(--bg-hover)] px-1 py-0.5">/tts [f] Hello</code> — {gt("female voice")}
              </p>
              <p className="pl-3 text-[13px] text-[var(--text-primary)]">
                <code className="rounded bg-[var(--bg-hover)] px-1 py-0.5">/tts [m] Hello</code> — {gt("male voice")}
              </p>
              <p className="text-[13px] text-[var(--text-secondary)]">
                {gt("Keywords:")} <span className="text-[var(--text-primary)]">[f]</span>, <span className="text-[var(--text-primary)]">[female]</span>, <span className="text-[var(--text-primary)]">[girl]</span> {gt("for female")} &middot; <span className="text-[var(--text-primary)]">[m]</span>, <span className="text-[var(--text-primary)]">[male]</span>, <span className="text-[var(--text-primary)]">[boy]</span> {gt("for male")}
              </p>
              <p className="text-[13px] text-[var(--text-muted)]">{gt("Voices are English-only. Set a default below or override per message.")}</p>
            </div>
            <SettingsCard>
              <SettingsRow
                label={gt("Reading speed")}
                control={<span className="text-xs tabular-nums text-[var(--text-muted)]">{(a11y.ttsRate ?? 1).toFixed(1)}×</span>}
              >
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={a11y.ttsRate ?? 1}
                  onChange={(e) => saveSettingsPatchDebounced({ accessibility: { ttsRate: parseFloat(e.target.value) } }, "voice-video")}
                  aria-label={gt("Reading speed")}
                  className="w-full cursor-pointer accent-[var(--app-accent)]"
                />
              </SettingsRow>
              <SettingsRow
                label={gt("Voice")}
                control={
                  <select
                    aria-label={gt("Voice")}
                    value={a11y.ttsVoice ?? "auto"}
                    onChange={(e) => saveA11y({ ttsVoice: e.target.value })}
                    className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]"
                  >
                    <option value="auto">{gt("Automatic")}</option>
                    <option value="female">{gt("Female")}</option>
                    <option value="male">{gt("Male")}</option>
                  </select>
                }
              />
            </SettingsCard>

          </SettingsSection>
        </>
      )}
    </div>
  );
});
