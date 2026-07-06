export * from "./schema";
export * from "./auth-schema";
export { getDb, schema, authSchema, fullSchema, type Db, type FullSchema } from "./client";
// Query-builder helpers re-exported so consumers don't need their own
// drizzle-orm dependency (keeps the version single-sourced here).
export { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
