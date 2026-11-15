// Automatic theme schedule across NZ daylight-saving boundaries (spec section 11 dates):
// DST starts Sun 27 Sep 2026 (02:00 NZST -> 03:00 NZDT), ends Sun 4 Apr 2027 (03:00 NZDT -> 02:00 NZST).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";
import { MAX_WAIT_MS, localMinutes, msUntilNextBoundary, resolveTheme, scheduledTheme, type ThemePref } from "../../apps/web/src/lib/theme-core.ts";

const at = (iso: string) => new Date(iso);

describe("scheduledTheme in Pacific/Auckland", () => {
  it("NZST (UTC+12), before DST starts: 09:00 is light, 08:59 is dark", () => {
    assert.equal(localMinutes(at("2026-09-25T21:00:00Z")), 9 * 60);
    assert.equal(scheduledTheme(at("2026-09-25T21:00:00Z")), "light");
    assert.equal(scheduledTheme(at("2026-09-25T20:59:00Z")), "dark");
  });

  it("on the DST start day itself (27 Sep 2026), 09:00 NZDT is 20:00Z the previous day", () => {
    assert.equal(scheduledTheme(at("2026-09-26T20:00:00Z")), "light");
    assert.equal(scheduledTheme(at("2026-09-26T19:59:00Z")), "dark");
  });

  it("NZDT (UTC+13): light at 09:00, dark from 18:30", () => {
    assert.equal(scheduledTheme(at("2026-09-27T20:00:00Z")), "light"); // 09:00 Mon 28 Sep NZDT
    assert.equal(scheduledTheme(at("2026-09-28T05:29:00Z")), "light"); // 18:29
    assert.equal(scheduledTheme(at("2026-09-28T05:30:00Z")), "dark"); // 18:30
  });

  it("after DST ends (4 Apr 2027), back to UTC+12", () => {
    assert.equal(scheduledTheme(at("2027-04-04T21:00:00Z")), "light"); // 09:00 Mon 5 Apr NZST
    assert.equal(scheduledTheme(at("2027-04-04T20:59:00Z")), "dark");
    assert.equal(scheduledTheme(at("2027-04-05T06:30:00Z")), "dark"); // 18:30 NZST
  });

  it("manual preferences ignore the clock", () => {
    for (const iso of ["2026-09-28T05:30:00Z", "2026-09-27T20:00:00Z"]) {
      assert.equal(resolveTheme("light", at(iso)), "light");
      assert.equal(resolveTheme("dark", at(iso)), "dark");
    }
  });
});

describe("msUntilNextBoundary", () => {
  it("counts down to 18:30 during the day (capped at 30 minutes)", () => {
    assert.equal(msUntilNextBoundary(at("2026-09-28T05:10:00Z")), 20 * 60_000); // 18:10 -> 18:30
    assert.equal(msUntilNextBoundary(at("2026-09-27T21:00:00Z")), MAX_WAIT_MS); // 10:00, far from a boundary
  });

  it("never waits more than 30 minutes, so a DST jump overnight can't leave the theme stale", () => {
    for (let h = 0; h < 24; h++) {
      const ms = msUntilNextBoundary(at(`2026-09-26T${String(h).padStart(2, "0")}:17:42Z`));
      assert.ok(ms >= 1000 && ms <= MAX_WAIT_MS, `hour ${h}: ${ms}`);
    }
  });

  it("subtracts seconds so the switch lands on the minute", () => {
    assert.equal(msUntilNextBoundary(at("2026-09-28T05:29:30.250Z")), 29_750);
  });
});

describe("public/theme-init.js matches resolveTheme (no flash of the wrong theme)", () => {
  const src = readFileSync("apps/web/public/theme-init.js", "utf8");

  function runInit(iso: string, stored: string | null): string | null {
    let applied: string | null = null;
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length) super(...(args as [string]));
        else super(iso);
      }
    }
    const context = {
      Date: FixedDate,
      Intl,
      Number,
      localStorage: { getItem: () => stored },
      document: {
        documentElement: { setAttribute: (_: string, v: string) => (applied = v) },
        querySelector: () => null,
      },
    };
    vm.runInNewContext(src, context);
    return applied;
  }

  const times = ["2026-09-25T20:59:00Z", "2026-09-25T21:00:00Z", "2026-09-26T20:00:00Z", "2026-09-28T05:29:00Z", "2026-09-28T05:30:00Z", "2027-04-04T20:59:00Z", "2027-04-04T21:00:00Z"];
  for (const iso of times) {
    for (const pref of ["auto", "light", "dark"] as ThemePref[]) {
      it(`${iso} · ${pref}`, () => assert.equal(runInit(iso, pref), resolveTheme(pref, at(iso))));
    }
  }

  it("treats a missing or junk stored value as automatic", () => {
    assert.equal(runInit("2026-09-28T05:30:00Z", null), "dark");
    assert.equal(runInit("2026-09-27T20:00:00Z", "purple"), "light");
  });
});
