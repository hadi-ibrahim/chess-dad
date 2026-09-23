import { NextResponse } from "next/server";
import { readOkfDoc, listOkfDir } from "@/lib/okf";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const docPath = url.searchParams.get("path");

  if (docPath) {
    const doc = readOkfDoc(docPath);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    return NextResponse.json({
      path: doc.path,
      title: doc.frontmatter.title ?? doc.path,
      body: doc.body,
    });
  }

  const index = readOkfDoc("index.md");
  return NextResponse.json({
    index: index ? { title: index.frontmatter.title ?? "Chess Dad Knowledge", body: index.body } : null,
    concepts: listOkfDir("concepts"),
    entities: listOkfDir("entities"),
  });
}
