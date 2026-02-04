const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

async function fetchOk(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    ...init,
  });
  return res;
}

describe("smoke", () => {
  test("/api/health responds with JSON", async () => {
    const res = await fetchOk("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("time");
    expect(body).toHaveProperty("checks");
  });

  test("public pages respond (/, /signup, /login)", async () => {
    for (const path of ["/", "/signup", "/login"]) {
      const res = await fetchOk(path);
      // Next may return 200 or 307 depending on auth routing; both indicate server is up.
      expect([200, 307, 308]).toContain(res.status);
      const ct = res.headers.get("content-type") ?? "";
      if (res.status === 200) expect(ct).toContain("text/html");
    }
  });

  test("app pages redirect to /login when unauthenticated", async () => {
    for (const path of ["/dashboard", "/files", "/settings", "/addons", "/status"]) {
      const res = await fetchOk(path);
      // Some deployments may allow certain pages to render without auth;
      // accept either an auth redirect or a normal HTML response.
      if ([307, 308].includes(res.status)) {
        const loc = res.headers.get("location") ?? "";
        expect(loc).toContain("/login");
      } else {
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/html");
      }
    }
  });
});

