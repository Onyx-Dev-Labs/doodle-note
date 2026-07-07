module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/packages/db/src/auth-schema.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "account",
    ()=>account,
    "accountRelations",
    ()=>accountRelations,
    "invitation",
    ()=>invitation,
    "invitationRelations",
    ()=>invitationRelations,
    "member",
    ()=>member,
    "memberRelations",
    ()=>memberRelations,
    "organization",
    ()=>organization,
    "organizationRelations",
    ()=>organizationRelations,
    "session",
    ()=>session,
    "sessionRelations",
    ()=>sessionRelations,
    "user",
    ()=>user,
    "userRelations",
    ()=>userRelations,
    "verification",
    ()=>verification
]);
/**
 * Better Auth tables (user/session/account/verification + organization plugin).
 *
 * Generated with `npx auth@1.6.23 generate` (the Better Auth CLI) against the
 * installed better-auth version — regenerate rather than hand-editing when the
 * auth config changes. Kept separate from the product schema in ./schema.ts;
 * Better Auth's `organization` table is the source of truth for team
 * membership, while the legacy `workspaces` table remains untouched for now.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/relations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/table.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/text.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/timestamp.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$boolean$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/boolean.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/indexes.js [app-route] (ecmascript)");
;
;
const user = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("user", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    name: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("name").notNull(),
    email: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("email").notNull().unique(),
    emailVerified: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$boolean$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["boolean"])("email_verified").default(false).notNull(),
    image: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("image"),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").defaultNow().notNull(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at").defaultNow().$onUpdate(()=>/* @__PURE__ */ new Date()).notNull()
});
const session = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("session", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    expiresAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("expires_at").notNull(),
    token: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("token").notNull().unique(),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").defaultNow().notNull(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at").$onUpdate(()=>/* @__PURE__ */ new Date()).notNull(),
    ipAddress: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("ip_address"),
    userAgent: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_agent"),
    userId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_id").notNull().references(()=>user.id, {
        onDelete: "cascade"
    }),
    activeOrganizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("active_organization_id")
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("session_userId_idx").on(table.userId)
    ]);
const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("account", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    accountId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("account_id").notNull(),
    providerId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("provider_id").notNull(),
    userId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_id").notNull().references(()=>user.id, {
        onDelete: "cascade"
    }),
    accessToken: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("access_token"),
    refreshToken: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("refresh_token"),
    idToken: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id_token"),
    accessTokenExpiresAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("access_token_expires_at"),
    refreshTokenExpiresAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("refresh_token_expires_at"),
    scope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("scope"),
    password: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("password"),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").defaultNow().notNull(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at").$onUpdate(()=>/* @__PURE__ */ new Date()).notNull()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("account_userId_idx").on(table.userId)
    ]);
const verification = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("verification", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    identifier: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("identifier").notNull(),
    value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("value").notNull(),
    expiresAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("expires_at").notNull(),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").defaultNow().notNull(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at").defaultNow().$onUpdate(()=>/* @__PURE__ */ new Date()).notNull()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("verification_identifier_idx").on(table.identifier)
    ]);
const organization = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("organization", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    name: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("name").notNull(),
    slug: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("slug").notNull().unique(),
    logo: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("logo"),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").notNull(),
    metadata: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("metadata")
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uniqueIndex"])("organization_slug_uidx").on(table.slug)
    ]);
const member = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("member", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    organizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("organization_id").notNull().references(()=>organization.id, {
        onDelete: "cascade"
    }),
    userId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_id").notNull().references(()=>user.id, {
        onDelete: "cascade"
    }),
    role: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("role").default("member").notNull(),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").notNull()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("member_organizationId_idx").on(table.organizationId),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("member_userId_idx").on(table.userId)
    ]);
