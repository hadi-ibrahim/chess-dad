import { NextResponse } from "next/server";
import { computeWeaknesses } from "@/lib/weaknesses";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(computeWeaknesses());
}
