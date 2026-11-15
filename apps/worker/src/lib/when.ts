// Auckland wall-clock to UTC epoch seconds, DST-safe (same method as the web app's voice parser).
const TZ = "Pacific/Auckland";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const offsetMs = (ms: number): number => {
  const p = fmt.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
};

export function aucklandToEpoch(y: number, m: number, d: number, h: number, min: number): number {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - offsetMs(guess);
  return Math.floor(guess / 1000);
}
