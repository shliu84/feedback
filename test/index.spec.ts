import { describe, expect, it, vi } from "vitest";
import worker, { YASURAGI_REVIEW_URL } from "../src";

function createEnv() {
	const run = vi.fn(async () => ({ success: true }));
	const all = vi.fn(async () => ({ results: [] }));
	const bind = vi.fn(() => ({ run }));
	const prepare = vi.fn(() => ({ bind, all }));

	return {
		DB: { prepare },
		ADMIN_USER: "admin",
		ADMIN_PASS: "pass",
		_prepare: prepare,
		_bind: bind,
		_run: run,
		_all: all,
	} as unknown as Env & {
		_prepare: ReturnType<typeof vi.fn>;
		_bind: ReturnType<typeof vi.fn>;
		_run: ReturnType<typeof vi.fn>;
		_all: ReturnType<typeof vi.fn>;
	};
}

describe("feedback worker", () => {
	it("redirects high ratings to the Yasuragi Tabelog review page", async () => {
		const env = createEnv();
		const response = await worker.fetch(
			new Request("https://example.com/api/feedback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ rating: 5, ref: "qr-1" }),
			}),
			env,
		);

		const body = await response.json() as { ok: boolean; redirect: string };

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.redirect).toBe(YASURAGI_REVIEW_URL);
		expect(body.redirect).toContain("restaurant_id=13300381");
	});

	it("redirects low ratings to the internal Yasuragi survey", async () => {
		const env = createEnv();
		const response = await worker.fetch(
			new Request("https://example.com/api/feedback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ rating: 3 }),
			}),
			env,
		);

		const body = await response.json() as { ok: boolean; redirect: string };

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.redirect).toBe("/sorry.html");
	});

	it("renders dining-specific admin columns after login", async () => {
		const env = createEnv();
		const loginResponse = await worker.fetch(
			new Request("https://example.com/admin/login", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ user: "admin", pass: "pass" }),
			}),
			env,
		);

		const cookie = loginResponse.headers.get("set-cookie") || "";
		const session = cookie.split(";")[0];

		const response = await worker.fetch(
			new Request("https://example.com/admin", {
				headers: { cookie: session },
			}),
			env,
		);

		const html = await response.text();

		expect(html).toContain("三田和食酒場 やすらぎ");
		expect(html).toContain("<th>利用シーン</th>");
		expect(html).toContain("<th>来店きっかけ</th>");
		expect(html).toContain("<th>料理</th>");
		expect(html).toContain("<th>接客</th>");
	});
});
