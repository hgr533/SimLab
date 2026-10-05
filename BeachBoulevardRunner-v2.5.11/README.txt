BEACH BOULEVARD RUNNER v2.5.11
=============================
A Tel Aviv-style beach promenade runner at sunset, built in Three.js (r186, included in
the vendor folder, MIT license). All art is procedural: primitives and generated textures,
no downloaded models or textures. Action sound effects are synthesised in code; the
ambience uses the Grok sound pack (assets/sound/, v2.5.2). The music is a playlist of
three songs (assets/audio/), played in order and looping back to the first.
Runs fully offline.

Background music supplied by Haran.

v2.5.11 in one line: free will within the rules: every person on the promenade has a
persona (chill, hurried, curious, social, beachy, sporty) and now and then makes a small
choice of their own (pause and look around, chat with someone, wander, change pace,
decide to go bathing); bike-lane riders and beach goers choose too.

v2.5.5 in one line: the sea gently draws the crowd down to bathe (a soft pull toward the
sea wall, and now and then a walker steps down to the beach and wades in), bathers,
swimmers and wave surfers in the sea, and the bike lane now mixes cyclists and scooters
with rollerbladers, skateboarders and surfers carrying their boards.

v2.5.4 in one line: softer, more natural feel: Gaussian falloffs instead of hard
cut-offs (gusts, crowd sounds, HEAT changes, near-miss rings, barks and clinks), gusts that
push then pull, cafes that draw walkers, a crowd that parts ahead of you, and at high FLOW
pickups and echoes that spiral gently toward the runner.

v2.5.3 in one line: the music is now a looping playlist of three songs (the Boulevard
theme, then Track 2, then Track 3, then back to the theme) with a short crossfade, and SET
shows which song is playing ("Song 2/3 - Track 2") with a Next song button.

v2.5.2 in one line: ambience uses real recorded sounds (the Grok sound pack) instead of
synthesised beds: crowd chatter, rain, wind, seagulls, bike bells, cafe clinks, dog barks
and footsteps.

v2.5.1 in one line: seagulls you can actually see (bigger, lower, more often, also on a
portrait phone), clearer ambience sounds on phone speakers, a "Test sounds" button in SET,
the distant-waves sound removed, and a version label (v2.5.1) on the title card and in SET.

v2.5 in one line: detail levels (near / mid / far) for people, dogs, palms, benches, cafes,
umbrellas and cyclists, a more detailed runner, a stone paving texture, pedaling cyclists,
seagull flocks overhead, and SET has a volume slider plus on/off switch for each ambience
sound (crowd chatter, rain, wind, seagulls, bike bells, cafe clinks, dog barks,
footsteps).

v2.4 in one line: the generated game music is gone (the song is the only music), SET has
volume sliders (Master, Music, Ambience, Effects), and you can run as a FEMALE or MALE runner.

v2.3 in one line: Haran's song is now the background track (looping, with a fade-in and
gentle ducking), and SET had a music choice SONG / PROCEDURAL / OFF (v2.4: music on / off).

v2.2 in one line: wind gusts that sweep down the boulevard and bend the palms, blowing
leaves, and a living beach and promenade (sunbathers, matkot players, benches with people,
cafe tables, kiosk customers, bike racks, cyclists and e-scooters on the bike path).
Everything from v2.1 (sound, HEAT, pickups, results screen) is still there. Same
performance rules.

There is also a single-file phone version next to this folder:
BoulevardRunner-v2.5.11-phone.html (copy it to the phone and open it in Chrome). All three
songs and the sound pack are built into that file (about 13.1 MB), so it plays offline too.


HOW TO START (Windows PC)
-------------------------
1. Double-click start-game.cmd.
   It runs "py -3 -m http.server 8765" in this folder and opens your browser at
   http://127.0.0.1:8765/index.html after 2 seconds.
2. Keep the black server window open while playing. Close it to stop the server.
3. Needs Python 3 (the "py" launcher). ES modules do not load from file://, which is
   why a local server is needed. Opening index.html directly will not work.

If the page shows "The game did not start":
- Use start-game-mimefix.cmd instead (port 8766). Some Windows setups map .js files to
  text/plain, and the browser then refuses to load the game modules. This version forces
  the correct type.
