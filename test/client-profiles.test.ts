/**
 * The browser-owned profile list: localStorage persistence, the active-profile
 * cookie bridge, and the Lichess token that must never leave storage by accident.
 *
 * The module is written for the browser, so the tests install a minimal
 * `window`/`document`/localStorage fake — including a real cookie jar, because
 * "set the cookie then read it back" is exactly the behaviour the Profiles screen
 * depends on. The token-containment test is the security-relevant one.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  loadProfiles,
  saveProfiles,
  activeProfile,
  setActiveProfile,
  clearActiveProfile,
  createProfile,
  activeToken,
  activeLlmConnections,
  activeDefaultLlmId,
  refreshCookie,
  type StoredProfile,
} from "@/lib/client-profiles";
import { PROFILE_COOKIE, encodeProfile } from "@/lib/profile-cookie";
import type { LlmConnection } from "@/lib/llm-providers";

const STORAGE_KEY = "chessdad.profiles";

interface FakeBrowser {
  store: Map<string, string>;
  jar: Record<string, string>;
  cookieHeader(): string;
  writeCookie(raw: string): void;
}

function installBrowser(): FakeBrowser {
  const store = new Map<string, string>();
  const jar: Record<string, string> = {};

  const writeCookie = (raw: string) => {
    const parts = raw.split(";").map((s) => s.trim());
    const eq = parts[0].indexOf("=");
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs = new Map<string, string>();
    for (const p of parts.slice(1)) {
      const i = p.indexOf("=");
      attrs.set((i < 0 ? p : p.slice(0, i)).toLowerCase(), i < 0 ? "" : p.slice(i + 1));
    }
    const maxAge = attrs.has("max-age") ? Number(attrs.get("max-age")) : undefined;
    if (maxAge === 0) delete jar[name];
    else jar[name] = value;
  };

  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };

  (globalThis as Record<string, unknown>).window = { localStorage };
  (globalThis as Record<string, unknown>).document = {
    get cookie() {
      return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    set cookie(raw: string) {
      writeCookie(raw);
    },
  };

  return { store, jar, cookieHeader: () => (globalThis.document as Document).cookie, writeCookie };
}

function uninstallBrowser(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
}

describe("client-profiles", () => {
  let env: FakeBrowser;

  before(() => {
    env = installBrowser();
  });

  after(() => {
    uninstallBrowser();
  });

  test("the read paths are inert when there is no browser", () => {
    const savedWindow = (globalThis as Record<string, unknown>).window;
    const savedDocument = (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
    try {
      assert.deepEqual(loadProfiles(), []);
      assert.equal(activeProfile(), null);
      assert.equal(activeToken(), "");
      // saveProfiles also guards; the setters are browser-only by design (they are
      // only reachable from click handlers in the browser).
      saveProfiles([createProfile("A", "", "", "")]);
    } finally {
      (globalThis as Record<string, unknown>).window = savedWindow;
      (globalThis as Record<string, unknown>).document = savedDocument;
    }
  });

  test("loadProfiles is empty before anything is saved", () => {
    env.store.clear();
    assert.deepEqual(loadProfiles(), []);
  });

  test("saveProfiles then loadProfiles round-trips every field including the token", () => {
    const connection: LlmConnection = {
      id: "c1",
      provider: "anthropic",
      label: "Claude",
      model: "claude-sonnet-4-5",
      apiKey: "sk-ant-secret",
      baseUrl: "",
      thinking: false,
    };
    const profiles: StoredProfile[] = [
      {
        id: "a",
        name: "Alice",
        lichess: "alice",
        chesscom: "alice-cc",
        token: "tok-a",
        llm: [connection],
        defaultLlmId: "c1",
      },
      { id: "b", name: "Bob", lichess: "", chesscom: "bob", token: "", llm: [], defaultLlmId: "" },
    ];
    saveProfiles(profiles);
    assert.deepEqual(loadProfiles(), profiles);
    assert.ok(env.store.has(STORAGE_KEY));
  });

  test("loadProfiles survives invalid JSON, non-arrays and junk entries", () => {
    env.store.set(STORAGE_KEY, "{not json");
    assert.deepEqual(loadProfiles(), []);
    env.store.set(STORAGE_KEY, '"a string"');
    assert.deepEqual(loadProfiles(), []);
    env.store.set(STORAGE_KEY, "null");
    assert.deepEqual(loadProfiles(), []);
    env.store.set(STORAGE_KEY, JSON.stringify([{ id: "ok" }, { name: "no id" }, null, 7, { id: "" }]));
    assert.deepEqual(loadProfiles(), [
      { id: "ok", name: "", lichess: "", chesscom: "", token: "", llm: [], defaultLlmId: "" },
    ]);
  });

  test("loadProfiles drops unknown fields and stringifies the rest", () => {
    env.store.set(
      STORAGE_KEY,
      JSON.stringify([{ id: "x", name: 5, lichess: null, chesscom: true, token: 1, admin: true }])
    );
    assert.deepEqual(loadProfiles(), [
      { id: "x", name: "5", lichess: "", chesscom: "true", token: "1", llm: [], defaultLlmId: "" },
    ]);
  });

  test("loadProfiles drops connections whose provider is unknown", () => {
    // A hand-edited or older entry must not be trusted into an outbound request.
    env.store.set(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "x",
          llm: [
            { id: "good", provider: "openai", model: "gpt-5", apiKey: "sk-x" },
            { id: "bad", provider: "not-a-provider", model: "x", apiKey: "leak" },
            null,
          ],
          defaultLlmId: "good",
        },
      ])
    );
    const [profile] = loadProfiles();
    assert.equal(profile.llm.length, 1);
    assert.equal(profile.llm[0].id, "good");
    assert.equal(profile.defaultLlmId, "good");
  });

  test("createProfile builds a full stored profile with a fresh id", () => {
    const p = createProfile("Alice", "alice", "alice-cc", "tok");
    assert.equal(p.name, "Alice");
    assert.equal(p.lichess, "alice");
    assert.equal(p.chesscom, "alice-cc");
    assert.equal(p.token, "tok");
    assert.deepEqual(p.llm, []);
    assert.equal(p.defaultLlmId, "");
    assert.notEqual(p.id, createProfile("Alice", "alice", "alice-cc", "tok").id);
  });

  test("setActiveProfile writes the cookie and activeProfile reads it back", () => {
    const p = createProfile("Alice", "alice", "", "tok-a");
    setActiveProfile(p);
    // The cookie carries the four public fields only — never the token.
    assert.deepEqual(activeProfile(), {
      id: p.id,
      name: p.name,
      lichess: p.lichess,
      chesscom: p.chesscom,
    });
    assert.ok(env.cookieHeader().includes(`${PROFILE_COOKIE}=`));
  });

  test("clearActiveProfile removes the cookie", () => {
    setActiveProfile(createProfile("Alice", "alice", "", "tok-a"));
    assert.ok(activeProfile());
    clearActiveProfile();
    assert.equal(activeProfile(), null);
    assert.ok(!env.cookieHeader().includes(PROFILE_COOKIE));
  });

  test("activeToken returns the stored token for the acting profile only", () => {
    const a = createProfile("Alice", "alice", "", "tok-a");
    const b = createProfile("Bob", "bob", "", "tok-b");
    saveProfiles([a, b]);

    setActiveProfile(a);
    assert.equal(activeToken(), "tok-a");
    setActiveProfile(b);
    assert.equal(activeToken(), "tok-b");

    // An active profile with no stored row has no token.
    setActiveProfile(createProfile("Ghost", "", "", ""));
    assert.equal(activeToken(), "");

    clearActiveProfile();
    assert.equal(activeToken(), "");
  });

  test("the token and API keys never reach the cookie", () => {
    const connection: LlmConnection = {
      id: "c1",
      provider: "openai",
      label: "",
      model: "gpt-5",
      apiKey: "SUPERSECRETAPIKEY",
      baseUrl: "",
      thinking: false,
    };
    const p = createProfile("Alice", "alice", "alice-cc", "SUPERSECRETTOKEN", [connection], "c1");
    saveProfiles([p]);
    setActiveProfile(p);
    assert.ok(!env.cookieHeader().includes("SUPERSECRETTOKEN"), "token leaked into document.cookie");
    assert.ok(!encodeProfile(p).includes("SUPERSECRETTOKEN"), "token leaked into the cookie payload");
    assert.ok(
      !env.cookieHeader().includes("SUPERSECRETAPIKEY"),
      "API key leaked into document.cookie"
    );
    assert.ok(!encodeProfile(p).includes("SUPERSECRETAPIKEY"), "API key leaked into the cookie payload");
  });

  test("activeLlmConnections and activeDefaultLlmId follow the acting profile", () => {
    const connection: LlmConnection = {
      id: "c1",
      provider: "google",
      label: "",
      model: "gemini-2.5-pro",
      apiKey: "k",
      baseUrl: "",
      thinking: false,
    };
    const a = createProfile("Alice", "alice", "", "", [connection], "c1");
    const b = createProfile("Bob", "bob", "", "");
    saveProfiles([a, b]);

    setActiveProfile(a);
    assert.equal(activeLlmConnections().length, 1);
    assert.equal(activeLlmConnections()[0].provider, "google");
    assert.equal(activeDefaultLlmId(), "c1");

    setActiveProfile(b);
    assert.deepEqual(activeLlmConnections(), []);
    assert.equal(activeDefaultLlmId(), "");

    clearActiveProfile();
    assert.deepEqual(activeLlmConnections(), []);
  });

  test("refreshCookie updates the cookie only for the acting profile", () => {
    const a = createProfile("Alice", "alice", "", "tok-a");
    const b = createProfile("Bob", "bob", "", "tok-b");
    setActiveProfile(a);

    refreshCookie({ ...b, name: "Bobby" });
    assert.equal(activeProfile()?.name, "Alice", "a different profile's edit must not steal the cookie");

    refreshCookie({ ...a, name: "Alicia" });
    assert.equal(activeProfile()?.name, "Alicia");

    clearActiveProfile();
    refreshCookie({ ...a, name: "Nobody" });
    assert.equal(activeProfile(), null, "with nobody active there is nothing to refresh");
  });
});
