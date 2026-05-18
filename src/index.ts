/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
 export interface Env {
	DB: D1Database;
	ADMIN_USER: string;
	ADMIN_PASS: string;
  }
  
  function uuid() {
	return crypto.randomUUID();
  }
  
  async function sha256Hex(input: string) {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  
  export default {
	async fetch(req: Request, env: Env): Promise<Response> {
	  const url = new URL(req.url);
  
	  if (url.pathname === "/api/feedback" && req.method === "POST") {
		const ct = req.headers.get("content-type") || "";
		if (!ct.includes("application/json")) return new Response("Bad Request", { status: 400 });
  
		const body = await req.json().catch(() => null) as any;
		const rating = Number(body?.rating);
		const comment = typeof body?.comment === "string" ? body.comment.slice(0, 1000) : null;
		const ref = typeof body?.ref === "string" ? body.ref.slice(0, 100) : null;
  
		if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		  return new Response(JSON.stringify({ ok: false, error: "invalid_rating" }), {
			status: 400,
			headers: { "content-type": "application/json" }
		  });
		}
  
		const id = uuid();
		const created_at = new Date().toISOString();
		const ua = req.headers.get("user-agent") || "";
		const ip = req.headers.get("cf-connecting-ip") || "";
		const ip_hash = ip ? await sha256Hex(ip) : null;
  
		await env.DB.prepare(
		  "INSERT INTO feedback (id, created_at, rating, comment, user_agent, ip_hash, ref) VALUES (?, ?, ?, ?, ?, ?, ?)"
		).bind(id, created_at, rating, comment, ua, ip_hash, ref).run();
  
		const redirect = rating <= 3 ? "/sorry.html" : "https://search.google.com/local/writereview?placeid=ChIJjYETarCLGGARlG9qF7BgglE";
  
		return new Response(JSON.stringify({ ok: true, redirect, id }), {
		  headers: { "content-type": "application/json" }
		});
	  }
  
	  if (url.pathname === "/admin" && req.method === "GET") {
		const auth = req.headers.get("authorization") || "";
		const ok = checkBasicAuth(auth, env.ADMIN_USER, env.ADMIN_PASS);
		if (!ok) {
		  return new Response("Unauthorized", {
			status: 401,
			headers: { "WWW-Authenticate": 'Basic realm="admin"' }
		  });
		}
  
		const { results } = await env.DB.prepare(
		  "SELECT id, created_at, rating, comment, ref FROM feedback ORDER BY created_at DESC LIMIT 500"
		).all();
  
		const html = renderAdmin(results as any[]);
		return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
	  }
  
	  return new Response("Not Found", { status: 404 });
	}
  };
  
  function checkBasicAuth(auth: string, user: string, pass: string) {
	if (!auth.startsWith("Basic ")) return false;
	const raw = atob(auth.slice(6));
	const idx = raw.indexOf(":");
	if (idx < 0) return false;
	return raw.slice(0, idx) === user && raw.slice(idx + 1) === pass;
  }
  
  function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
  }
  
  function renderAdmin(rows: any[]) {
	const trs = rows.map(r => {
	  const c = r.comment ? escapeHtml(String(r.comment)) : "";
	  return `<tr>
		<td>${escapeHtml(String(r.created_at))}</td>
		<td>${escapeHtml(String(r.rating))}</td>
		<td>${c}</td>
		<td>${r.ref ? escapeHtml(String(r.ref)) : ""}</td>
		<td>${escapeHtml(String(r.id))}</td>
	  </tr>`;
	}).join("");
	return `<!doctype html><html><head><meta charset="utf-8"><title>Feedback Admin</title>
	<style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;vertical-align:top}</style>
	</head><body>
	<h1>Feedback</h1>
	<table><thead><tr><th>created_at</th><th>rating</th><th>comment</th><th>ref</th><th>id</th></tr></thead>
	<tbody>${trs}</tbody></table>
	</body></html>`;
  }
  
