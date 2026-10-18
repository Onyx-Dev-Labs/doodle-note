import { normalizeEvidenceFilters } from '@repo/meetings-store/evidence';
import type { CensusRequest } from '@repo/meetings-store/evidence-contract';
import {
  AGENT_SCHEMA_VERSION,
  AgentToolError,
  type AgentToolDef,
} from "@repo/agent-contract";
import type { SourceAnchor } from "@repo/meetings-store/source-contract";
import { LocalMeetingSource } from "./local-source";

/** Local-only additive tools. Cloud tool registration and policy are unchanged. */
export const LOCAL_SOURCE_TOOLS: AgentToolDef[] = [
  {
    name: "search_meeting_sources",
    description:
      "Search full eligible local history offline. Returns original passage anchors, exact matched counts, coverage and truncation. Does not require a summary or the desktop to be running. Terms are case/diacritic-insensitive literal substrings within a passage; all terms must match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 4096 },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async run(source, args) {
      if (!(source instanceof LocalMeetingSource))
        throw new AgentToolError("Local source retrieval unavailable");
      if (typeof args.query !== "string" || args.query.length > 4096)
        throw new AgentToolError(
          "query must be a string of at most 4096 characters",
        );
      const limit = args.limit ?? 50;
      if (
        typeof limit !== "number" ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1000
      )
        throw new AgentToolError("limit must be between 1 and 1000");
      return {
        schema_version: AGENT_SCHEMA_VERSION,
        ...(await source.retrieveSources(args.query, limit)),
      };
    },
  },
  {
    name: "resolve_meeting_source",
    description:
      "Reread an original passage by the exact anchor returned from search_meeting_sources. Explicitly reports resolved, stale, missing, unauthorized or unavailable; never substitutes a different revision.",
    inputSchema: {
      type: "object",
      properties: {
        anchor: {
          type: "object",
          properties: {
            version: { const: 1 },
            libraryId: { type: "string" },
            accountId: { type: ["string", "null"] },
            workspaceId: { type: ["string", "null"] },
            meetingId: { type: "string" },
            revisionId: { type: "string" },
            sourceId: { type: "string" },
            kind: { enum: ["title", "personal", "transcript", "summary"] },
          },
          required: [
            "version",
            "libraryId",
            "accountId",
            "workspaceId",
            "meetingId",
            "revisionId",
            "sourceId",
            "kind",
          ],
        },
      },
      required: ["anchor"],
    },
    async run(source, args) {
      if (!(source instanceof LocalMeetingSource))
        throw new AgentToolError("Local source retrieval unavailable");
      if (!args.anchor || typeof args.anchor !== "object")
        throw new AgentToolError("anchor must be an original source anchor");
      return {
        schema_version: AGENT_SCHEMA_VERSION,
        ...(await source.resolveSource(args.anchor as SourceAnchor)),
      };
    },
  },
];

const filtersSchema = { type: 'object', properties: { folderId: {type:'string'}, dateFrom: {type:'string'}, dateBefore: {type:'string'} }, additionalProperties:false };
LOCAL_SOURCE_TOOLS.push({
  name: 'retrieve_meeting_evidence',
  description: 'Retrieve bounded original personal/transcript ranges for a question from the full eligible local library. Reports scan, selection and lexical coverage separately; examples are not an exact total. No model generation.',
  inputSchema: {type:'object',properties:{question:{type:'string',maxLength:4096},filters:filtersSchema},required:['question'],additionalProperties:false},
  async run(source,args) {
    if (!(source instanceof LocalMeetingSource) || Object.keys(args).some(k=>!['question','filters'].includes(k)) || typeof args.question !== 'string') throw new AgentToolError('Invalid local evidence request');
    return {schema_version:AGENT_SCHEMA_VERSION,...await source.retrieveEvidence({mode:'question',question:args.question,filters:normalizeEvidenceFilters(args.filters??{})})};
  }
}, {
  name: 'count_meeting_sources',
  description: 'Count eligible meetings or original passages matching ALL literal terms. Not a semantic task/decision count. Incomplete scans are observed lower bounds; lists show at most 100 meetings.',
  inputSchema: {type:'object',properties:{filters:filtersSchema,predicate:{oneOf:[{type:'object',properties:{kind:{const:'eligible'}},required:['kind'],additionalProperties:false},{type:'object',properties:{kind:{const:'literal'},text:{type:'string',maxLength:4096}},required:['kind','text'],additionalProperties:false}]}},required:['predicate'],additionalProperties:false},
  async run(source,args) {
    if (!(source instanceof LocalMeetingSource) || Object.keys(args).some(k=>!['predicate','filters'].includes(k))) throw new AgentToolError('Invalid local census request');
    return {schema_version:AGENT_SCHEMA_VERSION,...await source.census({filters:normalizeEvidenceFilters(args.filters??{}),predicate:args.predicate as CensusRequest['predicate']})};
  }
});
