// Recompute the ledger hash in the browser and compare it with the one printed on the page.
// The hash covers the same fields, in the same canonical form, as tools/pencil_ledger.py content_hash().
(function () {
  "use strict";
  var CORE = ["schema", "subject", "owner", "recipients", "stage", "as_of", "profiles", "entries", "alignments"];

  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canon(v[k]);
    }).join(",") + "}";
  }

  async function ledgerHash(ledger) {
    var core = {};
    CORE.forEach(function (k) { core[k] = ledger[k] === undefined ? null : ledger[k]; });
    var bytes = new TextEncoder().encode(canon(core));
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { canon: canon, ledgerHash: ledgerHash }; }
  if (typeof document === "undefined") return;

  var btn = document.getElementById("verify");
  var out = document.getElementById("verify-result");
  var shown = document.getElementById("hash");
  if (!btn || !out || !shown) return;

  btn.addEventListener("click", async function () {
    out.className = ""; out.textContent = "Checking…";
    try {
      var res = await fetch("ledger.json", { cache: "no-store" });
      if (!res.ok) throw new Error("could not download ledger.json");
      var h = await ledgerHash(await res.json());
      if (h === shown.textContent.trim()) {
        out.className = "pass"; out.textContent = "Match. The ledger file produces the hash printed on this page.";
      } else {
        out.className = "fail"; out.textContent = "No match. The ledger file produces " + h + ". Do not rely on this page.";
      }
    } catch (err) {
      out.className = "fail"; out.textContent = "Could not verify: " + err.message + ".";
    }
  });
})();
