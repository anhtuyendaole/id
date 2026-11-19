import { eq } from "drizzle-orm";
import { type Database, schema } from "../db";

/** Email delivery matters more than optional setup guidance after an invitation has been replaced. */
export async function twoFactorSetupUrlForInvitation(
	db: Database,
	workspaceId: string,
	origin: string,
): Promise<string | undefined> {
	try {
		const rule = await db
			.select({ required: schema.organization.requireTwoFactor })
			.from(schema.organization)
			.where(eq(schema.organization.id, workspaceId))
			.get();
		return rule?.required ? `${origin}/account` : undefined;
	} catch (error) {
		console.warn(`could not read two-factor requirement for workspace ${workspaceId}`, error);
		return undefined;
	}
}
