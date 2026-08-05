const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeWrite, hasKnownFilter } = require("../write-policy");
const { rateLimit, resetRateLimits } = require("../rate-limit");

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