const invitation = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("invitation", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("id").primaryKey(),
    organizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("organization_id").notNull().references(()=>organization.id, {
        onDelete: "cascade"
    }),
    email: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("email").notNull(),
    role: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("role"),
    status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("status").default("pending").notNull(),
    expiresAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("expires_at").notNull(),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at").defaultNow().notNull(),
    inviterId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("inviter_id").notNull().references(()=>user.id, {
        onDelete: "cascade"
    })
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("invitation_organizationId_idx").on(table.organizationId),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("invitation_email_idx").on(table.email)
    ]);
const userRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(user, ({ many })=>({
        sessions: many(session),
        accounts: many(account),
        members: many(member),
        invitations: many(invitation)
    }));
const sessionRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(session, ({ one })=>({
        user: one(user, {
            fields: [
                session.userId
            ],
            references: [
                user.id
            ]
        })
    }));
const accountRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(account, ({ one })=>({
        user: one(user, {
            fields: [
                account.userId
            ],
            references: [
                user.id
            ]
        })
    }));
const organizationRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(organization, ({ many })=>({
        members: many(member),
        invitations: many(invitation)
    }));
const memberRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(member, ({ one })=>({
        organization: one(organization, {
            fields: [
                member.organizationId
            ],
            references: [
                organization.id
            ]
        }),
        user: one(user, {
            fields: [
                member.userId
            ],
            references: [
                user.id
            ]
        })
    }));
const invitationRelations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$relations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["relations"])(invitation, ({ one })=>({
        organization: one(organization, {
            fields: [
                invitation.organizationId
            ],
            references: [
                organization.id
            ]
        }),
        user: one(user, {
            fields: [
                invitation.inviterId
            ],
            references: [
                user.id
            ]
        })
    }));
}),
"[project]/packages/db/src/schema.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "folders",
    ()=>folders,
    "meetings",
    ()=>meetings,
    "notes",
    ()=>notes,
    "subscriptions",
    ()=>subscriptions,
    "syncDevices",
    ()=>syncDevices,
    "transcriptSegments",
    ()=>transcriptSegments
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$boolean$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/boolean.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/indexes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$integer$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/integer.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$jsonb$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/jsonb.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/table.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$real$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/real.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/text.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/timestamp.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pg-core/columns/uuid.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/auth-schema.ts [app-route] (ecmascript)");
;
;
const folders = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("folders", {
    /** Desktop-minted UUID — the same id on every device and in the cloud. */ id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("id").primaryKey(),
    organizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("organization_id").notNull().references(()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"].id, {
        onDelete: "cascade"
    }),
    name: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("name").notNull(),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at", {
        withTimezone: true
    }).defaultNow(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at", {
        withTimezone: true
    }).defaultNow()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("folders_organization_id_idx").on(table.organizationId)
    ]);
const meetings = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("meetings", {
    /** Desktop-minted UUID — the same id on the Mac and in the cloud. */ id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("id").primaryKey(),
    organizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("organization_id").notNull().references(()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"].id, {
        onDelete: "cascade"
    }),
    title: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("title").notNull().default("Untitled meeting"),
    status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("status", {
        enum: [
            "recording",
            "processing",
            "complete"
        ]
    }).notNull().default("complete"),
    calendarEventId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("calendar_event_id"),
    /** Optional folder assignment; folder deletion moves meetings out. */ folderId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("folder_id").references(()=>folders.id, {
        onDelete: "set null"
    }),
    /** Public share-link token; null = not shared. */ shareToken: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("share_token").unique(),
    startedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("started_at", {
        withTimezone: true
    }),
    endedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("ended_at", {
        withTimezone: true
    }),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at", {
        withTimezone: true
    }).defaultNow(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at", {
        withTimezone: true
    }).defaultNow()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("meetings_organization_id_idx").on(table.organizationId)
    ]);
const transcriptSegments = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("transcript_segments", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("id").primaryKey().defaultRandom(),
    meetingId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("meeting_id").notNull().references(()=>meetings.id, {
        onDelete: "cascade"
    }),
    channel: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("channel", {
        enum: [
            "mic",
            "system"
        ]
    }).notNull(),
    speaker: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("speaker").notNull(),
    text: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("text").notNull(),
    startMs: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$integer$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["integer"])("start_ms").notNull(),
    endMs: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$integer$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["integer"])("end_ms").notNull(),
    confidence: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$real$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["real"])("confidence"),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at", {
        withTimezone: true
    }).defaultNow()
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("transcript_segments_meeting_id_idx").on(table.meetingId)
    ]);
