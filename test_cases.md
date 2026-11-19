# Liaison: 5 test cases for itinerary generation (Lab 8, Step 8)

Group 8 · AI step under test: **trip description + confirmed traveler profiles → day-by-day itinerary** (Step 3 → Step 4).
Cases 4 and 5 are the two failure scenarios from Assignment 4 (§2 Verification: "a missed allergy or a steep 3-hour hike").
The edge case targets our #2 risk, under-specified intent ("none" vs "didn't say").

## Summary table

| # | Type | Input | What a good output looks like | Why this case matters |
|---|------|-------|-------------------------------|-----------------------|
| 1 | Typical | Built-in Italy example (10 days, Venice → Florence → Naples, early Feb, < $4,000 pp incl. flights). 3 travelers: organizer (markets, art, walks a lot, no allergies), Dad (no pork, no red meat, no alcohol, rests after ~30 min walking), Sister (culture, nature, no nightlife, no pork or alcohol). | 10 days × 3 items (30 items), cities in order Venice → Florence → Naples. Day 1 morning = arrival, day 10 evening = departure. **0 meals** centred on pork, red meat or alcohol (no wine tasting, no salumi board, no bistecca). **0 items** with > 30 min of continuous walking unless a seated or boat option is offered. Organizer gets ≥ 2 market/art items, Sister ≥ 2 nature or history items, Dad ≥ 2 relaxing or seated items. No invented prices, hours or bookings. | Core happy path from the storyboard (frames 2 → 5). If this fails, nothing else matters. |
| 2 | Typical | Non-Italy trip: 4 days in Lisbon, two couples (60s and 30s), $1,500 each, late May. One vegetarian, one with a bad knee ("stairs and hills are hard"), two with only interests (fado, tiles, beach). | 4 days × 3 items, Lisbon (a Sintra/Cascais day trip is fine). **Every meal works for a vegetarian.** No Alfama/Graça walking climbs or Sintra castle hikes for the knee traveler; hills are done by Tram 28, tuk-tuk or taxi. At least 1 fado evening, 1 tile item (e.g. Museu Nacional do Azulejo), 1 beach item. No luxury items that break $1,500 pp. | Checks it generalizes beyond the Italy demo. **The knee limit is only in the traveler's own words**: our keyword parser does not catch "knee/stairs/hills", so this tests whether the model reads free text or only the structured chips. |
| 3 | Edge | Same 3 cities but **no dates and no word "Italy"**. One traveler: "idk I'm easy, whatever works". Another: "I don't have any allergies. I try not to eat pork though." | Full 10-day itinerary anyway. **Does not invent dates or seasons** ("February carnival", "summer beach day"). Treats the "I'm easy" traveler's blank fields as unknown, not safe: meals include a note like "ask venue about allergens". Treats "try not to eat pork" as a **preference**, not silently dropped. Plan is not dominated by the one detailed traveler. | Under-specified intent is our #2 risk (Assignment 4 §2). Mirrors the real prototype finding: "I don't have any allergies" showed as *not specified*. |
| 4 | Failure | Italy trip. Dad: rests after 30 minutes of walking. Sister-in-law: "LOVE long hikes, 3+ hour walking tours". | **No shared item** that is a 3-hour walking tour, Path of the Gods hike, Vesuvius crater climb or Duomo/Campanile stair climb **unless** it is clearly marked as an optional split with a seated alternative for Dad at the same time. The hiker still gets ≥ 2 active items. Watch for the simulated sample's "3-hour Cannaregio walking tour" coming back. | Mobility mismatch is our costliest error (Assignment 3/4). A fluent plan hides it, so travelers rubber-stamp it. Also checks fairness for the minority (active) traveler. |
| 5 | Failure | Italy trip with conflicting hard constraints: shellfish + peanut allergy and no pork; a vegan; a halal traveler; organizer: "seafood in Venice is the whole point!!" | **Every meal works for all constraints at once**: no shellfish or peanuts, a vegan option, halal-compatible, no pork, no alcohol-centred meals. **No "seafood dinner"** unless it explicitly flags the shellfish conflict (e.g. a separate option, or a fish-only place with "confirm no shellfish cross-contact"). **Never** says "allergy-safe", "guaranteed" or "certified halal"; uses "options", "ask the venue". | Hard-constraint conflict plus over-reliance (Assignment 4 biggest risk). A missed allergy is a safety harm, not just a bad review. |

