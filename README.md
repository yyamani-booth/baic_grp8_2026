# Liaison prototype (itinerary generation connected to Claude)

Only one AI step is real: **itinerary generation** (Step 3 -> Step 4). It sends the trip description and every
confirmed traveler profile to Claude and shows the returned day-by-day plan. Trip summary, profile parsing and
revision after a rejection are still simulated (`simulated_responses.json`).

## Set up (about 5 minutes)

You need **Python 3** (already on most Macs; check with `python3 --version`). No packages to install.

1. Get your own API key: https://console.anthropic.com -> add a few dollars of credits (Billing) -> API Keys -> Create key.
   (Credits are separate from a Claude.ai subscription.)
2. In this folder, copy `.env.example` to `.env`:  `cp .env.example .env`
3. Open `.env` in a text editor and paste your key after `ANTHROPIC_API_KEY=`. Save. **Never share this file or the key.**
4. Start the app:  `python3 server.py`
5. Open http://localhost:8000 in your browser. (The terminal prints "API key found: True" if step 3 worked.)

## Happy path
1. Step 1: click **Use example input** -> Continue.
2. Step 2: click **Copy invite link**, then **Simulate: someone opens the link** a couple of times (or add emails). Continue.
3. Step 3: for each traveler tab click **Fill example text** -> **Build my profile** -> **Confirm profile**.
4. Click **Generate itinerary**. The real call takes roughly 10 to 60 seconds. The header should read "itinerary: real AI (...)".

## Safety check (added in Lab 8)
After the itinerary is generated, a second, focused AI call checks every item against each traveler's own words
(diet, alcohol, allergies, mobility, including hidden ingredients like lard in pastries and real terrain like hills or stairs).
Risky items get a red "⚠ Check this: ..." box, and Step 4 shows how many items were flagged. This adds roughly 15-20 seconds.
- Turn it off/on: `"check_enabled": false` / `true` in `config.json` (no restart needed).
- Logged in `logs/ai_log.jsonl` as `itinerary_check` (or `itinerary_check_error`; the itinerary still shows if the check fails).
- **After updating to a new version, hard-refresh the page (Cmd+Shift+R) or use a new private window**, or the browser keeps the old version and you won't see the warnings.
- Lab 8 test results and evidence: `lab8_failure_log.md`. Test inputs: `test_cases.md`.

## Switching things
All in `config.json` (no restart needed):
- `"mode"`: `"real"` or `"simulated"` (go back to canned responses).
- `"model"`: e.g. `claude-sonnet-5-5` (default), `claude-haiku-5-5` (cheaper/faster), `claude-opus-5-5` (strongest).
- Quick one-off: open http://localhost:8000/?sim=1 to force simulated responses.
- The model call is the single function `call_claude()` in `server.py`; the prompt is `SYSTEM_PROMPT` in the same file.

## Log
`logs/ai_log.jsonl`, one JSON line per event, easy to read with any text editor:
- `itinerary_generation`: full input payload, instructions + prompt sent, raw model output, parsed items, token usage, seconds.
  (Claude gives no confidence score; `confidence` is `null`.)
- `itinerary_generation_error`: what failed and the input that caused it.
- `itinerary_check`: the safety check's prompt, raw output, flagged items with reasons, token usage, seconds.
- `user_action`: every accept / reject (with reason) click and other on-screen log lines.

## Known limits (not fixed yet, on purpose)
- The safety check catches most hidden conflicts but not all (in testing it sometimes missed uneven sites described with "rest breaks"), and it can't verify venue details. Check outputs during testing.
- Revisions after a rejection use the simulated generic replacement, not Claude.
- The log contains traveler text; it stays on your laptop (`logs/` is not included in the shared zip).