const notes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("notes", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("id").primaryKey().defaultRandom(),
    meetingId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("meeting_id").notNull().unique().references(()=>meetings.id, {
        onDelete: "cascade"
    }),
    /** The user's rough notes — { format: "markdown", markdown } for now. */ rawContent: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$jsonb$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["jsonb"])("raw_content"),
    /** AI-merged notes, same envelope. */ enhancedContent: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$jsonb$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["jsonb"])("enhanced_content"),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at", {
        withTimezone: true
    }).defaultNow()
});
const syncDevices = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("sync_devices", {
    id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$uuid$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uuid"])("id").primaryKey().defaultRandom(),
    tokenHash: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("token_hash").notNull().unique(),
    userId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_id").notNull().references(()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["user"].id, {
        onDelete: "cascade"
    }),
    organizationId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("organization_id").notNull().references(()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"].id, {
        onDelete: "cascade"
    }),
    deviceName: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("device_name").notNull().default("Desktop"),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at", {
        withTimezone: true
    }).defaultNow(),
    lastSeenAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("last_seen_at", {
        withTimezone: true
    })
}, (table)=>[
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$indexes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["index"])("sync_devices_user_id_idx").on(table.userId)
    ]);
const subscriptions = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$table$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pgTable"])("subscriptions", {
    userId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("user_id").primaryKey().references(()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["user"].id, {
        onDelete: "cascade"
    }),
    stripeCustomerId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("stripe_customer_id").unique(),
    stripeSubscriptionId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("stripe_subscription_id").unique(),
    /** Stripe subscription status (trialing/active/past_due/canceled/...). */ status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$text$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["text"])("status").notNull().default("none"),
    currentPeriodEnd: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("current_period_end", {
        withTimezone: true
    }),
    grandfathered: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$boolean$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["boolean"])("grandfathered").notNull().default(false),
    createdAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("created_at", {
        withTimezone: true
    }).defaultNow(),
    updatedAt: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pg$2d$core$2f$columns$2f$timestamp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["timestamp"])("updated_at", {
        withTimezone: true
    }).defaultNow()
});
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:url [external] (node:url, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:url", () => require("node:url"));

module.exports = mod;
}),
"[project]/packages/db/src/client.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "fullSchema",
    ()=>fullSchema,
    "getDb",
    ()=>getDb
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$url__$5b$external$5d$__$28$node$3a$url$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:url [external] (node:url, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f40$electric$2d$sql$2f$pglite__$5b$external$5d$__$2840$electric$2d$sql$2f$pglite$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4$2f$node_modules$2f40$electric$2d$sql$2f$pglite$29$__ = __turbopack_context__.i("[externals]/@electric-sql/pglite [external] (@electric-sql/pglite, esm_import, [project]/node_modules/.pnpm/@electric-sql+pglite@0.5.4/node_modules/@electric-sql/pglite)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$neondatabase$2b$serverless$40$1$2e$1$2e$0$2f$node_modules$2f40$neondatabase$2f$serverless$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@neondatabase+serverless@1.1.0/node_modules/@neondatabase/serverless/index.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$neon$2d$http$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/neon-http/driver.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pglite$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/pglite/driver.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/auth-schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/schema.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$externals$5d2f40$electric$2d$sql$2f$pglite__$5b$external$5d$__$2840$electric$2d$sql$2f$pglite$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4$2f$node_modules$2f40$electric$2d$sql$2f$pglite$29$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pglite$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$externals$5d2f40$electric$2d$sql$2f$pglite__$5b$external$5d$__$2840$electric$2d$sql$2f$pglite$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4$2f$node_modules$2f40$electric$2d$sql$2f$pglite$29$__, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pglite$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
const __TURBOPACK__import$2e$meta__ = {
    get url () {
        return `file://${__turbopack_context__.P("packages/db/src/client.ts")}`;
    },
    get turbopackHot () {
        return __turbopack_context__.m.hot;
    }
};
;
;
;
;
;
;
;
;
const fullSchema = {
    ...__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__,
    ...__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
};
const packageRoot = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].resolve(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].dirname((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$url__$5b$external$5d$__$28$node$3a$url$2c$__cjs$29$__["fileURLToPath"])(__TURBOPACK__import$2e$meta__.url)), "..");
/**
 * The singleton lives on globalThis rather than module scope: bundlers (e.g.
 * Next.js) can include a separate copy of this module per server chunk, and
 * two PGlite instances over the same data directory do not see each other's
 * writes. globalThis is shared per process, so every copy gets the same client.
 */ const globalForDb = globalThis;
