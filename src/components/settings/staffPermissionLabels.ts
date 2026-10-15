import { useGT } from "gt-next";
import type { StaffPermission } from "@/lib/staff/permissions";

export function useStaffPermissionGroups(): { name: string; permissions: { id: StaffPermission; name: string; description: string }[] }[] {
  const gt = useGT();
  return [
    { name: gt("People and safety"), permissions: [
      { id: "users.view", name: gt("View users"), description: gt("Search accounts and inspect user details.") },
      { id: "users.moderate", name: gt("Moderate users"), description: gt("Suspend and restore ordinary user accounts.") },
      { id: "reports.manage", name: gt("Manage reports"), description: gt("Review, update, and remove bug reports and feedback.") },
      { id: "safety.review", name: gt("Trust & Safety"), description: gt("Review safety incidents and appeals, issue or remove strikes and restrictions, and manage scam image hashes.") },
      { id: "badges.manage", name: gt("Manage badges"), description: gt("Create badges and assign them to users. Only administrators can change privileged badges.") },
      { id: "staff.manage", name: gt("Manage staff roles"), description: gt("Create roles and assign access you already hold to other staff.") },
    ] },
    { name: gt("Publishing"), permissions: [
      { id: "changelog.manage", name: gt("Edit changelogs"), description: gt("Create drafts and edit release notes before publication.") },
      { id: "changelog.publish", name: gt("Publish changelogs"), description: gt("Publish or withdraw release notes shown in the What's new popup.") },
      { id: "broadcast.send", name: gt("Send broadcasts"), description: gt("Send platform announcements to users.") },
      { id: "translations.manage", name: gt("Manage translations"), description: gt("Review and synchronize platform translations.") },
      { id: "tts.manage", name: gt("Manage text to speech"), description: gt("Configure sound triggers and available voices.") },
    ] },
    { name: gt("Platform and operations"), permissions: [
      { id: "servers.view", name: gt("View servers"), description: gt("Search servers and inspect their details.") },
      { id: "servers.manage", name: gt("Manage servers"), description: gt("Change discovery and partnership, transfer ownership, and delete servers.") },
      { id: "settings.manage", name: gt("Manage platform settings"), description: gt("Configure registration, maintenance, global banners, and upload rules.") },
      { id: "experiments.manage", name: gt("Manage experiments"), description: gt("Configure feature flags, experiments, and their audiences.") },
      { id: "instances.manage", name: gt("Manage instances"), description: gt("Approve and revoke connected instances.") },
      { id: "stats.view", name: gt("View statistics"), description: gt("Read platform usage statistics.") },
      { id: "logs.view", name: gt("View audit logs"), description: gt("Inspect the history of staff actions.") },
    ] },
  ];
}