- Make sure the browser has WebGL 2 (Chrome or Edge: open chrome://gpu or edge://gpu).

Playing on the phone (optional): the phone must load the folder from a web server. One way
is to run "py -3 -m http.server 8765 --bind 0.0.0.0" in this folder on the PC and open
http://<PC IP address>:8765/index.html on the phone over the same Wi-Fi. Windows Firewall
will ask before it allows this; only allow it on your home network.


CONTROLS
--------
Keyboard / mouse
  Left / Right arrows (or A / D)   change lane (5 lanes)
  Space                            jump (dogs, planter barriers)
  Shift (or Down arrow / S)        slide (overhead banners); in the air it is a fast drop
  Mouse click                      dash: short burst, passes through people, costs stamina
  Up arrow (or W), hold            sprint (+32% speed, drains stamina)
  Q                                cycle quality preset LOW / MEDIUM / HIGH / ULTRA
  F3                               debug overlay: FPS, draw calls, triangles, preset
  N                                skip to the next weather state
  P or Esc                         pause
  R                                restart run
  M                                all sound on / off (mute)
Gamepad (Gamepad API, Xbox layout)
  Left stick or D-pad left/right   change lane
  A jump, B slide, X or RT dash, RB / D-pad up / stick up sprint, Start pause
Touch (phone)
  Swipe left / right               change lane
  Swipe up                         jump
  Swipe down                       slide
  Tap                              dash (tap also starts a run)
The SET button (top right) opens the settings: quality, adaptive safety net, sound
effects, music (3 songs) on / off, Next song, volume sliders, vibration and the runner (FEMALE /
MALE). The runner can also be picked on the title card.


HOW IT PLAYS (the 9-step pipeline)
----------------------------------
1 Input        Keyboard, mouse, gamepad and touch are buffered and handed to exactly one
               simulation step.
2 Simulation   Fixed step at 60 Hz with an accumulator; rendering interpolates between the
               last two steps. Seeded RNG, so the same inputs give the same run.
3 Crowd/dogs   Walkers, joggers, leashed dogs and free dogs share one "Universal AI Core":
               sense, decide, act. Each step every agent votes a ternary lateral intent
               (-1 step left, 0 hold, +1 step right) from wander, separation, runner
               awareness, obstacles and promenade bounds. A row is never fully blocked.
               (v2.5.4: the crowd parts ahead of you like a saddle and drifts toward
               cafes; see SOFT FALLOFFS AND FLOW FIELDS.)
4 Proximity    Rings under people and dogs: green = clean pass, yellow = near-miss band,
               red = contact course. Near miss = risk and reward, contact = penalty.
               (v2.5.4: soft-edged rings; yellow fades into green across the band edge.)
5 Line core    Every step resolves to -1 CONTACT, 0 COAST or +1 LOCK (badge at top, with a
               history strip). LOCK comes from threading the crowd with clean, committed
               movement or from holding high flow. Flips between -1 and +1 cost flow.
6 Meters       FLOW % (rises in LOCK and on near misses, multiplies score and speed),
               COMBO xN (near misses, hurdles, slides, leash hops, orb trails; resets on
               contact), STAMINA % (sprint, dash, jump use it; contact costs 22 at HEAT 1
               and 3 more per HEAT tier; reaching 0 on a contact means you collapse and
               the run ends).
6b HEAT        Every 450 m the HEAT tier rises (1 to 7, chip under the score): more
               people, more joggers coming at you, more free dogs, obstacles closer
               together, slide + hurdle pairs from HEAT 3, a little more speed, slower
               stamina regen and harder contacts. Score multiplier x1.0 at HEAT 1 up to
               x2.2 at HEAT 7.
6c Pickups     Violet flow orbs in rows of five down one lane (+flow, points; all five =
               ORB TRAIL bonus), gold air orbs above planter barriers (only reachable with
               a jump), teal stamina drinks (+30 stamina). Pickups use their own random
               stream, so they never change where people and obstacles appear.
6d Leash Hop   Jump over the leash between an owner and a leashed dog (or dash through
               the gap) for a LEASH HOP bonus.
7 Soliton Echo A traveling afterimage of the runner. Each copy arrives intact, holds, then
               goes: a smooth envelope over the whole clone plus a stable sech^2 light pulse
               traveling up the body. No dissolving noise and no discard. Its strength
               follows flow and movement quality; a dash fires a burst.
8 World state  GOLDEN -> SEA SPRAY -> RAIN -> CLEAR HAZE, about 38 seconds each with a
               6 second blend (N skips ahead). It changes lighting, fog, sky, sea and
               effects, and gameplay:
                 GOLDEN      late afternoon, long palm shadows. Widest near-miss band.
                 SEA SPRAY   bright mist, spray particles, choppy sea, strong wind.
                             Crosswind gusts push you inland (to the right) as
                             each gust arrives and pull you back a little as it
                             leaves (v2.5.4), the same gusts you see in the palms.
                 RAIN        rain streaks, dark wet deck with puddles and a fake mirrored
                             sky / sun-streak sheen. Slick: lane changes settle slower and
                             the near-miss band is narrower, but rewards are x1.5.
                 CLEAR HAZE  soft light, distant city. Recover: flow decays half as fast
                             and stamina refills 30% faster.
9 Render       Three.js WebGL 2, one color buffer, 60 FPS target.


MUSIC PLAYLIST (v2.5.3)
-----------------------
- The music is three songs played one after another, in this order:
    1/3  Boulevard theme   assets/audio/boulevard-theme.mp3 (the v2.3 song)
    2/3  Track 2           assets/audio/track-2.mp3
    3/3  Track 3           assets/audio/track-3.mp3
  When a song ends the next one starts, and after Track 3 it wraps back to the Boulevard
  theme. A single song no longer loops on its own.
- Songs overlap by a 0.8 second crossfade. Silence at the start and end of each file is
  skipped, so there is no gap between songs.
- SET shows the song that is playing ("Song 2/3 - Track 2", "(music off)" when Music is
  switched off). "Next song" fades the current song out and the next one in.
- The Music switch and the Music volume slider work as before for all three songs. Music
  off remembers the song and position; Music on continues from there.
- Only the playing song and the next one are decoded in memory (a decoded 3-minute song
  takes about 60-70 MB); the third waits as MP3 bytes and is decoded about 40 seconds
  before its turn. This keeps phone memory close to v2.5.2.
- If one song fails to load or decode it is skipped; if all fail there is no music (no
  crash).
- PC folder: the original MP3 files (about 192 kbps). Phone single file: 128 kbps stereo
  re-encodes of all three, embedded as base64 (window.__BBR_SONGS_B64).

BACKGROUND SONG (v2.3, v2.4)
----------------------------
- Background music supplied by Haran. (v2.3 - v2.5.2: it played as a seamless loop; since
  v2.5.3 it is the first song of the playlist above.)
- Browsers do not allow sound before you touch the page, so the song starts with the
  first tap or key press (the one that starts the run) and fades in over 1.5 seconds.
- It sits about 4 dB lower under the results screen and while paused, and dips about
  2.5 dB for a moment on near misses and contacts so those sounds cut through.
- v2.4: the song is the only music. The generated (procedural) game music was removed.
  SET > "Music (the song)" switches it on or off. If the song cannot be loaded or
  decoded, there is simply no music (no crash); ambience and effects keep playing.
- PC folder: the song is assets/audio/boulevard-theme.mp3 (the original file, 192 kbps),
  loaded over the local server that start-game.cmd starts.
- Phone single file: the song is embedded in the HTML as a 128 kbps MP3 (re-encoded from
  the original). v2.5.3: the two new songs too, so the phone file grew to about 13.0 MB.
- The song only affects sound; it never touches the game's random numbers.


VOLUME (v2.4)
-------------
SET has four sliders, 0 to 100. 100 is the v2.3 mix, so the defaults sound as before.
  Master     everything
  Music      the music (v2.5.3: all three songs)
  Ambience   all ambience sounds (v2.5: each one also has its own slider, see below)
  Effects    near-miss whoosh, chimes, pickups, contact, HEAT, results
             (v2.5: footsteps and bike bells moved to the Ambience group)
Changes are applied smoothly while you drag and saved in the browser. The sliders have
large handles for fingers on the phone. M still mutes everything.


AMBIENCE SOUNDS (v2.5, v2.5.1)
------------------------------
SET > Sound > Ambience lists every ambience sound with an on/off switch and its own volume
slider (0 to 100, default 100). Each one goes through the Ambience slider and then the
Master slider (and M mute), so Ambience 0 silences all of them. "All on" switches every
one back on. "Test sounds" (v2.5.1) plays each sound once, in order, and highlights its
row; a sound that is switched off stays silent in the test. The choices are saved in
the browser. The list scrolls on small screens.
v2.5 - v2.5.1 generated all of them in code with WebAudio. v2.5.2: they use the recorded
samples of the Grok sound pack (WAV in the folder, short MP3s inside the phone file); the
generated versions remain only as a silent fallback. The songs stay the only music.
  Crowd chatter   people talking (v2.5.1: voice-like syllables, several talkers), louder
                  when more people are around you on the promenade and near the cafe
                  tables and benches (scales with density)
  Rain            follows the RAIN weather state (as before)
  Wind            follows the weather (strongest in SEA SPRAY) and swells with each
                  passing gust (as before)
  Seagulls        calls from the gull flocks while a flock is around, panned to its side
  Bells & wheels  cyclists and scooters ringing as they pass (was an effect in v2.2 -
                  v2.4); since v2.5.5 also a soft wheel roll when a rollerblader or
                  skateboarder passes you (was called "Bike bells"; same setting)
  Cafe clinks     cups and glasses now and then, more often near busy cafe tables
  Dog barks       an occasional bark from a dog near you, panned to its side
  Footsteps       the runner's steps on the paving, splashier on the wet deck (was an
                  effect in v2.1 - v2.4)
