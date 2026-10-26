import { ChatAreaSkeleton } from "@/components/ui/skeleton";

// Shown the instant a conversation is clicked, while the route loads: Next
// renders it from the router cache instead of keeping the old page on screen.
export default function Loading() {
  return <ChatAreaSkeleton />;
}
