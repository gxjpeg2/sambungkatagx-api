import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedDictionary, clearRateLimitKv } from "./testUtils.js";

const BASE = "http://example.com";

async function register(username, pin = "Password123") {
  return SELF.fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
}

async function login(username, pin = "Password123") {
  return SELF.fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
}

beforeEach(async () => {
  await resetDb(env);
});

describe("routing dasar", () => {
  it("path yang gak ada balikin 404 not found", async () => {
    const res = await SELF.fetch(`${BASE}/nonexistent`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("OPTIONS balikin CORS header", async () => {
    const res = await SELF.fetch(`${BASE}/login`, { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://sambungkata.gxjpeg.workers.dev"
    );
  });
});

describe("POST /register", () => {
  it("berhasil bikin akun baru dan balikin token", async () => {
    const res = await register("testuser1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.data).toEqual({});
  });

  it("tolak username kurang dari 3 karakter", async () => {
    const res = await register("ab");
    expect(res.status).toBe(400);
  });

  it("tolak pin tanpa huruf besar", async () => {
    const res = await register("testuser2", "password123");
    expect(res.status).toBe(400);
  });

  it("tolak pin tanpa angka", async () => {
    const res = await register("testuser3", "PasswordOnly");
    expect(res.status).toBe(400);
  });

  it("tolak username yang udah dipakai", async () => {
    await register("dupeuser");
    const res = await register("dupeuser");
    expect(res.status).toBe(409);
  });
});

describe("POST /login", () => {
  it("berhasil login dengan pin yang benar", async () => {
    await register("loginuser");
    const res = await login("loginuser");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });

  it("tolak pin yang salah", async () => {
    await register("loginuser2");
    const res = await login("loginuser2", "SalahPin123");
    expect(res.status).toBe(401);
  });

  it("tolak username yang belum terdaftar", async () => {
    const res = await login("gaadaorang");
    expect(res.status).toBe(401);
  });

  it("login ulang bikin session lama invalid (single device)", async () => {
    await register("deviceuser");
    const first = await login("deviceuser");
    const firstToken = (await first.json()).token;

    // Login lagi, simulasi device kedua
    await login("deviceuser");

    // Token device pertama harus udah gak valid
    const res = await SELF.fetch(`${BASE}/sync`, {
      headers: { Authorization: "Bearer " + firstToken },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("SESSION_REPLACED");
  });

  it("kena rate limit setelah 5 kali gagal", async () => {
    await register("ratelimituser");
    for (let i = 0; i < 5; i++) {
      await login("ratelimituser", "SalahBanget1");
    }
    const res = await login("ratelimituser", "SalahBanget1");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
    await clearRateLimitKv(env, "ratelimituser");
  });
});

describe("GET/POST /sync", () => {
  it("tanpa token balikin 401 invalid token", async () => {
    const res = await SELF.fetch(`${BASE}/sync`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("INVALID_TOKEN");
  });

  it("simpen dan ambil data user lewat sync", async () => {
    const reg = await register("syncuser");
    const { token } = await reg.json();

    const postRes = await SELF.fetch(`${BASE}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ data: { blocked: ["katatest"] } }),
    });
    expect(postRes.status).toBe(200);

    const getRes = await SELF.fetch(`${BASE}/sync`, {
      headers: { Authorization: "Bearer " + token },
    });
    const body = await getRes.json();
    expect(body.data.blocked).toEqual(["katatest"]);
  });
});

describe("POST /report-words dan GET /reported-words", () => {
  it("cuma nyimpen kata blocked yang emang ada di kamus, custom yang belum ada di kamus", async () => {
    await seedDictionary(env, ["makan", "minum", "tidur"]);

    const reg = await register("reportuser");
    const { token } = await reg.json();

    const res = await SELF.fetch(`${BASE}/report-words`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        blocked: ["makan", "katagakadadikamus"],
        customWords: ["katabaru", "minum"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dictFetchOk).toBe(true);
  });

  it("user biasa (bukan owner/exempt) ditolak akses reported-words", async () => {
    await seedDictionary(env, ["makan"]);
    const reg = await register("bukanowner");
    const { token } = await reg.json();

    const res = await SELF.fetch(`${BASE}/reported-words`, {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(403);
  });

  it("owner bisa lihat daftar reported words", async () => {
    // OWNER_USERNAME di wrangler.jsonc = "gxjpeg2"
    await seedDictionary(env, ["makan", "minum"]);
    await register("gxjpeg2");
    const loginRes = await login("gxjpeg2");
    const { token } = await loginRes.json();

    // laporin dulu satu kata blocked yang valid
    await SELF.fetch(`${BASE}/report-words`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ blocked: ["makan"], customWords: [] }),
    });

    const res = await SELF.fetch(`${BASE}/reported-words`, {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blocked).toContain("makan");
    expect(body._debug.dictFetchOk).toBe(true);
  });
});

describe("POST /unblock-word", () => {
  it("hapus kata dari reported_words dan dari data.blocked semua user yang punya", async () => {
    await seedDictionary(env, ["makan"]);

    await register("gxjpeg2");
    const ownerLogin = await login("gxjpeg2");
    const { token: ownerToken } = await ownerLogin.json();

    // user lain nge-block kata "makan" di data personalnya
    const reg = await register("userpunyablock");
    const { token: userToken } = await reg.json();
    await SELF.fetch(`${BASE}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + userToken,
      },
      body: JSON.stringify({ data: { blocked: ["makan"] } }),
    });

    await SELF.fetch(`${BASE}/report-words`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ownerToken,
      },
      body: JSON.stringify({ blocked: ["makan"], customWords: [] }),
    });

    const res = await SELF.fetch(`${BASE}/unblock-word`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ownerToken,
      },
      body: JSON.stringify({ word: "makan" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usersAffected).toBe(1);

    const syncRes = await SELF.fetch(`${BASE}/sync`, {
      headers: { Authorization: "Bearer " + userToken },
    });
    const syncBody = await syncRes.json();
    expect(syncBody.data.blocked).toEqual([]);
  });
});

describe("POST /backfill-reported-words", () => {
  it("scan semua user dan isi ulang reported_words dari data personal", async () => {
    await seedDictionary(env, ["makan", "minum"]);

    await register("gxjpeg2");
    const ownerLogin = await login("gxjpeg2");
    const { token: ownerToken } = await ownerLogin.json();

    const reg = await register("userbackfill");
    const { token: userToken } = await reg.json();
    await SELF.fetch(`${BASE}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + userToken,
      },
      body: JSON.stringify({
        data: { blocked: ["makan"], customWords: ["katabaruuser"] },
      }),
    });

    const res = await SELF.fetch(`${BASE}/backfill-reported-words`, {
      method: "POST",
      headers: { Authorization: "Bearer " + ownerToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usersScanned).toBe(2); // owner + userbackfill
    expect(body.wordsProcessed).toBe(2); // "makan" blocked + "katabaruuser" custom
  });
});
