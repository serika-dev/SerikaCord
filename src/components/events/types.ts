import type { EventEntityType, EventStatus } from "@/lib/chat/scheduledEvents";

/** Client copy of ScheduledEventView (lib/services/scheduledEvents.ts). */
export interface ServerEventView {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  entityType: EventEntityType;
  channelId: string | null;
  channelName: string | null;
  location: string | null;
  image: string | null;
  status: EventStatus;
  startAt: string;
  endAt: string | null;
  creatorId: string;
  creator: { id: string; username: string; displayName: string | null; avatar: string | null } | null;
  userCount: number;
  interested: boolean;
}

export interface EventUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}