function getDb() {
    if (!globalForDb.__repoDbClient) {
        const url = process.env.DATABASE_URL;
        globalForDb.__repoDbClient = url ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$neon$2d$http$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["drizzle"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$neondatabase$2b$serverless$40$1$2e$1$2e$0$2f$node_modules$2f40$neondatabase$2f$serverless$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["neon"])(url), {
            schema: fullSchema
        }) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$pglite$2f$driver$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["drizzle"])(new __TURBOPACK__imported__module__$5b$externals$5d2f40$electric$2d$sql$2f$pglite__$5b$external$5d$__$2840$electric$2d$sql$2f$pglite$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4$2f$node_modules$2f40$electric$2d$sql$2f$pglite$29$__["PGlite"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(packageRoot, ".pglite")), {
            schema: fullSchema
        });
    }
    return globalForDb.__repoDbClient;
}
;
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/packages/db/src/index.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/auth-schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/client.ts [app-route] (ecmascript) <locals>");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
;
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/os [external] (os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("os", () => require("os"));

module.exports = mod;
}),
"[externals]/events [external] (events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("events", () => require("events"));

module.exports = mod;
}),
"[externals]/http [external] (http, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("http", () => require("http"));

module.exports = mod;
}),
"[externals]/https [external] (https, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("https", () => require("https"));

