import { buildMetadata } from "@/lib/seo";

// App-only route: never indexed.
export const metadata = buildMetadata({
  title: "QR Login",
  path: "/qr/scan",
  noIndex: true,
});

export default function NoIndexLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
