"""Liaison prototype backend (standard library only, no pip install needed).

- Serves the prototype files (index.html, app.js, ...).
- POST /api/itinerary : the ONE real AI step (itinerary generation) -> Claude.
- POST /api/log       : records user clicks (accept / reject / etc.) in the same log.
- GET  /api/config    : tells the page whether to use the real AI or simulated responses.

Settings live in config.json. The API key lives in .env (never shared).
Log file: logs/ai_log.jsonl (one JSON object per line).
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(ROOT, "logs", "ai_log.jsonl")
SLOTS = ["Morning", "Afternoon", "Evening"]


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config():  # re-read each request so config edits apply without restart
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        return json.load(f)


def write_log(kind, **data):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    rec = {"time": datetime.now(timezone.utc).isoformat(timespec="seconds"), "kind": kind, **data}
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


SYSTEM_PROMPT = """You are the itinerary engine of Liaison, an AI group trip planner. \
You receive a trip description and the confirmed profile of every traveler, and you produce ONE day-by-day itinerary that balances the whole group.

Rules:
1. HARD constraints (allergies, diet rules, mobility limits, budget, dates) must NEVER be violated for any traveler. \
Every traveler eats together, so every meal must satisfy the union of all diet/allergy constraints. \
Respect mobility limits for the least mobile traveler (e.g. someone who needs rest after 30 minutes of walking: no long walking tours, no steep hikes; prefer seated or short activities).
2. If a profile field is missing or unclear (e.g. allergies "not specified"), do not assume it is safe: choose options that are low-risk and say so in the item text (e.g. "ask venue about allergens").
3. SOFT preferences (interests, dislikes) should be balanced fairly: over the trip, every traveler should see something they love, and nobody's dislikes should dominate. Do not let the organizer's tastes win by default.
4. Use real, well-known places in the destinations named in the trip. Do not invent specific prices, opening hours or reservation confirmations. Only claim a dietary or accessibility feature (e.g. "pork-free options") if it is plausible for that type of venue, and phrase it as an option, not a guarantee.
5. Cover every day of the trip, with exactly three items per day: Morning, Afternoon, Evening. Day 1 starts with arrival; the last day ends with departure.
6. Keep each item to one concise sentence.

Output ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:
{"days":[{"day":1,"city":"Venice","hotel":"Hotel name (or empty string if not a check-in day)","items":[{"slot":"Morning","text":"..."},{"slot":"Afternoon","text":"..."},{"slot":"Evening","text":"..."}]}]}"""


def build_user_prompt(payload):
    lines = ["TRIP DESCRIPTION (from organizer):", payload.get("trip", ""), ""]
    if payload.get("summary"):
        lines += ["TRIP SUMMARY (as understood by the app):", json.dumps(payload["summary"], ensure_ascii=False), ""]
    lines.append("TRAVELERS (confirmed profiles):")
    for t in payload.get("travelers", []):
        p = t.get("profile", {})
        lines.append(f"\n--- {t.get('name')} ---")
        lines.append("Own words: " + (t.get("text") or "(none)"))
        for field in ["Age", "Interests", "Dislikes", "Mobility", "Diet", "Allergies", "Budget"]:
            vals = p.get(field) or []
            lines.append(f"{field}: " + ("; ".join(vals) if vals else "NOT SPECIFIED"))
        lines.append("HARD constraints: " + ("; ".join(p.get("hard") or []) or "none stated"))
        for c in t.get("clarifications", []):
            lines.append(f"Clarification - Q: {c.get('question')} A: {c.get('answer')}")
    lines.append("\nGenerate the itinerary JSON now.")
    return "\n".join(lines)


# ---------- Lab 8 fix: focused safety check after generation ----------
# Why: in testing, the itinerary model knew (when asked directly) that sfogliatella dough uses lard or that
# Alfama is steep, but still slipped such items in while writing ~30 items at once, next to "no pork"/"flat"
# labels. A second, narrow call that ONLY checks items against each traveler's own words catches these.
CHECK_PROMPT = """You are the safety checker of Liaison, an AI group trip planner. \
You receive every traveler's own words and structured profile, and a generated itinerary (one line per item, each with an id). \
Your ONLY job is to find items that may conflict with a traveler's food or mobility limits. You do not rewrite the plan.

Check every item against every traveler:
1. Read each traveler's OWN WORDS, not only the structured fields. Structured fields can be incomplete: "NOT SPECIFIED" or "none stated" does not mean there is no limit.
2. Limits to check: diet and religious food rules (pork, red meat, halal, vegan, vegetarian...), alcohol, allergies, and mobility or walking limits (rest after N minutes, bad knee, stairs, hills). Include limits stated softly ("I try not to eat pork"). Ignore interests and likes/dislikes.
3. Look for HIDDEN conflicts that the item text does not mention: traditional ingredients of named dishes, pastries and sauces (lard or pork fat in doughs and pastries, meat in ragù, pork in stocks and soups, cured meats, wine or liqueur in cooking and desserts, nuts), and the real terrain of named places (hills, stairs, steep lanes, gravel, uneven or rutted ground, long distances), even when the item calls it "flat", "gentle", "easy" or "pork-free".
4. Assume every traveler takes part in an item unless it clearly says it is optional or a split with an alternative for that traveler.
5. Do NOT flag an item that already names and handles that specific conflict (e.g. "ask whether the sfogliatelle are made with lard", "by taxi, seen from the vehicle"). A generic "ask about allergens" does NOT handle a specific known ingredient.
6. Be precise. Flag only real, specific risks a careful local expert would point out; don't flag every meal just in case. If unsure, say "may".

