import { redirect } from "next/navigation";

// Legacy route: DMs live at /dm/[recipientId]. This older duplicate DM page
// drifted out of sync with the real one, so it now just forwards.
export default async function LegacyDmRedirect({
  params,
}: {
  params: Promise<{ recipientId: string }>;
}) {
  const { recipientId } = await params;
  redirect(`/dm/${recipientId}`);
}
