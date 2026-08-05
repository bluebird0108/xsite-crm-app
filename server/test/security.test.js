const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeWrite, hasKnownFilter } = require("../write-policy");
const { rateLimit, resetRateLimits } = require("../rate-limit");
const { isAllowedDocumentKey } = require("../storage-policy");

test("profile fields cannot pass through the generic update endpoint", () => {
  assert.throws(() => sanitizeWrite("profiles", "update", "admin", { role: "owner" }), /cannot be updated/);
});

test("agent cannot change submission workflow fields", () => {
  assert.throws(() => sanitizeWrite("deal_submissions", "update", "agent", { status: "converted" }), /cannot be updated/);
  assert.deepEqual(sanitizeWrite("deal_submissions", "update", "agent", { notes: "Updated" }), { notes: "Updated" });
});

test("server-owned insert fields are rejected", () => {
  assert.throws(() => sanitizeWrite("agent_requests", "insert", "agent", { status: "approved" }), /cannot be inserted/);
});

test("updates require at least one real table filter", () => {
  const columns = new Set(["id", "status"]);
  assert.equal(hasKnownFilter({}, columns), false);
  assert.equal(hasKnownFilter({ unknown: "x" }, columns), false);
  assert.equal(hasKnownFilter({ id: "abc" }, columns), true);
});

test("rate limiter blocks requests over the configured maximum", () => {
  resetRateLimits();
  const middleware = rateLimit({ windowMs: 60_000, max: 2, key: () => "test" });
  const statuses = [];
  const makeRes = () => ({
    set() {},
    status(code) { statuses.push(code); return this; },
    json(body) { this.body = body; return this; },
  });
  let passed = 0;
  middleware({}, makeRes(), () => { passed += 1; });
  middleware({}, makeRes(), () => { passed += 1; });
  middleware({}, makeRes(), () => { passed += 1; });
  assert.equal(passed, 2);
  assert.deepEqual(statuses, [429]);
});

test("document storage accepts categorized UUID paths only", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const file = "123e4567-e89b-42d3-a456-426614174001-contract.pdf";
  assert.equal(isAllowedDocumentKey(`contracts/${id}/${file}`), true);
  assert.equal(isAllowedDocumentKey(`invoices-receipts/submissions/${id}/${file}`), true);
  assert.equal(isAllowedDocumentKey(`kyc-and-ids/${id}/${file}`), true);
  assert.equal(isAllowedDocumentKey(`../../root/${file}`), false);
  assert.equal(isAllowedDocumentKey(`${id}/${file}`), false);
});
