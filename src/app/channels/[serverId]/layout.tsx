import type { Metadata } from "next";
import { buildServerMetadata } from "@/lib/seoPreview";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serverId: string }>;
}): Promise<Metadata> {
  const { serverId } = await params;
  return buildServerMetadata(serverId);
}

export default function ServerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
