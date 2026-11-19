import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, schema } from "../db";
import { faulty, migratedD1 } from "../db/faulty-d1";
import { twoFactorSetupUrlForInvitation } from "./workspace-invitation-guidance";

let real: D1Database;
let dispose: () => Promise<void>;
const origin = "https://id.example.com";

beforeAll(async () => {
	({ d1: real, dispose } = await migratedD1("workspace-invitation-guidance-test"));
	await createDb(real)
		.insert(schema.organization)
		.values({
			id: "needs-factor",
			name: "Needs factor",
			slug: "needs-factor",
			createdAt: new Date(),
			requireTwoFactor: true,
		})
		.run();
});

afterAll(async () => {
	await dispose?.();
});

describe("two-factor guidance for a workspace invitation", () => {
	it("uses the rule when D1 answers", async () => {
		expect(await twoFactorSetupUrlForInvitation(createDb(real), "needs-factor", origin)).toBe(
			`${origin}/account`,
		);
		expect(await twoFactorSetupUrlForInvitation(createDb(real), "missing", origin)).toBeUndefined();
	});

	it("omits optional guidance when the rule read fails", async () => {
		const { database, state } = faulty(real);
		state.failures = 100;
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(
				await twoFactorSetupUrlForInvitation(createDb(database), "needs-factor", origin),
			).toBeUndefined();
			expect(state.sent.length).toBeGreaterThan(0);
			expect(warned).toHaveBeenCalledWith(
				"could not read two-factor requirement for workspace needs-factor",
				expect.any(Error),
			);
		} finally {
			warned.mockRestore();
		}
	});
});
