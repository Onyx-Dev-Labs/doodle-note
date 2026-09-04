import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isMultiRangeRequest,
  updateProxyRequestHeaders,
  updateProxyResponseInit,
} from "../lib/update-proxy";

test("update proxy identifies unsupported combined range requests", () => {
  assert.equal(isMultiRangeRequest(null), false);
  assert.equal(isMultiRangeRequest("bytes=0-0"), false);
  assert.equal(isMultiRangeRequest("bytes=0-0,2-2"), true);
});

test("update proxy preserves byte-range requests and partial responses", () => {
  const request = new Request("https://www.doodlenote.ai/updates/setup.exe", {
    headers: { range: "bytes=0-0" },
  });

  assert.equal(updateProxyRequestHeaders(request).get("range"), "bytes=0-0");

  const upstream = new Response(new Uint8Array([0]), {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-length": "1",
      "content-range": "bytes 0-0/178818312",
      "content-type": "application/octet-stream",
    },
  });
  const response = updateProxyResponseInit("setup.exe", upstream);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "1");
  assert.equal(response.headers.get("content-range"), "bytes 0-0/178818312");
});
