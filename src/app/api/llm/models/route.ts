import { NextResponse } from "next/server";
import { listProviderModels } from "@/lib/llm-models";
import { sanitizeConnection } from "@/lib/llm-providers";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";
/** A provider catalogue is one request; this is generous for a slow one. */
export const maxDuration = 60;

/**
 * List the models a caller's provider key can reach, for the Profiles picker.
 *
 * Deliberately mirrors `POST /api/games/[id]/ai`: the connection travels in the
 * body, the key is used only for this request's outbound call, and nothing about
 * it is written down. The base URL goes through the same validation, so this
 * cannot be used to probe a host the AI route would refuse either.
 */
export async function POST(request: Request) {
  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab first." },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { connection?: unknown };
  const checked = sanitizeConnection(body.connection);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  try {
    const models = await listProviderModels(checked.connection);
    return NextResponse.json({ provider: checked.connection.provider, models });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