Ambience sounds use their own random numbers, never the game's, so runs stay repeatable.
v2.5.1:
  - The distant-waves sound was removed (Haran's choice). Its saved setting is ignored.
  - Louder by default and tuned for phone speakers, which play almost nothing below about
    300 Hz (the v2.5 crowd murmur sat mostly down there and sounded like wind). Bells
    ring for cyclists passing in any lane, dogs bark a bit more often, cafe clinks are
    rarer but clearer.
  - Sound now starts from the touch itself (touch end / click / key) and is resumed when
    you come back to the page or switch fullscreen. Settings saved by v2.4 or v2.5 are
    filled in with the defaults for any sound they do not know.


DETAIL LEVELS / LOD (v2.5)
--------------------------
People, dogs, palms, benches, cafes and their umbrellas, and cyclists come in up to three
detail levels, each one instanced (one draw per level per kind):
  near   detailed models close to the camera: rounded limbs, shoes, hair (some with hats
         or long hair, varied skin tones), dogs with ears, snout and tail, palms with a
         segmented trunk, serrated fronds, dead fronds and coconuts, umbrellas with ribs
         and a valance, slatted benches with cast-iron legs, cafes with window mullions,
         a door, string lights and planters, bikes with spoked wheels and pedaling riders
  mid    the v2.4 models
  far    very cheap shapes (a few dozen triangles) in the distance
The runner always uses a new higher-detail model (female and male). Switching uses a
small hysteresis band so nothing flickers between levels, and people, dogs and benches
cross-fade with a dither for about 0.2 s. The near level has a budget (the nearest ones
get it first).
Which device gets what:
  LOW (this PC)   no near level: the v2.4 models plus cheap far shapes, so it draws about
                  the same as v2.4 (fewer triangles).
  MEDIUM          near level up to 14 m (5 people), near chunks up to 20 m.
  HIGH (phone)    near level up to 24 m (12 people / dogs), props up to 28 m, near chunks
                  (palms, umbrellas, benches, cafes) up to 34 m, far shapes past 70 m.
  ULTRA           near level up to 32 m (18 people), near chunks up to 46 m.
Adaptive safety net: below about 45 FPS the game first shortens the detail ranges (x0.75,
then x0.55) and only then steps down a preset.


SEAGULLS (v2.5, v2.5.1)
-----------------------
A flock of gulls (4 birds on LOW, up to 7 MEDIUM, 10 HIGH, 14 ULTRA) flies through the
view: the first one 8 to 12 seconds after the run starts, then one every 15 to 25 seconds,
in every weather. One instanced draw; the wing flapping is done in the vertex shader.
v2.5.1: the flight path is planned from the camera's field of view (so it also works on a
narrow portrait phone) and moves with the camera, so you are not past them in a moment.
Three kinds: crossing from the sea side 24-40 m ahead, gliding in low over the beach and
passing overhead, or overtaking you from behind and flying on ahead. The birds are bigger
(about 3.8 m wingspan, so they read on a phone), white with grey wings and black wingtips,
and never fill the screen right next to the camera. Their calls are on the Seagulls
ambience switch. Decoration only: they never touch the game's random numbers.


RUNNER (v2.4)
-------------
FEMALE (ponytail, white top; the original runner) or MALE (short hair, blue t-shirt,
running shorts, slightly broader build). Pick it in SET > Runner or on the title card;
the choice is saved. Both use the same animations, and the soliton echo takes the chosen
runner's silhouette. It is cosmetic only: the hitbox and the simulation are identical,
so runs stay repeatable.


SOUND AND VIBRATION (v2.1, updated)
---------------------------------
The effects and ambience are generated with WebAudio when the game starts (sound unlocks on your first
key press, click or tap):
  - Ambience: rain that follows the RAIN weather, wind that follows the weather and
    swells with each passing gust (v2.2), and (v2.5)
    crowd chatter, seagulls, cafe clinks, dog barks, bike bells and footsteps, each with
    its own switch and slider (see AMBIENCE SOUNDS).
  - Footsteps in time with the runner's stride (splashier on the wet deck).
  - Near-miss whoosh panned to the side you passed on, combo chimes that climb a
    pentatonic scale as the combo grows, hurdle / slide / leash / orb / drink sounds,
    a contact thud, a HEAT fanfare and a short results jingle.
  - Music: the background song (see above). The v2.1 procedural music was removed in
    v2.4.
  - Vibration (phones with navigator.vibrate, for example Chrome on Android): short
    pulses on near miss, hurdles, pickups and leash hops, a longer one on contact, a
    pattern on HEAT up and on collapse.
M toggles all sound. SET has switches for effects, music and vibration and the four
volume sliders (all saved).


FREE WILL, WITHIN THE RULES (v2.5.6)
------------------------------------
People make small choices of their own, sparse and with cooldowns, inside the same rules
as before: they stay in their area (promenade deck, bike lane, beach, water), still step
out of your way, still count for near misses and contacts, and spawn and leave exactly
as before. No new meshes, textures or draw calls; it is a few lines of logic per person.
Promenade walkers get a persona when they appear (it can drift to a related one now and
then, and their mood drifts slowly):
  chill     walks slower, pauses more          hurried   walks faster, hardly pauses
  curious   pauses and wanders most            social    stops for a chat most often
  beachy    most likely to go bathing          sporty    a bit faster, rarely stops
Every 2.5 - 5.5 seconds (staggered, so nobody decides together) each walker picks one:
  - a little faster or slower (kept between 0.6 and 2.0 m/s)
  - stop for 1 - 3 s and look around (the walk eases to a stop and starts again)
  - a small goal of their own somewhere across the deck (soft sideways wander)
  - chat: if someone is within about 3.5 m, both drift together and stand facing each
    other for 2 - 4 s, then walk on
  - go bathing (near the sea wall; see THE SEA AND THE BIKE LANE)
  Someone standing in your line who notices you coming cuts the pause short and steps
  aside as before, so a pause never turns into an unfair block.
