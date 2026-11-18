import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, schema } from "./db";
import { faulty, migratedD1 } from "./db/faulty-d1";
import { flushLogoutOutbox, queueOrStoreLogout } from "./logout-outbox";

const logout = { clientId: "track", sub: "pairwise-person", sid: "ended-session" };
let real: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
	({ d1: real, dispose } = await migratedD1("logout-outbox-test"));
});

afterAll(async () => {
	await dispose?.();
});

async function rows() {
	return createDb(real).select().from(schema.logoutOutbox);
}

describe("logout queue outbox", () => {
	it("keeps a failed queue handoff and sends it on the next cron", async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error("queue unavailable"))
			.mockResolvedValue(undefined);
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await queueOrStoreLogout(createDb(real), { send }, logout, 60);
			expect(await rows()).toHaveLength(1);
			expect(send).toHaveBeenCalledTimes(1);
			await flushLogoutOutbox(createDb(real), { send });
			expect(send).toHaveBeenCalledTimes(2);
			expect(await rows()).toHaveLength(0);
		} finally {
			warned.mockRestore();
		}
	});

	it("still uses the queue if D1 cannot store the handoff", async () => {
		const { database, state } = faulty(real);
		state.only = /^insert into "logout_outbox"/i;
		state.failures = 1;
		const send = vi.fn().mockResolvedValue(undefined);
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await queueOrStoreLogout(createDb(database), { send }, logout, 60);
			expect(send).toHaveBeenCalledOnce();
			expect(await rows()).toHaveLength(0);
		} finally {
			warned.mockRestore();
		}
	});

	it("keeps a row when the recovery cron also finds the queue unavailable", async () => {
		const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await queueOrStoreLogout(createDb(real), { send }, logout, 60);
			await flushLogoutOutbox(createDb(real), { send });
			expect(send).toHaveBeenCalledTimes(2);
			expect(await rows()).toHaveLength(1);
			send.mockResolvedValue(undefined);
			await flushLogoutOutbox(createDb(real), { send });
			expect(await rows()).toHaveLength(0);
		} finally {
			warned.mockRestore();
		}
	});

	it("reports failure when neither D1 nor the queue can retain the logout", async () => {
		const { database, state } = faulty(real);
		state.only = /^insert into "logout_outbox"/i;
		state.failures = 1;
		const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(queueOrStoreLogout(createDb(database), { send }, logout, 60)).rejects.toThrow(
				"queue unavailable",
			);
			expect(await rows()).toHaveLength(0);
		} finally {
			warned.mockRestore();
		}
	});

	it("retains a row after queue acceptance if its deletion fails, making a later duplicate safe", async () => {
		const { database, state } = faulty(real);
		state.only = /^delete from "logout_outbox"/i;
		state.failures = 1;
		const send = vi.fn().mockResolvedValue(undefined);
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await queueOrStoreLogout(createDb(database), { send }, logout, 60);
			expect(await rows()).toHaveLength(1);
			await flushLogoutOutbox(createDb(real), { send });
			expect(send).toHaveBeenCalledTimes(2);
			expect(await rows()).toHaveLength(0);
		} finally {
			warned.mockRestore();
		}
	});
});
