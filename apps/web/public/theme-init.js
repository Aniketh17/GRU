// Runs synchronously in <head> before first paint, so GRU never flashes the wrong theme.
// Must stay an external file: the CSP forbids inline scripts. Mirrors resolveTheme() in
// src/lib/theme.ts (a unit test checks they agree across NZ daylight-saving boundaries).
(function () {
  var pref = "auto";
  try {
    var v = localStorage.getItem("gru.theme");
    if (v === "light" || v === "dark" || v === "auto") pref = v;
  } catch {
    /* storage blocked (private mode): fall back to automatic */
  }
  var theme = pref;
  if (pref === "auto") {
    var h = 0, m = 0;
    try {
      var parts = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "hour") h = Number(parts[i].value) % 24;
        else if (parts[i].type === "minute") m = Number(parts[i].value);
      }
    } catch {
      var d = new Date();
      h = d.getHours();
      m = d.getMinutes();
    }
    var mins = h * 60 + m;
    theme = mins >= 540 && mins < 1110 ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1113" : "#f5f5f2");
})();