module.exports = mod;
}),
"[project]/apps/web/lib/billing.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "TRIAL_DAYS",
    ()=>TRIAL_DAYS,
    "billingEnabled",
    ()=>billingEnabled,
    "ensureCustomer",
    ()=>ensureCustomer,
    "entitlementFor",
    ()=>entitlementFor,
    "getStripe",
    ()=>getStripe,
    "recordSubscription",
    ()=>recordSubscription
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$stripe$2e$esm$2e$node$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/stripe.esm.node.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/index.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/sql/expressions/conditions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/client.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/schema.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
const TRIAL_DAYS = 15;
let stripeClient = null;
function billingEnabled() {
    return typeof process.env.STRIPE_SECRET_KEY === "string" && process.env.STRIPE_SECRET_KEY.length > 0;
}
function getStripe() {
    if (!stripeClient) {
        if (!billingEnabled()) throw new Error("STRIPE_SECRET_KEY is not set");
        stripeClient = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$stripe$2e$esm$2e$node$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["default"](process.env.STRIPE_SECRET_KEY);
    }
    return stripeClient;
}
/** Statuses Stripe considers "keep serving". past_due gets a grace pass so a
 *  failed card doesn't cut sync mid-retry cycle; Stripe cancels it for us. */ const SERVING_STATUSES = new Set([
    "trialing",
    "active",
    "past_due"
]);
async function entitlementFor(userId) {
    if (!billingEnabled()) return {
        entitled: true,
        reason: "disabled"
    };
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDb"])();
    const rows = await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].userId, userId)).limit(1);
    const sub = rows[0];
    if (!sub) return {
        entitled: false,
        reason: "none"
    };
    if (sub.grandfathered) return {
        entitled: true,
        reason: "grandfathered"
    };
    if (SERVING_STATUSES.has(sub.status)) {
        return {
            entitled: true,
            reason: sub.status,
            ...sub.currentPeriodEnd ? {
                periodEnd: sub.currentPeriodEnd.toISOString()
            } : {}
        };
    }
    return {
        entitled: false,
        reason: sub.status === "none" ? "none" : "lapsed"
    };
}
async function ensureCustomer(userId, email) {
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDb"])();
    const rows = await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].userId, userId)).limit(1);
    const existing = rows[0];
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;
    const customer = await getStripe().customers.create({
        email,
        metadata: {
            doodlenoteUserId: userId
        }
    });
    await db.insert(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"]).values({
        userId,
        stripeCustomerId: customer.id,
        status: "none"
    }).onConflictDoUpdate({
        target: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].userId,
        set: {
            stripeCustomerId: customer.id,
            updatedAt: new Date()
        }
    });
    return customer.id;
}
async function recordSubscription(sub) {
    const userId = sub.metadata?.doodlenoteUserId;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDb"])();
    // Resolve the user: metadata first, customer mapping as fallback.
    let targetUserId = userId;
    if (!targetUserId) {
        const rows = await db.select({
            userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].userId
        }).from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].stripeCustomerId, customerId)).limit(1);
        targetUserId = rows[0]?.userId;
    }
    if (!targetUserId) {
        console.error("[billing] subscription event with unknown user", sub.id);
        return;
    }
    const periodEnd = sub.items.data[0]?.current_period_end;
    await db.insert(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"]).values({
        userId: targetUserId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null
    }).onConflictDoUpdate({
        target: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["subscriptions"].userId,
        set: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            updatedAt: new Date()
        }
    });
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/apps/web/lib/sync-auth.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "authenticateEntitledSyncRequest",
    ()=>authenticateEntitledSyncRequest,
    "authenticateSyncRequest",
    ()=>authenticateSyncRequest,
    "hashToken",
    ()=>hashToken,
    "mintToken",
    ()=>mintToken
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$10_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.10_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/index.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/sql/expressions/conditions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/client.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/auth-schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$billing$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/lib/billing.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$billing$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$billing$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
;
function hashToken(token) {
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createHash"])("sha256").update(token).digest("hex");
}
function mintToken() {
    return `dnsy_${(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomBytes"])(32).toString("hex")}`;
}
async function authenticateSyncRequest(request) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith("dnsy_") || token.length < 40) return null;
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDb"])();
    const rows = await db.select({
        deviceId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].id,
        userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].userId,
        organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].organizationId,
        organizationName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"].name
    }).from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"]).innerJoin(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"], (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$auth$2d$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["organization"].id, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].organizationId)).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].tokenHash, hashToken(token))).limit(1);
    const device = rows[0];
    if (!device) return null;
    // Best-effort liveness stamp; never block the request on it.
    db.update(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"]).set({
        lastSeenAt: new Date()
    }).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["syncDevices"].id, device.deviceId)).catch(()=>{});
    return device;
}
async function authenticateEntitledSyncRequest(request) {
    const device = await authenticateSyncRequest(request);
    if (!device) {
        return {
            response: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$10_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "Invalid sync token"
            }, {
                status: 401
            })
        };
    }
    const entitlement = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$billing$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["entitlementFor"])(device.userId);
    if (!entitlement.entitled) {
        return {
            response: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$10_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing",
                needsSubscription: true
            }, {
                status: 402
            })
        };
    }
    return {
        device
    };
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/apps/web/app/api/sync/pull/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$10_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.10_react-dom@19.2.4_react@19.2.4__react@19.2.4/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/index.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/sql/expressions/conditions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$select$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_@neondatabase+serverless@1.1.0_kysely@0.29.2/node_modules/drizzle-orm/sql/expressions/select.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/db/src/schema.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/db/src/client.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$sync$2d$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/lib/sync-auth.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__,
    __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$sync$2d$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$index$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$sync$2d$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
