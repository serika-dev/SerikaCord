"use client";

import { useGT } from "gt-next";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { ServerTagSelect } from "@/components/user/profileEditor/ServerTagSelect";

/**
 * "Server tag" section of the profile settings (CORD-53): a dropdown of your
 * servers that have a tag turned on (or none), shown next to your name.
 */
export function ServerTagPicker() {
  const gt = useGT();
  return (
    <SettingsSection
      title={gt("Server Tag")}
      description={gt("Show a tag from one of your servers next to your name. It disappears if you leave that server.")}
    >
      <ServerTagSelect variant="field" />
    </SettingsSection>
  );
}