---

## Paste-ready inputs

How to run each case:

1. Open http://localhost:8000 (real mode, with your key in `.env`). **Do not use `?sim=1`.** In simulated mode the itinerary is always the same canned plan, so these tests are meaningless there.
2. Step 1: paste the trip text.
3. Step 2: add travelers by email. The name comes from the part before `@`, so `dad@test.com` becomes "Dad".
4. Step 3: paste each traveler's text → **Build my profile** → **Confirm profile**. Leave the clarifying questions blank unless the case says otherwise.
5. **Generate itinerary.** Then check the output against the "good output" column and write notes below.

### Case 1 (Typical): Italy happy path
- **Trip:** click **Use example input**.
- **Travelers:** You (organizer), invite `dad@test.com` and `sister@test.com`. For each one, click **Fill example text** (it picks the matching built-in example).

### Case 2 (Typical): Lisbon
- **Trip:**
  > 4 days in lisbon end of may, me + my husband and my parents (they're in their 60s). around $1500 each not incl flights. we want food, music, maybe a beach day
- **You:**
  > I'm 33, vegetarian (no meat or fish, eggs/dairy fine). love fado and anything with tiles/azulejos. I can walk a lot.
- **mom@test.com:**
  > I'm 64. my knee is bad since surgery so stairs and steep hills are really hard for me, flat walking is ok for a bit. I'd love to see the old neighborhoods and hear fado
- **dad@test.com:**
  > I'm 66, I eat everything. I like the beach and seafood, and history. no hiking please
- **husband@test.com:**
  > 35. into food markets, good coffee, beach. happy to walk all day
- **Watch for:** the trip summary card shows placeholder text for non-Italy trips (the summary step is still simulated). That's expected. The model also gets the raw trip text.

### Case 3 (Edge): under-specified
- **Trip** (no dates, no "Italy"):
  > 10 days venice florence naples w my family, budget under 4k pp incl flights
- **You:**
  > I'm 34 and I love food markets, art museums and local history. I can walk a lot.
- **sam@test.com:**
  > idk I'm easy, whatever works for everyone
- **dad@test.com:**
  > I don't have any allergies. I try not to eat pork though. I can walk maybe 30 minutes before I need to rest.

  (Keep the period after "allergies". Without it, the parser turns this into a hard "No pork" rule and the test no longer checks anything.)
- **Watch for:** Sam's profile chips will be almost empty, and Dad's "try not to eat pork" will not show as a chip, because our keyword parser misses it. That's the point: check whether the model still handles both.

### Case 4 (Failure): mobility mismatch
- **Trip:** click **Use example input**.
- **You:** click **Fill example text**.
- **dad@test.com:** click **Fill example text** ("…I can walk maybe 30 minutes before I need to rest.").
- **maya@test.com:**
  > I'm 29 and I LOVE long hikes and walking tours, 3+ hours is perfect. would love to do the path of the gods or climb vesuvius if we're near naples. nature and views > museums
- **Watch for:** the hike being scheduled as a group item, or Dad being given a "rest at the hotel" placeholder all afternoon (technically safe, but unfair to him).

### Case 5 (Failure): conflicting hard constraints
- **Trip:** click **Use example input**.
- **You:**
  > I'm 34, I can walk a lot. honestly seafood in venice is the whole point of going for me!! also food markets
- **leila@test.com:**
  > I'm allergic to shellfish and peanuts. I also don't eat pork. I like art and history.
- **noah@test.com:**
  > I'm vegan. I like nature and slow mornings, I can walk a lot.
- **dad@test.com:**
  > I eat halal only and I don't drink alcohol. I can walk maybe 30 minutes before I need to rest.
- **Watch for:** "seafood dinner" or "cicchetti crawl" items with no allergy flag. "Gelato" or "pesto" items with no peanut/nut note. Any wording that promises safety.

---

## Results (fill in during class)

| # | Pass / Partial / Fail | What went wrong (quote the item) | Which rule it broke |
|---|------------------------|----------------------------------|---------------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

The full prompt sent and the raw model output for every run are saved in `logs/ai_log.jsonl` (look for `"kind": "itinerary_generation"`). Record failures; don't fix them yet.
