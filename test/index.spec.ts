import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { YASURAGI_REVIEW_URL } from "../src";

function createEnv(options: { feedbackRating?: number } = {}) {
	const run = vi.fn(async () => ({ success: true }));
	const all = vi.fn(async () => ({ results: [] }));
	const first = vi.fn(async () => options.feedbackRating === undefined ? null : {
		rating: options.feedbackRating,
		created_at: "2026-06-16T18:00:00.000Z",
	});
	const bind = vi.fn(() => ({ run, first }));
	const prepare = vi.fn((sql: string) => {
		if (sql.includes("SELECT") && sql.includes("ORDER BY")) return { all };
		return { bind, all };
	});

	return {
		DB: { prepare },
		ADMIN_USER: "admin",
		ADMIN_PASS: "pass",
		RESEND_API_KEY: "re_test",
		FEEDBACK_EMAIL_FROM: "Yasuragi <notice@example.com>",
		FEEDBACK_EMAIL_TO: "owner@example.com",
		_prepare: prepare,
		_bind: bind,
		_run: run,
		_all: all,
		_first: first,
	} as unknown as Env & {
		_prepare: ReturnType<typeof vi.fn>;
		_bind: ReturnType<typeof vi.fn>;
		_run: ReturnType<typeof vi.fn>;
		_all: ReturnType<typeof vi.fn>;
		_first: ReturnType<typeof vi.fn>;
	};
}

describe("feedback worker", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

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

	it("sends a Resend email after low-rating detail feedback", async () => {
		const resendFetch = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), {
			status: 200,
			headers: { "content-type": "application/json" },
		}));
		vi.stubGlobal("fetch", resendFetch);

		const response = await worker.fetch(
			new Request("https://example.com/api/feedback_detail", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "feedback-1",
					tags: ["料理:2", "接客:3"],
					detail: "料理の提供が遅かったです。",
					contact: "guest@example.com",
					ref: "qr-1",
				}),
			}),
			createEnv({ feedbackRating: 2 }),
		);

		const body = await response.json() as { ok: boolean };
		const payload = JSON.parse(String(resendFetch.mock.calls[0][1]?.body));

		expect(body.ok).toBe(true);
		expect(resendFetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
			method: "POST",
			headers: expect.objectContaining({
				authorization: "Bearer re_test",
				"content-type": "application/json",
			}),
		}));
		expect(payload).toMatchObject({
			from: "Yasuragi <notice@example.com>",
			to: ["owner@example.com"],
			subject: "【三田和食酒場 やすらぎ】低評価フィードバックを受信しました",
		});
		expect(payload.text).toContain("評価: 2 / 5");
		expect(payload.text).toContain("料理: 2");
		expect(payload.text).toContain("料理の提供が遅かったです。");
	});

	it("does not send a Resend email after high-rating detail feedback", async () => {
		const resendFetch = vi.fn();
		vi.stubGlobal("fetch", resendFetch);

		const response = await worker.fetch(
			new Request("https://example.com/api/feedback_detail", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "feedback-2",
					tags: ["料理:5", "接客:5"],
					detail: "おいしかったです。",
				}),
			}),
			createEnv({ feedbackRating: 5 }),
		);

		const body = await response.json() as { ok: boolean };

		expect(body.ok).toBe(true);
		expect(resendFetch).not.toHaveBeenCalled();
	});
});