For each flagged item, write one short sentence for the traveler: who is affected, what the specific conflict is, and what to check or ask.

Output ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:
{"flags":[{"id":"d10-0","travelers":["Dad"],"reason":"..."}]}
Use {"flags":[]} if nothing conflicts."""


def build_check_prompt(payload, items):
    travelers = build_user_prompt(payload).split("TRAVELERS (confirmed profiles):", 1)[-1]
    travelers = travelers.replace("\nGenerate the itinerary JSON now.", "")
    lines = ["TRAVELERS (confirmed profiles):" + travelers, "", "ITINERARY TO CHECK:"]
    lines += [f"[{it['id']}] Day {it['day']} {it['city']} {it['slot']}: {it['text']}" for it in items]
    lines.append("\nReturn the flags JSON now.")
    return "\n".join(lines)


def check_itinerary(cfg, payload, items):
    """Second, focused AI call. Adds item["warning"] to risky items. Returns (number flagged, log details)."""
    check_cfg = {**cfg, "model": cfg.get("check_model") or cfg["model"], "max_tokens": cfg.get("check_max_tokens", 4000)}
    user = build_check_prompt(payload, items)
    started = time.time()
    raw, resp = call_claude(check_cfg, CHECK_PROMPT, user)
    t = raw.strip()
    data = json.loads(t[t.find("{"): t.rfind("}") + 1])
    by_id = {it["id"]: it for it in items}
    flags = [f for f in data.get("flags", []) if f.get("id") in by_id]
    for f in flags:
        who = ", ".join(f.get("travelers") or [])
        by_id[f["id"]]["warning"] = (f"{who}: " if who else "") + str(f.get("reason", "")).strip()
    details = dict(model=check_cfg["model"], seconds=round(time.time() - started, 1), system_prompt=CHECK_PROMPT,
                   user_prompt=user, output_raw=raw, flags=flags, usage=resp.get("usage"))
    return len(flags), details


def call_claude(cfg, system, user):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing. Copy .env.example to .env and paste your key (see README).")
    body = json.dumps({
        "model": cfg["model"], "max_tokens": cfg["max_tokens"], "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=cfg.get("timeout_seconds", 120)) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Anthropic API error {e.code}: {e.read().decode(errors='replace')[:500]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach Anthropic API: {e.reason}")
    text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
    return text, resp


def parse_itinerary(text):
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):]
    data = json.loads(t[t.find("{"): t.rfind("}") + 1])
    items = []
    days = data["days"]
    if not days:
        raise ValueError("model returned no days")
    for d in days:
        n, city = int(d["day"]), str(d["city"])
        hotel = str(d.get("hotel") or "")
        for k, it in enumerate(d["items"]):
            slot = str(it["slot"])
            items.append({"id": f"d{n}-{k}", "slot": slot, "text": str(it["text"]), "day": n, "city": city, "hotel": hotel})
    return items


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass  # keep terminal quiet

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")

    def do_GET(self):
        if self.path.split("?")[0] == "/api/config":
            cfg = load_config()
            return self._json(200, {"mode": cfg.get("mode", "simulated"), "model": cfg.get("model")})
        # Public deployment: only serve the files the app needs (not .env, logs, config, test notes...)
        if self.path.split("?")[0] not in ("/", "/index.html", "/app.js", "/simulated_responses.json"):
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            payload = self._body()
        except Exception:
            return self._json(400, {"error": "bad JSON"})
        if path == "/api/log":
            write_log("user_action", message=str(payload.get("message", ""))[:2000])
            return self._json(200, {"ok": True})
        if path == "/api/itinerary":
            cfg = load_config()
            user = build_user_prompt(payload)
            started = time.time()
            raw = None
            try:
                raw, resp = call_claude(cfg, SYSTEM_PROMPT, user)
                items = parse_itinerary(raw)
                write_log("itinerary_generation", model=cfg["model"], seconds=round(time.time() - started, 1),
                          input_payload=payload, system_prompt=SYSTEM_PROMPT, user_prompt=user,
                          output_raw=raw, output_items=items, usage=resp.get("usage"), confidence=None)
                check = {"ran": False, "flagged": 0, "error": None}
                if cfg.get("check_enabled", True):  # Lab 8 fix; set "check_enabled": false in config.json to turn off
                    try:
                        n, details = check_itinerary(cfg, payload, items)
                        check.update(ran=True, flagged=n)
                        write_log("itinerary_check", **details)
                    except Exception as e:  # never block the itinerary if the check fails
                        check["error"] = str(e)
                        write_log("itinerary_check_error", model=cfg.get("check_model") or cfg.get("model"), error=str(e))
                return self._json(200, {"items": items, "model": cfg["model"], "check": check})
            except Exception as e:
                write_log("itinerary_generation_error", model=cfg.get("model"), error=str(e),
                          input_payload=payload, user_prompt=user, output_raw=raw)
                return self._json(502, {"error": str(e)})
        self._json(404, {"error": "not found"})


if __name__ == "__main__":
    load_env()
    cfg = load_config()
    port = int(os.environ.get("PORT", cfg.get("port", 8000)))
    have_key = bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())
    print(f"Liaison running at http://localhost:{port}")
    print(f"Mode: {cfg['mode']} | model: {cfg['model']} | API key found: {have_key}")
    if cfg["mode"] == "real" and not have_key:
        print("WARNING: no ANTHROPIC_API_KEY in .env, itinerary generation will fail. See README.")
    print(f"Log file: {LOG_PATH}")
    # Cloud hosts set PORT and need 0.0.0.0; locally stay on 127.0.0.1 only.
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    ThreadingHTTPServer((host, port), Handler).serve_forever()
