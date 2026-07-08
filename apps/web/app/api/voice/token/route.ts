import { NextResponse } from "next/server";

import { authenticateSyncRequest } from "@/lib/sync-auth";
import { twilioConfig, voiceAccessToken } from "@/lib/twilio";

/**
 * Voice access token for the mobile app's outbound phone calls. The token's
 * identity is the DoodleNote user id, so Twilio's own call logs attribute
 * minutes per user (the metering source for the calling add-on).
 */
export async function GET(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  const config = twilioConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Phone calls are not enabled on this server yet" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    token: voiceAccessToken(config, device.userId),
    identity: device.userId,
  });
}
