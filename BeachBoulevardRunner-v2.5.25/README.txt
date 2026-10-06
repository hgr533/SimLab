BEACH BOULEVARD RUNNER v2.5.25
=============================
A Tel Aviv-style beach promenade runner at sunset, built in Three.js (r186, included in
the vendor folder, MIT license). All art is procedural: primitives and generated textures,
no downloaded models or textures. Action sound effects are synthesised in code; the
ambience uses the Grok sound pack (assets/sound/, v2.5.2). The music is a playlist of
three songs (assets/audio/), played in order and looping back to the first.
Runs fully offline.

Background music supplied by Haran.

v2.5.25 in one line: close-up muscle shading on HIGH / ULTRA, with SET controls for strength and bare skin.

Muscle shading (SET > Muscle shading; HIGH / ULTRA only)
- Close-up runners and near-detail pedestrians get painted-in muscle definition: chest and shoulder caps,
  abs on bare skin, lats / shoulder blades / spine on the back, glute fold on shorts, quads, hamstrings,
  calves, biceps / triceps. Legs flex a little with the running stride (quads on the landing leg, calf on
  the push-off). It fades out between 9 and 17 m from the camera.
- No new geometry, draw calls, textures, render targets, shadows or post-processing. One extra shader
  variant on three existing materials (runner, near crowd, near walkers). LOW / MEDIUM never compile it
  and stay pixel-identical to v2.5.24 for those presets.
- SET options (saved like the other prefs):
    Muscle shading on/off (default on; only active on HIGH / ULTRA)
    Strength: Softer (~0.5x) / Normal (demo intensity) / Stronger (~1.7x) — paint contrast and stride flex
    "Only on bare skin": when on, shirts and shorts get no muscle folds (no chest/back/glute through cloth);
      only bare midriff, arms and legs show definition. When off, soft cloth shading matches the demo.
- While running: MUSC button (above pause) or the B key quick-mutes the same on/off preference (saved, and
  SET shows it honestly). Mid / far detail figures are untouched either way.

v2.5.24 in one line: optional graphics auto-tune, a gentle "chaos drift" that makes every run
feel a little different, and a check that every number on screen is real.

