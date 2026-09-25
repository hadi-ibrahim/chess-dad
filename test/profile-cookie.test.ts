/**
 * The profile cookie is the only place a person is written down, so its
 * encode/decode round-trip is both identity and attack surface: it is read from
 * a header a client controls. These tests pin the wire format, the short packed
 * keys, the field whitelist (a Lichess token must never fit in a cookie), and the
 * hostile inputs — garbage base64, truncated JSON, wrong types, huge values.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_COOKIE,
  encodeProfile,
  decodeProfile,
  profileFromCookieHeader,
  profileCookie,
  clearedProfileCookie,
  newProfileId,
  emptyProfile,
  profileLabel,
  type BrowserProfile,
} from "@/lib/profile-cookie";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Base64url of an arbitrary string, the same alphabet the module uses. */
function b64u(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A packed payload built by hand, to test the decoder without the encoder. */
function packed(obj: unknown): string {
  return b64u(JSON.stringify(obj));
}

const profile: BrowserProfile = {
  id: "u-1",
  name: "Alice",
  lichess: "alice",
  chesscom: "alice-cc",
};

describe("encodeProfile / decodeProfile", () => {
  test("round-trips every field", () => {
    assert.deepEqual(decodeProfile(encodeProfile(profile)), profile);
  });

  test("round-trips non-ASCII names (the TextEncoder/TextDecoder path)", () => {
    const unicode = { ...profile, name: "José 日本語 ♞" };
    assert.deepEqual(decodeProfile(encodeProfile(unicode)), unicode);
  });

  test("uses the short packed keys, so the cookie stays small", () => {
    const json = Buffer.from(encodeProfile(profile).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ["c", "i", "l", "n"]);
    assert.ok(json.includes('"i":') && !json.includes('"id":'), "the id key should be packed");
    assert.ok(json.includes('"n":') && !json.includes('"name":'), "the name key should be packed");
  });

  test("emits only base64url characters — no +, / or =", () => {
    for (const p of [profile, { ...profile, name: "?~ÿ" }, { ...profile, id: "a".repeat(1000) }]) {
      assert.match(encodeProfile(p), /^[A-Za-z0-9_-]+$/);
    }
  });

  test("decodes a hand-packed payload", () => {
    assert.deepEqual(decodeProfile(packed({ i: "abc", n: "N", l: "L", c: "C" })), {
      id: "abc",
      name: "N",
      lichess: "L",
      chesscom: "C",
    });
  });

  test("tolerates standard base64 with padding (a hand-built cookie)", () => {
    const padded = Buffer.from(JSON.stringify({ i: "x", n: "y" }), "utf8").toString("base64");
    assert.deepEqual(decodeProfile(padded), { id: "x", name: "y", lichess: "", chesscom: "" });
  });

  test("missing optional fields become empty strings", () => {
    assert.deepEqual(decodeProfile(packed({ i: "x" })), {
      id: "x",
      name: "",
      lichess: "",
      chesscom: "",
    });
  });

  test("a missing, blank, or non-string id means nobody is active", () => {
    assert.equal(decodeProfile(packed({})), null);
    assert.equal(decodeProfile(packed({ i: "" })), null);
    assert.equal(decodeProfile(packed({ i: null })), null);
    assert.equal(decodeProfile(packed({ i: 0 })), null);
    assert.equal(decodeProfile(packed({ i: false })), null);
  });

  test("wrong-typed fields are coerced or dropped, never thrown", () => {
    // The id is stringified, because any truthy id is still an identity.
    assert.deepEqual(decodeProfile(packed({ i: 42 })), {
      id: "42",
      name: "",
      lichess: "",
      chesscom: "",
    });
    assert.deepEqual(decodeProfile(packed({ i: "x", n: 7, l: ["a"], c: true })), {
      id: "x",
      name: "",
      lichess: "",
      chesscom: "",
    });
  });

  test("extra keys are dropped — there is no place for a token", () => {
    assert.deepEqual(decodeProfile(packed({ i: "x", token: "SUPERSECRET", admin: true })), {
      id: "x",
      name: "",
      lichess: "",
      chesscom: "",
    });
  });

  test("a __proto__ payload does not pollute Object.prototype", () => {
    const raw = b64u('{"i":"x","__proto__":{"polluted":true}}');
    assert.deepEqual(decodeProfile(raw), { id: "x", name: "", lichess: "", chesscom: "" });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("null / undefined / empty raw input is null", () => {
    assert.equal(decodeProfile(null), null);
    assert.equal(decodeProfile(undefined), null);
    assert.equal(decodeProfile(""), null);
  });

  test("garbage base64, truncated JSON and non-object JSON are null", () => {
    assert.equal(decodeProfile("!!!!"), null);
    assert.equal(decodeProfile("not base64 %%%"), null);
    assert.equal(decodeProfile(b64u('{"i":"abc"')), null); // truncated
    assert.equal(decodeProfile(b64u("hello")), null); // valid base64, not JSON
    assert.equal(decodeProfile(b64u("null")), null);
    assert.equal(decodeProfile(b64u("5")), null);
    assert.equal(decodeProfile(b64u('"a string"')), null);
    assert.equal(decodeProfile(b64u("[1,2,3]")), null); // array has no `i`
  });

  test("very long values survive the round-trip unchanged", () => {
    const huge = { id: "i".repeat(100_000), name: "é".repeat(50_000), lichess: "l".repeat(10_000), chesscom: "" };
    const decoded = decodeProfile(encodeProfile(huge));
    assert.equal(decoded?.id.length, 100_000);
    assert.equal(decoded?.name.length, 50_000);
    assert.equal(decoded?.lichess.length, 10_000);
    assert.equal(decoded?.name, huge.name);
  });

  test("a very large blob of non-JSON base64 still decodes to null", () => {
    assert.equal(decodeProfile("A".repeat(200_000)), null);
  });
});

describe("profileFromCookieHeader", () => {
  const encoded = encodeProfile(profile);

  test("reads the cookie from a bare header", () => {
    assert.deepEqual(profileFromCookieHeader(`${PROFILE_COOKIE}=${encoded}`), profile);
  });

  test("finds it among other cookies, with or without a space", () => {
    assert.deepEqual(profileFromCookieHeader(`a=1; ${PROFILE_COOKIE}=${encoded}; b=2`), profile);
    assert.deepEqual(profileFromCookieHeader(`a=1;${PROFILE_COOKIE}=${encoded}`), profile);
    assert.deepEqual(profileFromCookieHeader(`${PROFILE_COOKIE}=${encoded}; a=1`), profile);
  });

  test("does not match a cookie whose name merely ends with the key", () => {
    assert.equal(profileFromCookieHeader(`x${PROFILE_COOKIE}=${encoded}`), null);
    assert.equal(profileFromCookieHeader(`${PROFILE_COOKIE}_extra=${encoded}`), null);
  });

  test("a cleared or blank cookie value means nobody is active", () => {
    // `[^;]+` cannot match the empty value of a cleared cookie.
    assert.equal(profileFromCookieHeader(`${PROFILE_COOKIE}=; path=/`), null);
    assert.equal(profileFromCookieHeader(`${PROFILE_COOKIE}=`), null);
  });

  test("a malformed value is null rather than a half-parsed profile", () => {
    assert.equal(profileFromCookieHeader(`${PROFILE_COOKIE}=garbage`), null);
    assert.equal(profileFromCookieHeader(`${PROFILE_COOKIE}=${b64u('{"i":')}`), null);
  });

  test("no header, an empty header, or an unrelated header is null", () => {
    assert.equal(profileFromCookieHeader(null), null);
    assert.equal(profileFromCookieHeader(""), null);
    assert.equal(profileFromCookieHeader("a=1; b=2"), null);
  });
});

describe("profileCookie / clearedProfileCookie", () => {
  test("is a well-formed Set-Cookie string for a year", () => {
    assert.equal(
      profileCookie(profile),
      `${PROFILE_COOKIE}=${encodeProfile(profile)}; path=/; max-age=31536000; samesite=lax`
    );
  });

  test("round-trips through profileFromCookieHeader", () => {
    assert.deepEqual(profileFromCookieHeader(profileCookie(profile)), profile);
  });

  test("never carries a Lichess token, even when handed one", () => {
    const withToken = { ...profile, token: "SUPERSECRETTOKEN" } as BrowserProfile;
    const cookie = profileCookie(withToken);
    assert.ok(!cookie.includes("SUPERSECRETTOKEN"), "the token leaked into the cookie");
    assert.ok(!decodeProfile(cookie.slice(cookie.indexOf("=") + 1).split(";")[0])?.hasOwnProperty("token"));
    assert.deepEqual(profileFromCookieHeader(cookie), profile);
  });

  test("the cleared cookie expires immediately and decodes to nobody", () => {
    const cleared = clearedProfileCookie();
    assert.equal(cleared, `${PROFILE_COOKIE}=; path=/; max-age=0; samesite=lax`);
    assert.equal(profileFromCookieHeader(cleared), null);
  });
});

describe("newProfileId / emptyProfile / profileLabel", () => {
  test("newProfileId is a fresh v4 UUID each time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProfileId()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID_V4);
  });

  test("emptyProfile starts blank, and accepts a supplied id", () => {
    const a = emptyProfile();
    assert.match(a.id, UUID_V4);
    assert.equal(a.name, "");
    assert.equal(a.lichess, "");
    assert.equal(a.chesscom, "");
    assert.deepEqual(emptyProfile("fixed"), { id: "fixed", name: "", lichess: "", chesscom: "" });
  });

  test("profileLabel prefers the name, then lichess, then chesscom", () => {
    assert.equal(profileLabel({ id: "1", name: "  Alice ", lichess: "l", chesscom: "c" }), "Alice");
    assert.equal(profileLabel({ id: "1", name: "  ", lichess: " l ", chesscom: "c" }), "l");
    assert.equal(profileLabel({ id: "1", name: "", lichess: "", chesscom: " c " }), "c");
  });

  test("profileLabel falls back to a generic label rather than an empty string", () => {
    assert.equal(profileLabel(emptyProfile("x")), "This player");
    assert.equal(profileLabel({ id: "x", name: "   ", lichess: "", chesscom: "" }), "This player");
  });
});
