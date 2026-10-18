import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  SourceContext,
  SourcePassage,
  SourceSearchResult,
} from "./source-contract";
import {
  digest,
  normalizeSearch,
  scanSources,
  searchTerms,
  sourceResult,
} from "./source-projection";

/** Synchronous by design: import/construct ONLY inside the index worker (or tests). */
export class DerivedSourceIndex {
  private db: DatabaseSync;
  readonly file: string;
  constructor(cacheDir: string) {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    this.file = join(cacheDir, "sources-v1.sqlite");
    this.db = this.open();
  }
  private open(): DatabaseSync {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(this.file);
      db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;");
      const check = db.prepare("PRAGMA quick_check").get();
      if (check?.quick_check !== "ok")
        throw Object.assign(new Error("Corrupt derived cache"), {
          errcode: 11,
        });
      db.exec(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, revision TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(key UNINDEXED, text, tokenize='trigram');`);
      return db;
    } catch (error) {
      db?.close();
      const code = (error as { errcode?: number }).errcode;
      if (code !== 11 && code !== 26) throw error;
      // This fixed cache filename is the only deletion target. Originals are never opened for write.
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(this.file + suffix, { force: true });
      const rebuilt = new DatabaseSync(this.file);
      rebuilt.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
        CREATE TABLE documents (id TEXT PRIMARY KEY, revision TEXT NOT NULL);
        CREATE VIRTUAL TABLE passages USING fts5(key UNINDEXED, text, tokenize='trigram');`);
      return rebuilt;
    }
  }
  search(
    context: SourceContext,
    query: string,
    limit = 50,
    generation = 0,
    checkpoint: () => void = () => {},
  ): SourceSearchResult {
    const terms = searchTerms(query);
    const snapshot = scanSources(context, checkpoint);
    const scopeKey = digest(JSON.stringify(context.scope));
    const current = new Map(snapshot.documents.map((d) => [d.meetingId, d]));
    // The cache belongs to exactly one scope per transaction; a scope change clears prior rows.
    const old = this.db.prepare("SELECT id, revision FROM documents").all();
    checkpoint();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of old) {
        const doc = current.get(String(row.id));
        if (!doc || row.revision !== `${scopeKey}:${doc.revisionId}`) {
          this.db
            .prepare("DELETE FROM passages WHERE key LIKE ? ESCAPE '\\'")
            .run(`${row.id}:%`);
          this.db
            .prepare("DELETE FROM documents WHERE id=?")
            .run(String(row.id));
        }
      }
      const insert = this.db.prepare(
        "INSERT INTO passages(key,text) VALUES (?,?)",
      );
      for (const doc of snapshot.documents) {
        checkpoint();
        if (
          this.db
            .prepare("SELECT 1 FROM documents WHERE id=?")
            .get(doc.meetingId)
        )
          continue;
        for (const p of doc.passages)
          insert.run(
            `${doc.meetingId}:${p.anchor.sourceId}`,
            normalizeSearch(p.text),
          );
        this.db
          .prepare("INSERT INTO documents VALUES (?,?)")
          .run(doc.meetingId, `${scopeKey}:${doc.revisionId}`);
      }
      checkpoint();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const candidates = terms.filter(
      (t) => [...t].length >= 3 && !t.includes("\0"),
    );
    // Trigram accelerates substring search; short terms use the same literal predicate below.
    const rows = candidates.length
      ? this.db
          .prepare("SELECT key FROM passages WHERE passages MATCH ?")
          .all(
            candidates.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND "),
          )
      : this.db.prepare("SELECT key FROM passages").all();
    const keys = new Set(rows.map((r) => String(r.key)));
    const hits: SourcePassage[] = terms.length
      ? snapshot.documents
          .flatMap((d) => d.passages)
          .filter(
            (p) =>
              keys.has(`${p.anchor.meetingId}:${p.anchor.sourceId}`) &&
              terms.every((t) => normalizeSearch(p.text).includes(t)),
          )
      : [];
    return sourceResult(snapshot, context, generation, hits, limit);
  }
  close(): void {
    this.db.close();
  }
}
