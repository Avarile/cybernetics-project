// Barrel: re-export every table so the Drizzle client is fully typed via `drizzle(pool, { schema })`.
// As domains are ported, add their *.schema.ts here.
export * from "./user.schema";
export * from "./session.schema";
export * from "./api.schema";
export * from "./workspace.schema";
export * from "./project.schema";
export * from "./instance.schema";
export * from "../../../modules/profile/profile.schema";
export * from "../../../modules/instance/instance-admin.schema";
export * from "./_columns";
export * from "./_types";
