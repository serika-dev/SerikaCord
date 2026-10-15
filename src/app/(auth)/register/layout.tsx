import { buildMetadata } from "@/lib/seo";

// Own canonical URL; the (auth) group layout points at /login.
export const metadata = buildMetadata({
  title: "Create a SerikaCord Account",
  description:
    "Create a free SerikaCord account to join communities, chat with friends, start voice and video calls, and discover new servers.",
  path: "/register",
  keywords: [
    "SerikaCord register",
    "SerikaCord sign up",
    "create account",
    "free chat app",
  ],
});

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
