# v2.5.59 - Cyber night, sky, fireworks + air show, dice free will, beach football (built on v2.5.58)
All new switches default OFF. With all of them off the determinism hash (seed 20261002, 5400 steps) is 3341098101, same as v2.5.58 (also unchanged with only cyber / sky / fireworks / air show / shake / dice on). Beach football moves real people, so with it ON the run differs (expected).
Every feature has its own SET switch; sounds have their own volume rows (Fireworks, Air show jets, Football). No scene lights, no full-screen passes, no real reflection pass. At most +2 meshes (about +3 draw calls) with everything on; measured ULTRA golden: v2.5.58 all-on 97, v2.5.59 all-on 99-100 (rain: 94 vs 94-95).

## Cyber night (SET: "Cyber night")
- Adds a CYBER NIGHT preset to the weather cycle (like the FOG presets; removed again when off): neon dusk tint, glow boost on lit windows/signs.
- Rain-slicked look done in the world shader: neon streaks on wet surfaces, no reflection pass (0 draw calls).
- Flickering holographic signs along the boulevard (12 slots, LOW preset uses half) and 2 drifting ad blimps with animated glowing billboards (LOW preset: 1).

## Sky (SET: "Sky polish")
- Sunrise / sunset gradient polish, stars with a faint milky band at night, slow satellites, drifting cloud shadows over the beach. All in the sky / world shaders (0 draw calls). Fades out in rain, overcast and fog.

## Fireworks, air show, screen shake
- Fireworks (SET: "Fireworks" + volume row): rockets and bursts with trails at dusk / night (GOLDEN counts as dusk). Paused in rain and heavy fog.
- Air show (SET: "Air show" + "Air show jets" volume): a formation of 5 jets with coloured contrails flies over every 55-90 s, sonic-boom rumble. Not in rain.
- Screen shake (SET: "Screen shake" + strength OFF-LOW / NORMAL / HIGH): only for loud events (fireworks booms, jet flyover, football goals). Own switch, default off.
- Fireworks and jets share ONE additive/premultiplied mesh (vertex-shader animation).

## Dice-roll free will (SET: "Dice free will")
- When someone near the camera makes a decision (joins a crowd, buys something, boards the wheel, starts a chat) a d20 is rolled, mood adds a small modifier, and a tiny chat bubble shows the roll, the quip and YES / NO (nat 20 / nat 1 are special). Max 6 bubbles, 18 s cooldown per person, uses its own RNG. Visual only: it does not change what people actually do.
- Bubble count is capped; bubbles vanish in rain.

## Beach football (SET: "Beach football" + volume row)
- Every 700 m a pitch appears on the sand (spot chosen to avoid beach props): lines, centre circle, two goals, corner flags, ball + shadow. Two teams of real people (red / blue), simple AI (chase, pass, shoot, keeper), scoreboard bubble over the pitch, spectators gather and cheer (crowd sound), goals trigger a celebration and small fireworks if Fireworks is on. Match ends after about 8 goals or time; players are released back to their lane.
- Leaves when rain starts (players released, pitch hidden). One extra mesh (pitch + ball + bubbles), shared with the dice bubbles.

## Unchanged / notes
- Phone html about 13.47 MB. End-of-file marker kept.
- Untested on a real phone: FPS, sound loudness, first-person camera framing.
