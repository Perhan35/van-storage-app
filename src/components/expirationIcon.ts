import { ExpirationStatus } from "../utils/expiration";
import { Palette } from "../theme/palette";

export function expirationIconName(status: ExpirationStatus): string {
  return status === "ok" ? "calendar" : "calendar-alert";
}

export function expirationIconColor(status: ExpirationStatus, palette: Palette): string {
  if (status === "expired") return palette.danger;
  if (status === "soon") return palette.warningOn;
  return palette.onSurfaceVariant;
}
