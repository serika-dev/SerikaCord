import { getGT } from "gt-next/server";
import { Check } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { MemberRow, UserPanel } from "./AppPreview";

export async function CustomizeSection() {
  const gt = await getGT();

  return (
    <section id="customize" aria-labelledby="hm-custom-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-6 px-4 sm:gap-12 sm:px-6 lg:grid-cols-2 lg:px-10">
        <div>
          <SectionHeading
            id="hm-custom-title"
            label={gt("Customization")}
            title={gt("Make it look like you.")}
            lede={gt("Pick a theme and an accent color, give your name a nameplate, and fill your profile with a banner, a bio and the accounts you've connected.")}
          />
          <ul className="mt-5 flex flex-wrap gap-1.5 sm:mt-8 sm:gap-2" data-reveal>
            {[
              gt("Light, Dark and Midnight themes"),
              gt("Your own accent color"),
              gt("Nameplates"),
              gt("Profile banners and bios"),
              gt("Custom status"),
              gt("What you're playing or listening to"),
            ].map((x) => (
              <li key={x} className="hm-chip !px-3 !py-1.5 !text-[13px] sm:!px-[0.85rem] sm:!py-[0.4rem] sm:!text-[0.86rem]">
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
              {/* Phones show the first three members. */}
              <div className="hidden sm:block">
                <MemberRow name="Mika" nameplate="mint" />
                <MemberRow name="Jun" nameplate="ember" />
              </div>
            </div>
            <UserPanel name="Sora" nameplate="grape" />
          </div>
        </div>
      </div>
    </section>
  );
}
