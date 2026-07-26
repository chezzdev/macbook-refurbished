import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "../scripts/html-escape.mjs";

test("escapes untrusted catalog text before client-side HTML rendering", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('catalog')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;catalog&#39;)&quot;&gt;&amp;",
  );
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(24), "24");
});