Auto-tune graphics (SET > Quality, off by default)
- Turn on "Auto-tune graphics" and pick a target: AUTO (the screen's refresh rate, at most 60),
  30, 45 or 60 FPS. Then just play. During your next run the game quietly tries 16 different
  mixes of four things: resolution (pixel ratio), detail range (how far away full-detail models
  and the fog start), crowd size and car traffic. Each try lasts about 4 seconds: the first 0.6 s
  is thrown away while things settle, then it measures the real frame rate for 3.5 s.
- It does not test blindly. After 5 spread-out starting points it keeps a small statistical
  model (a Gaussian process) of "how much frame-rate headroom would this mix have" and picks
  the next mix that is most likely to look better while still holding the target ("expected
  improvement"). A mix only counts as holding the target if its average is at least 95 % of
  the target AND its 1% low (the slowest 1 % of frames) is at least 85 % of it. The winner is
  then measured a second time; if it fails that re-check, a mix with clear headroom is kept.
- Changes are gradual: resolution steps a little every 0.1 s, the detail range cross-fades,
  and extra people and cars simply stop being added (the ones on screen run past and are not
  replaced). Each new try is only a limited step away from the one before.
- Measuring stops while the game is paused, while SET is open and when the tab is hidden, so
  those moments never count. The FPS overlay shows "Tuning 7/16" while it works.
- The result is saved per quality preset as a graphics setting (like the preset itself). SET
  shows what was chosen and the frame rate that was actually measured for it on your device,
  plus a Re-tune button. Turning auto-tune off goes back to the plain preset.
- While tuning, the adaptive safety net is paused. After tuning it only acts in an emergency:
  if the frame rate stays below 60 % of the target for 5 seconds it lowers the tuned settings.
- Your run itself is never saved: reloading the page always starts fresh from the title.

Chaos drift
- A Lorenz system (the classic "butterfly" equations, sigma 10, rho 28, beta 8/3) runs slowly
  in the background on the game clock. Its three values wander smoothly and never repeat, and
  they gently push a few things up and down:
    crowd density            +-16 %  (never above the preset's people cap)
    wind strength            +-22 %  (palm sway, rain slant, sea spray drift)
    gusts                    +-25 %  (palm flutter, wind sound)
    swimmers pulled to sea   +-15 %
    car traffic gaps         +-15 %
    how long a weather lasts 23 to 41 s (always switches; never stuck, never rushed)
- It is fully deterministic: the same seed gives exactly the same drift (the determinism check
  still passes), different seeds give different moods. Your controls, the lanes and the LOD /
  performance caps are not touched.

Honest meters
- Every number on the HUD, the FPS overlay and in SET was checked against what the game really
  computes. Fixed: the HEAT chip now shows the live score multiplier, a drink shows the stamina
  actually gained (not always +30), the adaptive safety-net text says what it is really doing,
  and the weather timer follows the real (drifting) weather length.
- Also fixed: when the safety net lowered the detail range, the far detail tier was moved
  further away instead of closer, and the rain slant ignored the wind.

v2.5.23 in one line: the 1st person camera no longer looks through people or props.
- In 1st person, anything closer than about 0.8 m to the eye (pedestrians, dogs, carried bags,
  benches, obstacle posts, restaurant and cafe parts) fades out with a fine screen-door dither
  and is fully hidden inside about 0.45 m, so the view never shows the inside of a body or a
  prop. A leash that passes that close to the eye is simply not drawn for that moment. It costs
  one distance check per pixel and no extra pass; in 3rd person it is switched off completely.
- When someone passes within about a metre, the 1st person eye also eases up to 17 cm to the
  other side, so people brush past at shoulder distance instead of through the lens. This only
  moves the view: lanes, collisions, near misses and scoring are exactly as in v2.5.22.
- Beach restaurants, boulevard cafes, city shops and street lamps were checked: no awning, post
  or lamp arm reaches the running lanes (the restaurant door canopy ends over the sea wall,
  about 0.5 m short of the deck; the lamp arms are on the far side of the deck). In the 40 s demo run the
  closest restaurant part stayed 2.4 m from the eye; the closest scenery of all is the promenade
  benches and the people sitting on them (0.7-0.8 m), which now fade instead of clipping.

v2.5.22 in one line: FPS counter, pause button and a 1st person camera.
- SET > Show FPS (off by default, saved): a small overlay in the bottom-right corner, above the
  pause button, clear of the score and the HUD bars. It shows the current FPS (last ~0.5 s,
  green 55+, yellow 30-54, red under 30), the frame time in ms, the average since it was turned
  on or reset, the 1% low (average rate of the slowest 1% of frames) and the minimum over the
  last 10 s, the preset (plus the LOD scale if the safety net shortened it), the weather and
  the draw calls. RESET on the overlay or "Reset FPS" in SET restarts the average and the lows.
  It measures requestAnimationFrame timing, so it shows the real display rate: phones cap it at
  their screen refresh (60, 90 or 120 Hz, some phones drop to 60 in battery saver), so 60 or 90
  can be the maximum, not a slowdown. Paused time, open SET and a hidden tab are not counted.
  The text is refreshed about 4 times a second as plain page text (no extra rendering).
  To measure one preset (for example ULTRA on a phone) turn OFF the Adaptive safety net in SET,
  otherwise it may shorten the detail range or drop a preset when FPS stays under 45.
- Pause button (two bars, bottom-right, shown while running): pauses everything (runner, people,
  dogs, cars, weather and timers), turns music and ambience well down and shows a card with
  RESUME, SET and RESTART. P or Esc toggles it on PC; the game also pauses by itself when the
  tab or app goes to the background. SET opened from the pause card goes back to it.
- Camera: SET > Camera 3RD PERSON / 1ST PERSON (saved), the 3P/1P button next to the pause
  button, or V on PC. 1st person sees through the runner's eyes: it follows lane changes,
  dodges, jumps and slides (the view ducks under banners), has a slightly wider view and a
  small head-bob that grows with speed (SET > Head-bob, turn it off for comfort). The runner's
  own body is hidden, which also makes it a little cheaper than 3rd person.

v2.5.21 in one line: picking up after the dog. Leashed dogs (on the boulevard and on the sand)
now stop and squat now and then (about once every 60-120 s per dog, random, mood shifts it a
little) and leave a small brown dropping. The owner stops, pulls out a small colored poop bag,
steps up, crouches, picks it up (the dropping disappears, the bag is in hand), stands up, walks
to the nearest dog-waste bin within reach, drops the bag in and walks on. New small green bins
with a red bag dispenser stand by every sea-wall crossing, on the deck edge tucked against the
wall, clear of the walking lanes, the road, the benches and the beach paths. On the sand there
is no bin, so the owner carries the bag and bins it after coming back up. The leash stays on and
taut all the time; every step has a timeout, so nobody gets stuck, and runner and crowd go around
a stopped owner like any other pause. A dog only squats when the runner is far enough back for
the whole pickup to finish before the runner gets there, so nothing is left on the ground.
Running past an owner busy with this gives a small GOOD CITIZEN +10 (no combo). Cheap on LOW:
droppings are a small pool and droppings + bags are one instanced draw; bins are baked into the
boulevard chunks (no extra draws). Traffic, lights, sounds, eateries, dogs on the sand and the
LOD limits are unchanged.

v2.5.20 in one line: dog walkers can now go down to the beach. Until v2.5.19 an owner with a
leashed dog could choose to go to the sea, but only walkers WITHOUT a dog were allowed to step
down, so dog walkers walked to a sea-wall crossing, waited and gave up. Now, by free will
(beachy and chill people most, hurried people hardly ever, more when they are in a good mood,
almost never in the rain), an owner takes the dog down a decorated crossing, strolls either
the dry sand by the palms or the shoreline, and comes back up through another crossing
(sometimes cutting the walk short), then walks on along the boulevard with the same dog.
On the sand the dog trots ahead, sniffs beside the owner, or plays at the waterline, always
on its leash (max 1.7 m, drawn from the owner's hand to the dog at any heading and height).
Routes keep clear of the beach restaurants (and their terrace paths), volleyball, football
and matkot areas, and shoreline walks avoid crossings with umbrellas. Owners and dogs stay
the same game characters the whole time, so leash hops, dog hurdles, barks and the deck
crowd density are unchanged. Traffic, lights, sounds, eateries and LOD limits unchanged.

v2.5.19 in one line: car sounds and street lamps. Cars now honk now and then (positional,
distance-faded, a few different horns): after a hard brake behind another car, a short tap
when the light is green and the car in front is slow, and sometimes at a pedestrian on the
zebra, with a global cooldown (about 2-5 honks a minute). Nearby traffic adds a faint engine
hum and a soft whoosh when a car in the near lane passes you. New SET rows 'Horns' and
'Traffic (engine hum & pass whoosh)' sit with the other ambience sounds (on/off + volume, saved).
Capped voice pool (4 car voices + 1 hum), no road-noise layer on LOW, unlocks on the first tap
on phones. All street lamps light up with the same weather level as the establishments
(full in RAIN, 0.7 CLOUDY, 0.5 GOLDEN, faint in CLEAR HAZE, off in SEA SPRAY): boulevard /
plaza lamp posts, the lamps behind the city cafes, and a new row of road street lamps on both
curbs (arm over the road, clear of zebras, traffic lights and signs). Warm-white glowing heads,
a soft halo and a subtle glow pool on the ground, all emissive / additive, no real lights,
shadows or post effects. Ground glow pools now face up, so the coloured pools at the
eateries and the headlight beams show properly. No blinkers or hazard lights (by design).

v2.5.18 in one line: every restaurant / cafe is off the road with a clear sidewalk gap
(plaza glass cafes sit inside the plaza, city cafes behind the shop sidewalk); the right-side
cafes got the beach-restaurant glass look (see-through dithered glass, frames, awning, glass
entrance, tables, waiters); every beach restaurant has a paved, decorated entrance from the
boulevard (checker tiles, planters, lanterns, steps and a boardwalk over the sea wall) and the
cafes have paved entrance paths (plaza cafes with a crosswalk over the bike lane, riders yield);
people choose to visit the eateries (in and out through the doors, never through glass, some
walk on through the restaurant down to the beach); and at dusk / rain / overcast the
establishments light up in every colour: rainbow festoon bulbs with a gentle chase, neon signs
in a different hue per place, coloured lanterns and table lamps, warm lit rooms behind the glass,
coloured glow pools on the paving, plus car headlights and brake lights. No real lights, shadows
or post effects (emissive + additive sprites only).

v2.5.17 in one line: cars now drive in BOTH lanes of the city road in opposite directions
(right-hand traffic: near lane toward you, far lane away), evenly dense, centred in their
lane, never overlapping, each car pointing the way it moves, and braking for red lights
before the zebra in its own direction. Everything else as v2.5.16.

v2.5.16 in one line: road-blocking pillars/kiosks/signs moved off the asphalt onto the
right side (~15 m +x); right-side cafes/shops pushed ~10 m further back from the curb;
cars, two-way traffic, zebra/lights, crowds, beach and free will kept.

v2.5.15 in one line: restos flush on the right curb; cars sized proportionate to people.

HOW TO RUN (PC)
---------------
1. Double-click start-game.cmd (needs Python 3 with the "py" launcher).
2. If the title card says the game did not start, use start-game-mimefix.cmd instead.
3. Or open the phone file BoulevardRunner-v2.5.18-phone.html directly in Chrome.

HOW TO RUN (phone)
------------------
Open BoulevardRunner-v2.5.18-phone.html in Chrome (WebGL 2). Everything is embedded.

CONTROLS
--------
Arrow keys / swipe to change lane. Space / tap to jump. P pause. SET for quality,
weather, music, ambience.
