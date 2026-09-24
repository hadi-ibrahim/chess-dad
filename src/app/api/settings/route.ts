import { NextResponse } from "next/server";
import { getProfileById, getProfileToken, setProfileToken } from "@/lib/db";
import { activeProfileId } from "@/lib/active-profile";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * App-level settings plus the acting profile's identity.
 *
 * The token is only ever reported as a boolean — `lichessTokenSet` — so a stored
 * secret cannot leak through this endpoint.
 */
export async function GET(request: Request) {
  const profileId = activeProfileId(request);
  const profile = profileId == null ? null : getProfileById(profileId);
  const stored = profileId == null ? "" : getProfileToken(profileId);
  return NextResponse.json({
    lichessTokenSet: Boolean(stored || config.lichessToken),
    llmProvider: config.llmProvider,
    profile,
    activeProfileId: profileId,
  });
}

export async function DELETE(request: Request) {
  const profileId = activeProfileId(request);
  if (profileId != null) setProfileToken(profileId, "");
  return NextResponse.json({ lichessTokenSet: Boolean(config.lichessToken) });
}
