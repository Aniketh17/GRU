import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_BASE_LOCK, CLIENT_MAX_LOCK, GLOBAL_LOCK, clientBucketKey, lockRemaining, nextClient, nextGlobal, type Bucket,
} from "../../apps/worker/src/auth/ratelimit.ts";

const fresh = (bucket: string): Bucket => ({ bucket, fails: 0, window_start: 0, locked_until: 0, strikes: 0 });
const T0 = 1_800_000_000;

function failN(b: Bucket, n: number, now: number, step = nextClient): Bucket {
  for (let i = 0; i < n; i++) b = step(b, now);
  return b;
}

describe("client bucket (D-019)", () => {
  it("locks for 15 minutes after 5 failures inside the window", () => {
    const b = failN(fresh("c:x"), 5, T0);
    assert.equal(b.locked_until, T0 + CLIENT_BASE_LOCK);
    assert.equal(b.strikes, 1);
  });

  it("4 failures do not lock", () => {
    assert.equal(failN(fresh("c:x"), 4, T0).locked_until, 0);
  });

  it("does not lock if failures are spread beyond the window", () => {
    const b = nextClient(failN(fresh("c:x"), 4, T0), T0 + 16 * 60);
    assert.equal(b.locked_until, 0);
    assert.equal(b.fails, 1);
  });

  it("doubles the lock on repeat strikes, capped at 24 h", () => {
    let b = fresh("c:x");
    let now = T0;
    const locks: number[] = [];
    for (let i = 0; i < 9; i++) {
      b = failN(b, 5, now);
      locks.push(b.locked_until - now);
      now = b.locked_until + 1;
    }
    assert.deepEqual(locks.slice(0, 4), [900, 1800, 3600, 7200]);
    assert.equal(Math.max(...locks), CLIENT_MAX_LOCK);
  });

  it("forgets strikes after a quiet day", () => {
    const b = failN(fresh("c:x"), 5, T0);
    assert.equal(failN(b, 5, b.locked_until + 25 * 3600).strikes, 1);
  });
});

describe("global bucket", () => {
  it("locks every login for an hour after 20 failures in an hour", () => {
    const g = failN(fresh("global"), 20, T0, nextGlobal);
    assert.equal(g.locked_until, T0 + GLOBAL_LOCK);
    assert.equal(lockRemaining({ client: fresh("c:new"), global: g }, T0 + 10), GLOBAL_LOCK - 10);
  });

  it("19 failures do not lock", () => {
    assert.equal(failN(fresh("global"), 19, T0, nextGlobal).locked_until, 0);
  });
});

describe("client bucket key", () => {
  it("is an HMAC of the IP, never the raw IP, and differs per IP and per secret", async () => {
    const a = await clientBucketKey("secret-1", "203.0.113.5");
    assert.match(a, /^c:[A-Za-z0-9_-]{22}$/);
    assert.ok(!a.includes("203.0.113.5"));
    assert.notEqual(a, await clientBucketKey("secret-1", "203.0.113.6"));
    assert.notEqual(a, await clientBucketKey("secret-2", "203.0.113.5"));
    assert.equal(a, await clientBucketKey("secret-1", "203.0.113.5"));
  });
});
