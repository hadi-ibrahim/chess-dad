/**
 * The OKF reader and its path-containment guard.
 *
 * `readOkfDoc` takes a path and reads it from disk. Nothing passes a
 * user-controlled path today, but the guard is what keeps a future caller from
 * turning it into arbitrary file read — so it is tested hard: traversal, absolute
 * paths, non-markdown files, and a real file *outside* the bundle that an escape
 * would actually reach. `readCoachingRules` is tested against both the shipped
 * bundle and synthetic documents, to exercise the heading-fallback and drill join.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOkfDoc, readCoachingRules } from "@/lib/okf";
import { config } from "@/lib/config";

/** Create a temporary directory tree and run `fn` with `config.okfDir` pointed at it. */
function withBundle<T>(files: Record<string, string>, fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chessdad-okf-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  const saved = config.okfDir;
  config.okfDir = dir;
  try {
    return fn();
  } finally {
    config.okfDir = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("readOkfDoc (shipped bundle)", () => {
  test("reads a legitimate concept with its frontmatter parsed out", () => {
    const doc = readOkfDoc("concepts/coaching-rules.md");
    assert.ok(doc, "the shipped coaching-rules concept should exist");
    assert.equal(doc.path, "concepts/coaching-rules.md");
    assert.equal(doc.frontmatter.type, "Playbook");
    assert.equal(doc.frontmatter.title, "Coaching Rules");
    assert.equal(doc.frontmatter.status, "stable");
    // The body excludes the frontmatter block.
    assert.ok(doc.body.includes("# Overview"), "body should contain the document body");
    assert.ok(!doc.body.includes("status: stable"), "frontmatter should not leak into the body");
  });

  test("normalises `.` segments but still resolves inside the bundle", () => {
    const doc = readOkfDoc("concepts/./coaching-rules.md");
    assert.ok(doc);
    assert.equal(doc.path, "concepts/./coaching-rules.md"); // the path is echoed verbatim
  });

  test("a missing markdown file is null", () => {
    assert.equal(readOkfDoc("concepts/does-not-exist.md"), null);
    assert.equal(readOkfDoc("nope.md"), null);
  });

  test("directories and non-markdown paths are null", () => {
    assert.equal(readOkfDoc("concepts"), null);
    assert.equal(readOkfDoc("index.txt"), null);
    assert.equal(readOkfDoc("concepts/coaching-rules"), null); // no extension
    assert.equal(readOkfDoc("log.md.bak"), null);
    assert.equal(readOkfDoc(""), null);
    assert.equal(readOkfDoc("."), null);
  });
});

describe("readOkfDoc path-containment guard", () => {
  const traversals = [
    "../../../../etc/passwd",
    "../../etc/passwd",
    "../etc/passwd",
    "../secret.md",
    "concepts/../../../../etc/passwd",
    "concepts/../../etc/passwd",
    "concepts/../../../etc/passwd.md",
    "..%2f..%2fetc%2fpasswd.md",
    "....//....//etc/passwd.md",
  ];

  for (const p of traversals) {
    test(`refuses to escape the bundle: ${JSON.stringify(p)}`, () => {
      assert.equal(readOkfDoc(p), null);
    });
  }

  test("refuses absolute paths", () => {
    assert.equal(readOkfDoc("/etc/passwd"), null);
    assert.equal(readOkfDoc("/etc/passwd.md"), null);
    assert.equal(readOkfDoc("/tmp/definitely-not-a-real-file.md"), null);
  });

  test("refuses a path that only shares the bundle's prefix", () => {
    // `okf-evil/` starts with the string "okf" but is not inside it.
    assert.equal(readOkfDoc("../okf-evil/secret.md"), null);
  });

  test("blocks a real, existing file just outside the bundle", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "chessdad-okf-outer-"));
    try {
      fs.mkdirSync(path.join(outer, "okf"));
      fs.writeFileSync(path.join(outer, "okf", "inside.md"), "inside", "utf8");
      fs.writeFileSync(path.join(outer, "secret.md"), "TOP SECRET", "utf8");
      const secretAbs = path.join(outer, "secret.md");

      const saved = config.okfDir;
      config.okfDir = path.join(outer, "okf");
      try {
        // Sanity: the bundle itself is readable…
        assert.equal(readOkfDoc("inside.md")?.body, "inside");
        // …but the sibling that really exists is not reachable.
        assert.equal(readOkfDoc("../secret.md"), null);
        assert.equal(readOkfDoc(secretAbs), null);
        assert.equal(readOkfDoc("../../" + path.basename(outer) + "/secret.md"), null);
      } finally {
        config.okfDir = saved;
      }
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe("readOkfDoc frontmatter parsing (synthetic bundle)", () => {
  test("a document with no frontmatter has an empty map and the raw body", () => {
    withBundle({ "plain.md": "# Title\n\nJust a body.\n" }, () => {
      const doc = readOkfDoc("plain.md")!;
      assert.deepEqual(doc.frontmatter, {});
      assert.equal(doc.body, "# Title\n\nJust a body.\n");
    });
  });

  test("simple keys are trimmed; indented continuation lines are ignored", () => {
    const raw = [
      "---",
      "title:   Hello world  ",
      "tags: [a, b]",
      "nested:",
      "  child: x",
      "---",
      "Body text",
    ].join("\n");
    withBundle({ "fm.md": raw }, () => {
      const doc = readOkfDoc("fm.md")!;
      assert.equal(doc.frontmatter.title, "Hello world");
      assert.equal(doc.frontmatter.tags, "[a, b]");
      assert.equal(doc.frontmatter.nested, "");
      assert.equal(doc.frontmatter.child, undefined);
      assert.equal(doc.body, "Body text");
    });
  });
});

describe("readCoachingRules (shipped bundle)", () => {
  test("returns a lesson for every classification the fallback knows", () => {
    const rules = readCoachingRules();
    for (const cls of ["blunder", "mistake", "miss", "inaccuracy", "good"]) {
      assert.ok(rules[cls], `missing coaching rule for ${cls}`);
      assert.ok(rules[cls].lesson.trim().length > 0, `${cls} lesson is empty`);
    }
  });

  test("the lessons are the real text, not the heading", () => {
    const rules = readCoachingRules();
    assert.match(rules.blunder.lesson, /decisive amount of material/);
    assert.match(rules.miss.lesson, /winning chance/);
    assert.match(rules.good.lesson, /close to best/);
  });

  // The drill half of readCoachingRules used to never fire against the shipped
  // bundle: it looked for a `## Drill` section, or `## How to train`, but
  // tactical-motifs.md uses a level-1 heading (`# How to train`) and sectionUnder()
  // matched only `## `. Every rule's `drill` was therefore "" and llm.ts always
  // fell back to its motif-based text, silently ignoring the knowledge base.
  // sectionUnder() is now heading-level agnostic.
  test("drills come from the tactical-motifs document", () => {
    assert.match(readCoachingRules().blunder.drill, /Solve themed puzzle sets/);
  });

  test("no extracted section leaks a footnote definition into the coach", () => {
    for (const [cls, rule] of Object.entries(readCoachingRules())) {
      assert.ok(!rule.lesson.includes("[^"), `${cls} lesson leaked a footnote`);
      assert.ok(!rule.drill.includes("[^"), `${cls} drill leaked a footnote`);
    }
  });
});

describe("readCoachingRules (synthetic bundle)", () => {
  const coaching = [
    "---",
    "type: Playbook",
    "---",
    "# Overview",
    "",
    "## Move classification: blunder",
    "Blunder lesson body.",
    "",
    "## mistake",
    "Mistake fallback body.",
    "",
    "## Move classification: good   ",
    "Good lesson body.",
  ].join("\n");

  test("prefers the long heading, falls back to the bare classification, and ignores absent ones", () => {
    withBundle({ "concepts/coaching-rules.md": coaching }, () => {
      const rules = readCoachingRules();
      assert.deepEqual(Object.keys(rules).sort(), ["blunder", "good", "mistake"]);
      assert.equal(rules.blunder.lesson, "Blunder lesson body.");
      assert.equal(rules.mistake.lesson, "Mistake fallback body.");
      assert.equal(rules.good.lesson, "Good lesson body."); // heading had trailing spaces
      assert.equal(rules.blunder.drill, ""); // no tactical-motifs doc
    });
  });

  test("pulls a shared drill from a `## Drill` section", () => {
    withBundle(
      {
        "concepts/coaching-rules.md": coaching,
        "concepts/tactical-motifs.md": "# Tactics\n\n## Drill\nDrill body.\n",
      },
      () => {
        const rules = readCoachingRules();
        assert.equal(rules.blunder.drill, "Drill body.");
        assert.equal(rules.mistake.drill, "Drill body.");
        assert.equal(rules.good.drill, "Drill body.");
      }
    );
  });

  test("falls back to a `## How to train` section when there is no `## Drill`", () => {
    withBundle(
      {
        "concepts/coaching-rules.md": coaching,
        "concepts/tactical-motifs.md": "# Tactics\n\n## How to train\nTrain this way.\n",
      },
      () => {
        assert.equal(readCoachingRules().blunder.drill, "Train this way.");
      }
    );
  });

  test("an empty section is not offered as a lesson", () => {
    const withEmpty = [
      "---",
      "---",
      "## blunder",
      "",
      "## missed-thing",
      "Something else.",
    ].join("\n");
    withBundle({ "concepts/coaching-rules.md": withEmpty }, () => {
      // `## blunder` exists but has no body before the next `##`, so it is dropped.
      assert.deepEqual(readCoachingRules(), {});
    });
  });

  test("a missing bundle degrades to an empty map", () => {
    withBundle({}, () => {
      assert.deepEqual(readCoachingRules(), {});
    });
  });

  test("a heading that is only a suffix or prefix of the classification does not match", () => {
    const withNearMiss = [
      "---",
      "---",
      "## blunders",
      "Not the blunder section.",
      "",
      "## Move classification: mistake!",
      "Not the mistake section.",
    ].join("\n");
    withBundle({ "concepts/coaching-rules.md": withNearMiss }, () => {
      assert.deepEqual(readCoachingRules(), {});
    });
  });
});
