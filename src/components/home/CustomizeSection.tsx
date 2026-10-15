import { getGT } from "gt-next/server";
import { Check } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { MemberRow, UserPanel } from "./AppPreview";

export async function CustomizeSection() {
  const gt = await getGT();

  return (
    <section id="customize" aria-labelledby="hm-custom-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-10">
        <div>
          <SectionHeading
            id="hm-custom-title"
            label={gt("Customization")}
            title={gt("Make it look like you.")}
            lede={gt("Pick a theme and an accent color, give your name a nameplate, and fill your profile with a banner, a bio and the accounts you've connected.")}
          />
          <ul className="mt-8 flex flex-wrap gap-2" data-reveal>
            {[
              gt("Light, Dark and Midnight themes"),
              gt("Your own accent color"),
              gt("Nameplates"),
              gt("Profile banners and bios"),
              gt("Custom status"),
              gt("What you're playing or listening to"),
            ].map((x) => (
              <li key={x} className="hm-chip">
                <Check className="h-3.5 w-3.5 text-[var(--hm-accent-text)]" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </div>

        {/* The real member list and user panel, showing nameplates (built-in presets). */}
        <div className="mx-auto w-full max-w-[360px]" aria-hidden="true" data-reveal>
          <div className="hm-frame">
            <div className="bg-[var(--app-bg)] py-4">
              <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                {gt("Online")} — 5
              </p>
              <MemberRow name="Aya" nameplate="sakura" />
              <MemberRow name="Theo" nameplate="ocean" roleColor="#3BA55C" activity={{ kind: "game", text: "Minecraft" }} />
              <MemberRow name="Rin" nameplate="aurora" activity={{ kind: "music", text: "Lo-fi Beats — Chillhop" }} />
              <MemberRow name="Mika" nameplate="mint" />
              <MemberRow name="Jun" nameplate="ember" />
            </div>
            <UserPanel name="Sora" nameplate="grape" />
          </div>
        </div>
      </div>
    </section>
  );
}
