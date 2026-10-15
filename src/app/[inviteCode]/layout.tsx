import type { Metadata } from "next";
import { buildInviteMetadata } from "@/lib/seoPreview";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  return buildInviteMetadata(inviteCode);
}

export default function InviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