Joggers keep running; they only vary their pace a little.
Bike lane riders choose every 3 - 7 seconds: pace (within their kind's range), position
inside their half of the lane, slowing down for a look at the beach, skateboarders stop
and push off again, and riders sometimes tag along behind another for 6 - 10 s.
Beach goers (walkers who went bathing) choose after their time in the water: come out and
stroll along the beach, wade a little deeper, or stay longer (beachy people stay longest,
sporty ones shortest).
LOW (this PC): riders decide less often and do not tag along, and walkers chat about half
as often. Chats look only for someone close by when a walker decides (no per-frame
searches).
Cost: draw calls unchanged (1280x720 run: LOW 25-26, HIGH 48-51). Simulation about
14 microseconds more per step on LOW and 5 - 11 more on HIGH (under 0.05 ms per frame).
The choices use their own random stream, so runs stay repeatable (same seed and inputs =
same run).
Balance check (bot runs, 30 seeds each, v2.5.5 -> v2.5.6):
  good bot     survives 179 -> 188 s, score 56.5k -> 59.5k, near misses 69 -> 72,
               contacts 17 -> 19
  sloppy bot   survives 148 -> 154 s, score 19.0k -> 19.2k, near misses 49 -> 49,
               contacts 25 -> 25
  (within run-to-run noise.)


THE SEA AND THE BIKE LANE (v2.5.5)
----------------------------------
The sea draws people in:
  SEA SINK       (v2.5.6: now a choice, see FREE WILL) the Gaussian of a walker's
                 distance to the sea wall (s = 1.6 m) weights their decision to go
                 bathing, so people already on the sea side are the likely ones. It
                 follows the weather: full on GOLDEN and CLEAR HAZE, about half in SEA
                 SPRAY, almost none in RAIN.
  Going bathing  a walker who chose to bathe heads for the sea wall; if they get there
                 without a dog, more than 40 m ahead of you, they step down to the beach
                 (at most one every 5 seconds); otherwise they change their mind after
                 8 - 16 s. They walk across the sand into the sea, wade in to waist depth
                 and stay there bathing (turning, bobbing). You never lose a person
                 next to you; they leave well ahead.
  Beach walkers  about 45% of the people walking down to the water now go on into the
                 sea, wade out to waist depth, stay a while and walk back.
  Bathers        per 40 m chunk (MEDIUM 1, HIGH 2, ULTRA 3 groups): two people standing
                 in the shallows (one sweeping the water with their arms, a child with
                 hands up), a swimmer doing the crawl, and a surfer riding along the
                 swell further out. They rise and fall with the sea's waves on HIGH /
                 ULTRA. LOW has no bather groups (one draw call less) but still has the
                 walkers who wade in.
The bike lane mix: part of the cyclists and e-scooters became
  Rollerbladers  lean forward, legs push out sideways in turn and glide, arms swing;
                 helmet and boots in their own colours (4.5 - 6.5 m/s)
  Skateboarders  side-on stance on the deck, the back foot kicks a few times and then
                 rides along lifted (3.5 - 5 m/s)
  Surfers        walking the edge of the lane in a wetsuit with the board under the arm
                 (1.5 - 2.3 m/s)
  Riders per preset (whole view):
                 cyclists  scooters  blades  skates  surfers
  LOW (PC)       2         -         1       -       -        (v2.5.4: 3 cyclists)
  MEDIUM         2         1         1       1       1        (v2.5.4: 3 + 2)
  HIGH (phone)   3         2         2       2       1        (v2.5.4: 5 + 4)
  ULTRA          4         3         3       2       2        (v2.5.4: 7 + 5)
  Rollerbladers and skateboarders have a near and a mid detail level (the near one with
  rounded limbs, wheels and knee pads); surfers and bathers have one level. LOW uses the
  mid level only. All motion (push, glide, kick, walk, crawl, swell) runs in the vertex
  shader, like the pedalling cyclists.
  Sound: only cyclists and scooters ring the bell; a passing rollerblader or
  skateboarder makes a short, soft wheel roll on the same "Bells & wheels" channel
  (synthesised, no new sound files). The ambience test plays both.
Cost: one draw call per kind in use (LOW +1: the rollerblader; HIGH about +4 during a
run), no new textures, no shadow maps, no post-processing. The beach goers reuse the
walker mesh (no extra draw).
The simulation is still deterministic (same seed and inputs = same run).
Balance check (bot runs, 30 seeds each, v2.5.4 -> v2.5.5):
  good bot     survives 177 -> 179 s, score 54.9k -> 56.5k, near misses 70 -> 69,
               contacts 18 -> 17
  sloppy bot   survives 151 -> 148 s, score 19.9k -> 19.0k, near misses 54 -> 49,
               contacts 26 -> 25
  (score differences are within run-to-run noise.)


SOFT FALLOFFS AND FLOW FIELDS (v2.5.4)
--------------------------------------
Ideas from the math posters, kept cheap (no extra draw calls, no new textures, no shadow
maps, no post-processing; everything is a few lines of maths in the sim or a shader).

Gaussian falloffs: a smooth bump exp(-r^2 / s^2) (1 at the centre, 0.37 at r = s, almost 0
at r = 2 s) replaces hard "inside / outside" cut-offs:
  Wind gusts       each gust is a Gaussian bump along the boulevard (s = 9.1 m, one about
                   every 70 m, still travelling at 18 m/s; same spacing and width as before)
  Crowd chatter    loudness sums every person with a Gaussian of their distance (s = 20 m)
                   instead of counting people within 30 m; cafe clinks peak next to a cafe
  Dog barks        bark chance falls off with distance (s = 14 m) instead of stopping at 25 m
  HEAT             each new tier blends in over about +-60 m around its 450 m boundary
                   (Gaussian soft step) for speed, crowd density, joggers, free dogs,
                   obstacle spacing, score multiplier, stamina regen and contact cost. The
                   tier number, toast and HUD chip still change at the boundary.
  Near-miss ring   rings have a soft Gaussian edge, and the yellow near-miss colour fades
                   into green across the band edge instead of switching
  Near-miss score  42 to 62 points: the closer the pass, the more (Gaussian of the gap); the
                   clean-pass bonus fades out softly beyond the band (was a 1.5 m cut)

Critical points (the four kinds of stationary points of a 2D / 3D flow):
  SOURCE / SINK    a gust's leading edge is a source (pushes outward / inland), its tail a
                   sink (pulls back). SEA SPRAY: the crosswind pushes you inland as a gust
                   arrives and pulls you back slightly toward the sea as it leaves. Palms
                   throw their fronds further at the front and recoil at the tail.
  SPIRAL           blowing leaves near a vortex line over the deck spiral around it and are
                   drawn inward while a gust passes, then return to their path (MEDIUM and
                   up; LOW has no leaves).
  SINK (cafes)     cafes are mild sinks: walkers within about 10 m drift toward the cafe
                   side of the deck (at most 0.28 m/s) and the crowd is a little denser
                   around cafes.
  SADDLE           ahead of you the crowd flows in along the running direction and out
                   sideways: alert people step away from your line with a Gaussian weight
                   of their sideways distance (s = 0.8 m) and distance ahead (centred 3.5 m,
                   s = 4 m). The deck edges (sea wall and bike path) push back softly, so
                   people near the bike path are turned back along the deck.
  SPIRAL (FLOW)    at FLOW 55% and up the runner is a soft spiral attractor: pickups just
                   ahead are pulled toward your line (Gaussian, s = 2.2 m) with a small
                   swirl around you, and the echoes curl in toward you. Subtle, not
                   sticky: an orb half a lane off (0.85 m) gets collected, an orb a full
                   lane off moves about 0.35 m and is missed. Air orbs keep their height.
The simulation is still deterministic (same seed and inputs = same run).

Balance check (bot runs, 30 seeds each, v2.5.3 -> v2.5.4):
  good bot     survives 181 -> 177 s, score 60.8k -> 54.9k (within run-to-run noise),
               near misses 77 -> 70, contacts 18 -> 18
  sloppy bot   survives 138 -> 151 s, score 20.0k -> 19.9k, near misses 53 -> 54,
               contacts 24 -> 26


WIND AND GUSTS (v2.2)
---------------------
- Palm fronds bend and flutter in the vertex shader (GPU only, no CPU work, no extra draw
  calls): each vertex carries a sway weight (0 at the trunk base, 1 at the frond tips),
  and the shader adds a steady breeze, a gust bend and a flutter.
- Gusts are a wave that travels down the boulevard at 18 m/s, so you can watch a gust
  roll along both rows of palms toward you. Every few seconds one passes.
- Strength follows the weather: SEA SPRAY strong, RAIN medium, GOLDEN and CLEAR HAZE light.
- The same gust function drives the SEA SPRAY crosswind (it pushes the runner inland
  while a gust is on you) and the wind sound (it swells and brightens with each gust).
- Blowing leaves around the palm crowns: one instanced draw, more of them in stronger
  wind (MEDIUM and up).


LIFE ON THE BEACH AND THE PROMENADE (v2.2)
------------------------------------------
- Beach: sunbathers on towels and sunbeds, people in low beach chairs with coolers and
  beach bags, matkot (beach paddle) players hitting a ball, kids running in circles on
  the wet sand, people walking down to the water and back (v2.5.5: some of them go into
  the sea; see THE SEA AND THE BIKE LANE).
- Strip between the beach and the promenade wall: benches with two people each.
- Kiosk and cafe side: people seated at the cafe chairs and on the promenade benches,
  extra cafe tables with two people, kiosk customers, people standing and chatting,
  bike racks with parked bikes, planters and rental e-scooters.
- Bike path: cyclists and e-scooter riders in both directions, each in their own half of
  the red lane, with a bike bell now and then as they pass you. v2.5.5 adds
  rollerbladers, skateboarders and surfers (see THE SEA AND THE BIKE LANE).
- These are decoration only. Nothing on the beach, the strip, the cafe side or the bike
  path is an obstacle. Your five lanes end before the bike lane starts, so you can
  never run into a cyclist. Only the promenade crowd and dogs count.
- They never touch the game's random numbers, so runs stay repeatable.
- Everything is instanced (one draw per kind). It is placed per 40 m chunk and recycled
  with the chunk streaming, only inside the full-detail range. Idle motion (breathing,
  matkot swings, ball, walk cycles) runs in the vertex shader; only the beach walkers,
  kids and riders update positions on the CPU.
- Density by preset (per 40 m chunk):
                 LOW     MEDIUM   HIGH    ULTRA
  Sunbathers     5       5        8       10
  Walkers/kids   5       6        10      13
  Bench groups   2       2        3       3
  Seated people  6       6        10      12
  Beach camps    -       2        3       4
  Matkot pairs   -       -        1       2
  Cafe tables    -       -        2       3
  Bike racks     -       1        2       2
  Riders (pool)  3       6        10      14    (v2.5.5 bike-lane mix, whole view)
  Sea bathers    -       1        2       3     (v2.5.5, groups per chunk)
  Leaves         -       36       70      100
  Extra draws    6       13       15      15    (v2.5.5; v2.2 - v2.5.4: 5, 9, 11, 11)


RESULTS SCREEN AND RUN STATS (v2.1)
-----------------------------------
When you collapse, the results screen shows score, distance, time, near misses, leash
hops, hurdles, orbs and trails, drinks, best combo, peak HEAT, contacts and your best
score, plus a grade S / A / B / C / D (from score, HEAT reached and style = near misses
and leash hops per 100 m) and a NEW PERSONAL BEST badge. Career stats (runs, total
distance, longest run, most near misses) are saved in the browser. Tap RUN AGAIN, press
Space, click or tap to go again.


QUALITY PRESETS AND WHICH DEVICE GETS WHICH
-------------------------------------------
                 LOW        MEDIUM     HIGH        ULTRA
Pixel ratio      0.65x      up to 1x   up to 2x    device max, capped at 3x
MSAA             off        off        on          on
Crowd / dogs     22 / 6     38 / 11    60 / 18     80 / 26
Near detail      none       14 m / 20  24 m / 34   32 m / 46   (people / chunks, v2.5)
Gulls per flock  4          7          10          14
Full-detail LOD  45 m       70 m       100 m       140 m
Chunks streamed  7          9          11          13
Draw range       x0.72 fog  x0.86 fog  full fog    x1.22 fog
Props            lite       lite       rich (more palms, umbrellas, sunbeds)
Beach/plaza life light      medium     full        full (see the v2.2 table above)
Deck color map   256 px     512 px     1024 px     1024 px
Sky              gradient   + clouds and skyline   + sun glare sprite (HIGH/ULTRA)
Rain sheen       darkening  fake mirrored sky gradient + sun streak (MEDIUM and up)
Echo copies      6          8          12          16
Rain / spray     220 / 120  420 / 220  750 / 360   1100 / 520

First run picks a preset automatically (saved in the browser, change it any time with
the SET button or Q):
  - REDMI Note 15 Pro and other phones / tablets (touch + mobile browser): HIGH.
  - This PC with the Radeon HD 5450 (or any old Radeon HD, Intel HD Graphics, or a
    software renderer such as SwiftShader): LOW.
  - Other desktops: HIGH.
  - ULTRA is never chosen automatically; select it yourself.
Adaptive safety net (on by default, toggle in SET): if FPS stays below about 45 for
3 seconds, the game first shortens the detail ranges (v2.5, x0.75 then x0.55) and then
steps down one preset, with a small message each time. A new preset is saved. The
crowd size differs per preset, so a run is repeatable per preset.


PERFORMANCE CHOICES
-------------------
- Instancing: the whole crowd is one InstancedMesh, every dog is one instance of one
  dog mesh (body, head, legs, tail merged; legs and tail animate in the vertex shader).
  City towers are one InstancedMesh. v2.1 pickups add at most 2 instanced draws
  (orbs, drinks). v2.2 beach and promenade life is one InstancedMesh per kind: +5 draws
  on LOW, +9 on MEDIUM, +11 on HIGH / ULTRA. v2.5 adds one draw per detail level in use
  (only levels with something visible are drawn) and one for the gulls. Typical totals
  during a run (F3), v2.5.11: about 26-27 draw calls on LOW (+1 sailboat fleet), 50-52 on HIGH (+2 boat fleets); v2.5.6 was 25-26 / 48-51
  MEDIUM (37-42), 49-51 HIGH (45-47), 52-53 ULTRA (47-49). Triangles: LOW about 31-34k,
  HIGH about 110-135k (v2.5.4: 31-34k and 107-131k).
- Palm sway is a few lines in the existing chunk vertex shader: no extra draws, no
  extra textures.
- The course is streamed in 40 m chunks that are recycled ahead of the runner, each with
  frustum culling on. Near chunks use full detail (LOD0), farther ones a simplified mesh
  (LOD1), and fog fades the far end (LOD2). Chunks past the fog are not drawn. No
  heightfield terrain.
- The sky dome is drawn after all opaque geometry with the depth test on, so sky pixels
  hidden behind the boulevard are never shaded. Opaque objects are sorted front to back.
- Palm fronds and umbrellas are closed single-sided shapes (no double-sided materials).
- Light is baked: one fixed low sun direction, palm and umbrella shadows computed into
  the vertex colors when chunks are built, afternoon tint painted into the color map.
  Materials are unlit; the weather only rescales the baked sun and ambient terms.
  No shadow map, no real-time lights.
- One color buffer: no post-processing pass and no extra render targets. Wet reflections
  are a cheap shader fake. The v2.1 screen-edge flashes are CSS on the HUD layer, not a
  render pass. The Jaffa skyline is a few lines in the existing sky shader.
- Simulation is fixed step with at most 5 steps per frame, so a slow frame cannot spiral.
- Note: the baked palm shadows on the deck stay still while the fronds sway (shadows
  are baked into the vertex colors; a real-time shadow would need a shadow map).


FILES
-----
index.html, style.css      page and HUD
js/                        game code (ES modules)
assets/audio/              music playlist: boulevard-theme.mp3 (supplied by Haran),
                           track-2.mp3, track-3.mp3 (v2.5.3)
assets/sound/              Grok ambience sound pack (WAV, v2.5.2)
BoulevardRunner-v2.5.11-phone.html
                           single-file phone version (songs and sounds embedded)
vendor/                    three.module.js and three.core.js (r186) and LICENSE-three.txt
start-game.cmd             local server + browser
start-game-mimefix.cmd     same with a forced JavaScript MIME type


NOTES
-----
- Best score, run stats and settings are stored in the browser (localStorage). If the
  browser blocks storage (some phones for local files), they last until the page closes.
- The earlier Grok-built workspace (8gLFIO6a5UYW5L7k-grok-workspace) was left untouched
  and only read. Its ideas (ternary line core, shadow clones, weather states with
  gameplay verbs) were rebuilt in v2. v2.1 takes from it: the Leash gap bonus (as LEASH
  HOP), the procedural audio approach (ocean bed, footsteps, near-miss whoosh, finish
  arpeggio), and the run grade plus saved best run.







OPEN SEA WALL + TERRACE PATH (v2.5.11)
--------------------------------------
The sea-facing glass wall of each beach cafe is open in the centre (glass wings
remain on either side). A decorated short path with wood steps / ramp, posts,
rope and planters connects the sea-side terrace to the sandy beach so diners can
walk terrace <-> sand. A few NPCs occasionally stroll that path. Boulevard
entrance, two waiters, side/boulevard glass, sports, cloudy weather, gulls,
crossings, boats and the v2.5.6 free-will system are unchanged.

RESTAURANT LAYOUT (v2.5.11)
---------------------------
Terrace seating is on the SEA side of the cafe (opposite the boulevard). The
boulevard glass facade has a central doorway with an open door leaf. Two waiters
work inside (one by the door, one by the counter). Glass panes and frames from
v2.5.9 are kept.

GLASS CAFE WALLS (v2.5.11)
-------------------------
Beach restaurants use thin frames (columns, sill, mullions, roof, awning) with
translucent glass panes. The panes use a cheap screen-door dither in the existing
baked material (no extra draw calls, no alpha sorting, no shadow maps). You can
see indoor diners, the terrace, the sand crowd and the sea through the building.
LOW uses a denser dither (more opaque) so old GPUs stay readable and cheap.

BEACH LIFE, CLOUDY WEATHER, MORE GULLS (v2.5.11)
-----------------------------------------------
Beach restaurants every ~250 m on the sand just past the sea-wall curb (terrace +
indoor seating, populated). Beach volleyball courts every ~300 m (4 players, ball
bounces side to side over the net). Football groups on the sand (2-5 players, air
passes). Racquet (matkot) couples every ~200 m. Sites keep clear of umbrellas and
of each other; LOW keeps fewer courts and simpler restaurants.

CLOUDY joins the weather cycle (N to cycle): grey overcast sky, soft even light.
More seagull flocks (up to 4 at once on HIGH), new high / beach flight paths, birds
enter and leave the view more often.

SEA-WALL CROSSINGS AND OFFSHORE BOATS (v2.5.11)
----------------------------------------------
The left sea wall (promenade curb toward the beach) now has intentional openings
about every 20 m, each roughly 3 m wide (1-2 walkers). Flared curb ends, a sand
and stone pathway, low wood posts with rope, shells and footprints mark each
crossing. Walkers who choose to bathe (free will) walk to the nearest gap ahead
and step down there, not over the solid curb. Some beach goers later stroll back
toward a crossing to leave the beach.

Offshore: a few sailboats and dinghies drift on the sea (instanced meshes, gentle
bob). LOW: 3 sailboats (1 draw). HIGH: 6 sailboats + 3 dinghies (2 draws).

CHANGELOG
---------
v2.5.11 (2026-10-05)
  + Free will within the rules: promenade walkers have a persona (chill, hurried,
    curious, social, beachy, sporty) and a slowly drifting mood, and every few seconds
    choose to change pace, pause and look around, wander to a spot, chat with someone
    nearby (they face each other), or go bathing.
  * The v2.5.5 sea sink is now a choice: its Gaussian weights the decision to go bathing
    instead of pulling walkers constantly; a walker who cannot step down changes their
    mind. At most one walker every 5 seconds steps down to the beach.
  + Bike lane riders choose pace, lane position, a slow look at the beach, skateboarders
    stop and go, riders tag along behind one another (not on LOW).
  + Beach goers choose after bathing: come out and stroll the beach, wade deeper, or stay.
  = No new meshes or draw calls (LOW 25-26, HIGH 48-51). Deterministic simulation;
    choices use their own random stream. Playlist, sound pack, birds and settings
    unchanged.
  + Version label v2.5.11 on the title card and in SET; the PC folder is now named
    BeachBoulevardRunner-v2.5.11.
v2.5.5 (2026-10-05)
  + The sea gently attracts the crowd: a mild Gaussian sea sink pulls walkers on the sea
    side toward the sea wall (stronger on sunny days, almost none in rain); now and then
    a walker well ahead steps down to the beach, walks into the sea and bathes.
  + About 45% of the beach walkers wade into the sea to waist depth, stay a while and come
    back. Bather groups per chunk on MEDIUM and up: waders, a crawl swimmer and a wave
    surfer riding the swell (they follow the sea's waves on HIGH / ULTRA).
  + Bike lane: rollerbladers (side push and glide), skateboarders (kick, then ride) and
    surfers walking with a board, replacing part of the cyclists and e-scooters. Near and
    mid detail levels for blades and skates; motion in the vertex shader.
  + Soft synthesised wheel roll when a rollerblader or skateboarder passes; the ambience
    channel "Bike bells" is now "Bells & wheels" (same setting, same slider).
  = Draw calls (1280x720 run): LOW 25-26 (+1), MEDIUM 41-44, HIGH 49-51 (about +4), ULTRA
    52-53. No new textures, no shadow maps, no post-processing. Playlist, sound pack,
    birds, LOD, Gaussian / critical-point features and settings unchanged. Deterministic
    simulation.
  + Version label v2.5.5 on the title card and in SET.
v2.5.4 (2026-10-05)
  * Gaussian falloffs instead of hard cut-offs: gust strength along the boulevard, crowd
    chatter loudness, cafe clinks, dog bark range, HEAT tier changes (soft step over about
    +-60 m), near-miss ring edge and colour, near-miss points (42-62 by closeness) and the
    clean-pass band.
  + Gusts as moving source / sink: SEA SPRAY crosswind pushes inland at the gust front and
    pulls back at its tail; palms throw and recoil; blowing leaves spiral around a vortex
    line while a gust passes.
  + Cafes are mild sinks for walkers (drift toward the cafe side, denser crowd nearby).
  + Saddle-shaped crowd parting ahead of the runner (soft, replaces the 7 m x 0.9 m box);
    soft deck-edge walls at the sea wall and the bike path.
  + FLOW 55%+: soft spiral attraction of nearby pickups and the echoes toward the runner.
  = Draw calls unchanged (1280x720 run: LOW 24-25, HIGH 45-47, same as v2.5.3); about
    +1.2k-2k triangles from the soft rings. Playlist, sound pack, birds, LOD and settings
    unchanged. Deterministic simulation.
  + Version label v2.5.4 on the title card and in SET.
v2.5.3 (2026-10-05)
  + Music playlist: Boulevard theme -> Track 2 -> Track 3 -> back to the theme, with a
    0.8 s crossfade (scheduled on the audio clock). The single-song loop is gone.
  + SET: song indicator ("Song 1/3 - Boulevard theme") and a Next song button.
  + Folder build: assets/audio/track-2.mp3 and track-3.mp3 (original files).
  + Phone file: all three songs embedded as 128 kbps stereo MP3 in
    window.__BBR_SONGS_B64 = [song1, song2, song3]; window.__BBR_SONG_B64 still names
    the first song. File size about 13.0 MB (v2.5.2: 5.5 MB).
  * Only the playing and the next song are decoded at a time (phone memory).
  = Music on / off and the Music volume slider unchanged; ambience sound pack, effects,
    graphics, gameplay and simulation unchanged.
v2.5.2 (2026-10-05)
  + Grok ambience sound pack (real WAV / MP3 samples) in place of the synthesised beds
    for crowd chatter, rain, wind, seagulls, bike bells, cafe clinks, dog barks and dry /
    wet footsteps. Loops get a seam crossfade; one-shots a short fade in / out.
  = SET keeps per-sound on / off and sliders, Test sounds and All on. Distant waves stay
    removed. Phone file embeds the song and the sound pack (no network).
  + Version label v2.5.2 on the title card and in SET.
v2.5.1 (2026-10-05)
  * Seagulls: first flock 8-12 s into the run, then every 15-25 s; paths planned from the
    camera FOV and aspect and moving with the camera (v2.5 flocks started far to the side,
    were overtaken by the runner and were mostly outside a portrait phone's view, and the
    first one was spent on the title screen). Bigger birds with black wingtips, lower over
    the beach and promenade, in every weather and preset. Never frustum-culled.
  * Sound: audio context created / resumed from real gestures (touch end, click, key) and
    on page return / fullscreen; the one-time setup no longer runs on touch start (it
    could make a tap too slow to count). Taps are timed from the touch events themselves.
  * Ambience louder and phone-speaker friendly: crowd chatter is voice-like talkers, gull
    calls, dog barks, cafe clinks, bike bells and footsteps raised; bells for cyclists in
    any lane; clinks less frequent.
  - Removed the distant-waves ambience (Haran's choice); the saved setting is ignored.
  + SET > Ambience sounds: "Test sounds" plays each sound once.
  + Version label v2.5.1 on the title card and at the top of SET.
  = Older saved settings are migrated (missing sounds get defaults) and written back.
  = Song, action effects, graphics, gameplay and simulation unchanged.
v2.5 (2026-10-05)
  + Detail levels near / mid / far for pedestrians, dogs, palms, benches, cafes and
    umbrellas, cyclists (one InstancedMesh per level per kind), with hysteresis and a
    dither cross-fade. New detailed near models and a higher-detail runner (female and
    male). LOW keeps the v2.4 look and draw count; HIGH (phone) gets the full near level.
    The adaptive safety net shortens the detail ranges before it drops a preset.
  + Procedural stone paving texture on the promenade; cyclists pedal (crank and legs).
  + Seagull flocks every 20-40 s (one instanced draw, flapping in the shader).
  + SET > Ambience: on/off and volume for each sound: waves, crowd chatter (scales with
    the crowd and cafes), rain, wind, seagulls, bike bells, cafe clinks, dog barks,
    footsteps. All procedural WebAudio, saved, scrollable on the phone.
  = Footsteps and bike bells moved from the Effects group to Ambience.
  = The song is still the only music. Gameplay and simulation unchanged.
v2.4 (2026-10-02)
  - Removed the procedural game music. The song (supplied by Haran) is the only music;
    SET > "Music (the song)" turns it on or off. If it fails to load or decode, there is
    no music and no crash. Ambience (waves, rain, wind and gust swells) and all action
    sound effects are unchanged.
  + Volume sliders in SET: Master, Music, Ambience, Effects (0-100, default 100 = the
    v2.3 mix), smooth, saved, finger-sized on the phone. M still mutes.
  + MALE runner: original procedural model in the same style (short hair, t-shirt,
    running shorts, broader shoulders), same animations, the echo takes his silhouette.
    Choose FEMALE / MALE in SET or on the title card (saved). Cosmetic only: hitbox and
    simulation unchanged (deterministic).
  = No change to graphics settings, draw calls or gameplay.
v2.3 (2026-10-02)
  + Background music supplied by Haran: his song is the default background track. It
    loops without a gap, starts on the first tap or key press with a 1.5 s fade-in,
    sits about 4 dB lower under the results screen and while paused, and dips briefly
    (about 2.5 dB) on near misses and contacts. It plays through the existing limiter.
  + SET > Music: SONG / PROCEDURAL / OFF, saved in the browser. The Music switch and M
    still work.
  + PC: assets/audio/boulevard-theme.mp3 (the original file), loaded over the local
    server. Phone single file: the song is embedded (128 kbps MP3 re-encode), works
    offline from the phone's storage.
  + If loading or decoding fails, the game uses the procedural music instead, silently.
  * start-game-mimefix.cmd also serves .mp3 as audio/mpeg.
  = No change to graphics, gameplay, draw calls or the simulation (still deterministic).
v2.2 (2026-10-02)
  + Wind: palm fronds bend and flutter in the vertex shader, with gusts that travel down
    the boulevard as a wave (18 m/s) along both rows of palms. Strength by weather:
    SEA SPRAY strong, RAIN medium, GOLDEN / CLEAR HAZE light. No extra draw calls.
  + Blowing leaves near the palm crowns (one instanced draw, MEDIUM and up).
  * SEA SPRAY crosswind now comes from the same gust wave: it pushes the runner inland
    while a gust passes (before: a steady side-to-side sway). The wind sound swells
    with the gusts too.
  + Beach: sunbathers on towels and sunbeds, beach chairs with coolers and bags, matkot
    players, kids, people walking to the water.
  + Strip by the promenade wall: benches with people.
  + Cafe / kiosk side: seated people on cafe chairs and benches, extra cafe tables,
    kiosk customers, chatting groups, bike racks with bikes, planters, rental e-scooters.
  + Bike path: cyclists and e-scooter riders in both directions, decor only (the runner
    cannot enter the bike lane), with a bike bell sound.
  + All new life is instanced per kind, placed per chunk and recycled with the chunk
    streaming, with its own random numbers (runs stay repeatable).
  = Draw calls during a run (F3, 1280x720), v2.1 -> v2.2:
      LOW     18-19 -> 23-24 (+5)    triangles about 21-26k -> 39-43k
      MEDIUM  20-21 -> 29-30 (+9)    triangles about 28-32k -> 53-57k
      HIGH    22-23 -> 33-34 (+11)   triangles about 50-53k -> 107-115k
      ULTRA   24    -> 35    (+11)   triangles about 64-67k -> 145-147k
  = Unchanged rules: no shadow map, no post-processing, no extra render targets, chunk
    frustum culling, baked light, procedural art only, deterministic simulation.
v2.1 (2026-10-02)
  + Procedural sound and music (WebAudio, no files): waves, rain, wind, footsteps,
    stereo near-miss whoosh, rising combo chimes, pickup / hop / HEAT / results sounds,
    adaptive music that follows FLOW and HEAT. Soft limiter so phone speakers never clip.
  + Vibration on near miss, hurdle, pickups, leash hop, contact, HEAT up and collapse
    (navigator.vibrate; switch in SET).
  + HEAT difficulty ramp: 7 tiers, one every 450 m, with a toast, a flash and a fanfare.
    In v2 a good test bot never collapsed in 15 minutes (difficulty stopped growing at
    about 2 km); in v2.1 the same bot's runs end after about 2.5 to 3.8 minutes at HEAT 5-7
    (HIGH crowd; on LOW the crowd is smaller, so runs last longer).
  + Pickups: flow orb trails, gold air orbs over planters, stamina drinks.
  + LEASH HOP bonus (from the old workspace's "Leash gap").
  + Results screen: grade S-D, full run stats, NEW PERSONAL BEST, career stats, RUN
    AGAIN button. Best score from v2 carries over.
  + Juice: FOV punch on near miss, dash and bonuses, screen-edge flashes (CSS), combo
    pulse, slight camera roll into lane changes, larger pop text on phones.
  + Landmark: Old Jaffa style skyline (hill, bell tower, clock tower, minaret) far ahead
    over the sea, slowly growing as you run, fading in haze and rain. Original
    procedural shapes in the sky shader.
  * Phone portrait: the meter panel no longer runs under the FULLSCREEN button.
  * Settings: sound, music and vibration switches (saved).
  = Unchanged rules: instancing, chunk streaming with culling and LOD, baked light,
    no shadow map, no post-processing, no extra render targets. Phones still default
    to HIGH, the Radeon HD 5450 PC to LOW, adaptive step-down below 45 FPS.
v2 (2026-10-02)
  First rebuilt version: Three.js r186, 5-lane promenade, Universal AI Core crowd and
  dogs, ternary line core, Soliton Echo, four weather states, quality presets with
  auto-detection, touch / gamepad controls, single-file phone build.
