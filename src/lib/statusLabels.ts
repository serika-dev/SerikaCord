type GTFunc = (key: string, vars?: Record<string, unknown>) => string;

export function statusLabel(status: string, gt: GTFunc): string {
  switch (status) {
    case "online": return gt("Online");
    case "idle": return gt("Idle");
    case "dnd": return gt("Do Not Disturb");
    case "offline": return gt("Offline");
    default: return status;
  }
}

export function statusLabelInvisible(status: string, gt: GTFunc): string {
  switch (status) {
    case "online": return gt("Online");
    case "idle": return gt("Idle");
    case "dnd": return gt("Do Not Disturb");
    case "offline": return gt("Invisible");
    default: return status;
  }
}