/** Meetings per page; the desktop loops while hasMore. */ const PAGE_SIZE = 50;
function markdownOf(envelope) {
    if (typeof envelope !== "object" || envelope === null) return null;
    const md = envelope.markdown;
    return typeof md === "string" && md.length > 0 ? md : null;
}
async function GET(request) {
    const authed = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$sync$2d$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["authenticateEntitledSyncRequest"])(request);
    if (authed.response) return authed.response;
    const device = authed.device;
    const url = new URL(request.url);
    const sinceMs = Date.parse(url.searchParams.get("since") ?? "");
    const since = Number.isNaN(sinceMs) ? new Date(0) : new Date(sinceMs);
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getDb"])();
    const idRows = await db.select({
        id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"].id
    }).from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"].organizationId, device.organizationId));
    const allIds = idRows.map((r)=>r.id);
    // Folders are few — the full list ships every pull (renames + deletions).
    const folderRows = await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["folders"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["folders"].organizationId, device.organizationId));
    const allFolders = folderRows.map((f)=>({
            id: f.id,
            name: f.name,
            createdAt: (f.createdAt ?? new Date()).toISOString()
        }));
    const changedRows = await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["and"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["eq"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"].organizationId, device.organizationId), (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["gt"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"].updatedAt, since))).orderBy((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$select$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["asc"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["meetings"].updatedAt)).limit(PAGE_SIZE + 1);
    const page = changedRows.slice(0, PAGE_SIZE);
    const hasMore = changedRows.length > PAGE_SIZE;
    const pageIds = page.map((m)=>m.id);
    const noteRows = pageIds.length ? await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["notes"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["inArray"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["notes"].meetingId, pageIds)) : [];
    const notesByMeeting = new Map(noteRows.map((n)=>[
            n.meetingId,
            n
        ]));
    const segmentRows = pageIds.length ? await db.select().from(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["transcriptSegments"]).where((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$conditions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["inArray"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["transcriptSegments"].meetingId, pageIds)).orderBy((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$drizzle$2d$orm$40$0$2e$45$2e$2_$40$electric$2d$sql$2b$pglite$40$0$2e$5$2e$4_$40$neondatabase$2b$serverless$40$1$2e$1$2e$0_kysely$40$0$2e$29$2e$2$2f$node_modules$2f$drizzle$2d$orm$2f$sql$2f$expressions$2f$select$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["asc"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$db$2f$src$2f$schema$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["transcriptSegments"].startMs)) : [];
    const segmentsByMeeting = new Map();
    for (const seg of segmentRows){
        const list = segmentsByMeeting.get(seg.meetingId) ?? [];
        list.push(seg);
        segmentsByMeeting.set(seg.meetingId, list);
    }
    const changed = page.map((m)=>{
        const note = notesByMeeting.get(m.id);
        return {
            id: m.id,
            title: m.title,
            createdAt: (m.createdAt ?? new Date()).toISOString(),
            updatedAt: (m.updatedAt ?? new Date()).toISOString(),
            ...m.startedAt ? {
                startedAt: m.startedAt.toISOString()
            } : {},
            ...m.endedAt ? {
                endedAt: m.endedAt.toISOString()
            } : {},
            ...m.calendarEventId ? {
                calendarEventId: m.calendarEventId
            } : {},
            ...m.folderId ? {
                folderId: m.folderId
            } : {},
            rawNotesMarkdown: markdownOf(note?.rawContent) ?? "",
            ...markdownOf(note?.enhancedContent) ? {
                enhancedMarkdown: markdownOf(note?.enhancedContent)
            } : {},
            segments: (segmentsByMeeting.get(m.id) ?? []).map((s)=>({
                    channel: s.channel,
                    speaker: s.speaker,
                    text: s.text,
                    startMs: s.startMs,
                    endMs: s.endMs,
                    ...s.confidence !== null ? {
                        confidence: s.confidence
                    } : {}
                }))
        };
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$10_react$2d$dom$40$19$2e$2$2e$4_react$40$19$2e$2$2e$4_$5f$react$40$19$2e$2$2e$4$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        allIds,
        folders: allFolders,
        changed,
        hasMore
    });
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1jt3xtt._.js.map