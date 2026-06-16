export interface Env {
  DB: D1Database;
  ADMIN_USER: string;
  ADMIN_PASS: string;
}

export const YASURAGI_STORE_NAME = "三田和食酒場 やすらぎ";
export const YASURAGI_REVIEW_URL = "https://tabelog.onelink.me/kcDZ?af_dp=tabelog-v2://login?restaurant_id=13300381";

function uuid() {
  return crypto.randomUUID();
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signSession(payload: string, secret: string) {
  const data = new TextEncoder().encode(payload + "." + secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeAdminSession(user: string, secret: string) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${user}.${exp}`;
  const sig = await signSession(payload, secret);
  return `${payload}.${sig}`;
}

async function verifyAdminSession(token: string, user: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [u, expRaw, sig] = parts;
  if (u !== user) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await signSession(`${u}.${exp}`, secret);
  return sig === expected;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function renderAdminLogin(error = "") {
  const err = error ? `<p style="color:#b91c1c;margin:0 0 12px 0;">${escapeHtml(error)}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${YASURAGI_STORE_NAME} Admin Login</title>
  <style>body{font-family:sans-serif;background:#f7f7f8}main{max-width:420px;margin:48px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px}input{width:100%;padding:10px;margin:8px 0 12px;box-sizing:border-box}button{padding:10px 14px;background:#111827;color:#fff;border:none;border-radius:6px;cursor:pointer;}</style>
  </head><body><main><h1 style="margin:0 0 12px 0;">${YASURAGI_STORE_NAME}<br>管理画面ログイン</h1>${err}
  <form method="post" action="/admin/login">
  <label>アカウント</label><input name="user" autocomplete="username" />
  <label>パスワード</label><input name="pass" type="password" autocomplete="current-password" />
  <button type="submit">ログイン</button>
  </form></main></body></html>`;
}

function renderAdmin(rows: any[]) {
  function formatTagValue(value: unknown) {
    const raw = String(value ?? "");
    const colonIndex = raw.search(/[:：]/);
    return escapeHtml(colonIndex >= 0 ? raw.slice(colonIndex + 1) : raw);
  }

  const trs = rows.map((r) => {
    let tagCols = ["", "", "", "", ""];
    if (r.tags_json) {
      try {
        const parsed = JSON.parse(String(r.tags_json));
        if (Array.isArray(parsed)) {
          tagCols = parsed.slice(0, 5).map(formatTagValue);
          while (tagCols.length < 5) tagCols.push("");
        }
      } catch (_) {}
    }
    const detail = r.detail ? escapeHtml(String(r.detail)) : "";
    return `<tr>
      <td>${escapeHtml(String(r.created_at))}</td>
      <td>${escapeHtml(String(r.rating))}</td>
      <td>${tagCols[0]}</td>
      <td>${tagCols[1]}</td>
      <td>${tagCols[2]}</td>
      <td>${tagCols[3]}</td>
      <td>${tagCols[4]}</td>
      <td>${detail}</td>
      <td>${escapeHtml(String(r.id))}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${YASURAGI_STORE_NAME} Feedback Admin</title>
  <style>body{font-family:sans-serif;background:#f7f7f8;padding:20px;}table{border-collapse:collapse;width:100%;background:#fff;}td,th{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#eee;}button{padding:8px 12px;background:#b91c1c;color:#fff;border:none;border-radius:4px;cursor:pointer;}</style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h1 style="margin:0;">${YASURAGI_STORE_NAME} フィードバック管理</h1>
    <form method="post" action="/admin/logout" style="margin:0;"><button type="submit">ログアウト</button></form>
  </div>
  <table><thead><tr><th>作成日時</th><th>評価</th><th>性別</th><th>利用シーン</th><th>来店きっかけ</th><th>料理</th><th>接客</th><th>詳細内容</th><th>ID</th></tr></thead>
  <tbody>${trs}</tbody></table>
  </body></html>`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return new Response("Bad Request", { status: 400 });

      const body = (await req.json().catch(() => null)) as any;
      const rating = Number(body?.rating);
      const ref = typeof body?.ref === "string" ? body.ref.slice(0, 100) : null;

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return new Response(JSON.stringify({ ok: false, error: "invalid_rating" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const id = uuid();
      const created_at = new Date().toISOString();
      const ua = req.headers.get("user-agent") || "";
      const ip = req.headers.get("cf-connecting-ip") || "";
      const ip_hash = ip ? await sha256Hex(ip) : null;

      await env.DB.prepare("INSERT INTO feedback (id, created_at, rating, user_agent, ip_hash, ref) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, created_at, rating, ua, ip_hash, ref)
        .run();

      const redirect = rating <= 3 ? "/sorry.html" : YASURAGI_REVIEW_URL;
      return new Response(JSON.stringify({ ok: true, redirect, id }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/api/feedback_detail" && req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return new Response("Bad Request", { status: 400 });

      const body = (await req.json().catch(() => null)) as any;
      const feedback_id = typeof body?.id === "string" ? body.id.slice(0, 100) : "";
      const detail = typeof body?.detail === "string" ? body.detail.slice(0, 2000) : "";
      const contact = typeof body?.contact === "string" ? body.contact.slice(0, 200) : "";
      const ref = typeof body?.ref === "string" ? body.ref.slice(0, 100) : null;
      const tags = Array.isArray(body?.tags) ? body.tags : [];
      const cleanTags = tags.filter((v: unknown) => typeof v === "string").map((v: string) => v.slice(0, 50)).slice(0, 10);

      if (!feedback_id) {
        return new Response(JSON.stringify({ ok: false, error: "missing_feedback_id" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (!detail && cleanTags.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: "missing_detail" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const created_at = new Date().toISOString();
      const tags_json = cleanTags.length ? JSON.stringify(cleanTags) : null;

      await env.DB.prepare("INSERT OR REPLACE INTO feedback_detail (feedback_id, created_at, tags_json, detail, contact, ref) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(feedback_id, created_at, tags_json, detail || null, contact || null, ref)
        .run();

      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/admin/login" && req.method === "GET") {
      return new Response(renderAdminLogin(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/admin/login" && req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const user = typeof form?.get("user") === "string" ? String(form?.get("user")) : "";
      const pass = typeof form?.get("pass") === "string" ? String(form?.get("pass")) : "";
      if (user !== env.ADMIN_USER || pass !== env.ADMIN_PASS) {
        return new Response(renderAdminLogin("アカウントまたはパスワードが間違っています。"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      const token = await makeAdminSession(user, env.ADMIN_PASS);
      return new Response(null, {
        status: 302,
        headers: {
          location: "/admin",
          "set-cookie": `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
        },
      });
    }

    if (url.pathname === "/admin/logout" && req.method === "POST") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/admin/login",
          "set-cookie": "admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      });
    }

    if (url.pathname === "/admin" && req.method === "GET") {
      const cookie = req.headers.get("cookie") || "";
      const m = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
      const token = m ? m[1] : "";
      const ok = token ? await verifyAdminSession(token, env.ADMIN_USER, env.ADMIN_PASS) : false;
      if (!ok) return new Response(null, { status: 302, headers: { location: "/admin/login" } });

      const { results } = await env.DB.prepare(`SELECT
        f.id,
        f.created_at,
        f.rating,
        d.tags_json,
        d.detail,
        d.contact
      FROM feedback f
      LEFT JOIN feedback_detail d ON d.feedback_id = f.id
      ORDER BY f.created_at DESC
      LIMIT 500`).all();

      return new Response(renderAdmin(results as any[]), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
  },
};
