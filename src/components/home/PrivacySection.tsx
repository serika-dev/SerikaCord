import Link from "next/link";
import { getGT } from "gt-next/server";
import { Check } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { DmPreview, PinDialogPreview } from "./AppPreview";

export async function PrivacySection() {
  const gt = await getGT();

  const points = [
    gt("New DMs and group DMs are end-to-end encrypted by default. Only the people in them can read them, not even us."),
    gt("Voice and video calls in those DMs are end-to-end encrypted too."),
    gt("Set a 6-digit PIN once to read your encrypted messages on a new device, or link it by scanning a QR code."),
    gt("No ads and no advertising trackers. We don't sell your data or use your private messages to train AI."),
    gt("Run by Serika Company in the Netherlands, under the EU's GDPR."),
  ];

  return (
    <section id="privacy" aria-labelledby="hm-privacy-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="relative overflow-hidden rounded-[24px] border border-[var(--hm-line)] bg-[var(--hm-surface)] px-5 py-10 sm:px-10 sm:py-14 lg:px-14">
          <div className="relative grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <SectionHeading
                id="hm-privacy-title"
                label={gt("Privacy")}
                title={
                  <>
                    {gt("Your server is for everyone you invite.")}{" "}
                    <span className="hm-accent">{gt("Your DMs are just for you.")}</span>
                  </>
                }
              />
              <ul className="mt-8 flex flex-col gap-4" data-reveal>
                {points.map((p) => (
                  <li key={p} className="flex gap-3 leading-relaxed">
                    <span className="hm-check mt-0.5" aria-hidden>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[var(--hm-ink)]">{p}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-8 max-w-xl border-s-2 border-[var(--hm-line)] ps-4 text-sm leading-relaxed text-[var(--hm-faint)]" data-reveal>
                {gt("Messages in server channels are encrypted at rest on our servers, but not end to end, so bots, search and moderation keep working there.")}{" "}
                <Link href="/privacy" className="hm-link">
                  {gt("Read our privacy policy")}
                </Link>
              </p>
            </div>

            {/* The real DM header + encryption popover, and the PIN unlock dialog */}
            <div className="relative mx-auto flex w-full max-w-[460px] flex-col gap-4" data-reveal>
              <DmPreview />
              <div className="mx-auto w-full max-w-[400px]">
                <PinDialogPreview />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
