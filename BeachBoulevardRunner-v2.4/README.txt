BEACH BOULEVARD RUNNER v2.4
===========================
A Tel Aviv-style beach promenade runner at sunset, built in Three.js (r186, included in
the vendor folder, MIT license). All art is procedural: primitives and generated textures,
no downloaded models or textures. Sound effects and ambience are synthesised in code.
The background song is the one audio file (assets/audio/boulevard-theme.mp3).
Runs fully offline.

Background music supplied by Haran.

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
BoulevardRunner-v2.4-phone.html (copy it to the phone and open it in Chrome). The song is
built into that file, so it plays offline too.


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
effects, music (the song) on / off, volume sliders, vibration and the runner (FEMALE /
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
4 Proximity    Rings under people and dogs: green = clean pass, yellow = near-miss band,
               red = contact course. Near miss = risk and reward, contact = penalty.
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
                             each gust passes you, the same gusts you see in
                             the palms.
                 RAIN        rain streaks, dark wet deck with puddles and a fake mirrored
                             sky / sun-streak sheen. Slick: lane changes settle slower and
                             the near-miss band is narrower, but rewards are x1.5.
                 CLEAR HAZE  soft light, distant city. Recover: flow decays half as fast
                             and stamina refills 30% faster.
9 Render       Three.js WebGL 2, one color buffer, 60 FPS target.


BACKGROUND SONG (v2.3, v2.4)
----------------------------
- Background music supplied by Haran. It plays as a seamless loop (the silent tail at
  the end of the file is skipped, so it restarts without a gap).
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
  the original to keep the file under 5 MB).
- The song only affects sound; it never touches the game's random numbers.


VOLUME (v2.4)
-------------
SET has four sliders, 0 to 100. 100 is the v2.3 mix, so the defaults sound as before.
  Master     everything
  Music      the song
  Ambience   waves, rain and wind (with the gust swells)
  Effects    near-miss whoosh, chimes, pickups, contact, HEAT, footsteps, bike bell,
             results
Changes are applied smoothly while you drag and saved in the browser. The sliders have
large handles for fingers on the phone. M still mutes everything.


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
  - Ambience: ocean waves that swell and recede, rain that follows the RAIN weather,
    wind that follows the weather and swells with each passing gust (v2.2).
  - Footsteps in time with the runner's stride (splashier on the wet deck).
  - Near-miss whoosh panned to the side you passed on, combo chimes that climb a
    pentatonic scale as the combo grows, hurdle / slide / leash / orb / drink sounds,
    a contact thud, a HEAT fanfare, a short results jingle and (v2.2) bike bells.
  - Music: the background song (see above). The v2.1 procedural music was removed in
    v2.4.
  - Vibration (phones with navigator.vibrate, for example Chrome on Android): short
    pulses on near miss, hurdles, pickups and leash hops, a longer one on contact, a
    pattern on HEAT up and on collapse.
M toggles all sound. SET has switches for effects, music and vibration and the four
volume sliders (all saved).


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
  the wet sand, people walking down to the water and back.
- Strip between the beach and the promenade wall: benches with two people each.
- Kiosk and cafe side: people seated at the cafe chairs and on the promenade benches,
  extra cafe tables with two people, kiosk customers, people standing and chatting,
  bike racks with parked bikes, planters and rental e-scooters.
- Bike path: cyclists and e-scooter riders in both directions, each in their own half of
  the red lane, with a bike bell now and then as they pass you.
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
  Riders (pool)  3       3+2      5+4     7+5   (cyclists + e-scooters, whole view)
  Leaves         -       36       70      100
  Extra draws    5       9        11      11


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
3 seconds, the game steps down one preset and shows a small message. The new preset is
saved. The crowd size differs per preset, so a run is repeatable per preset.


PERFORMANCE CHOICES
-------------------
- Instancing: the whole crowd is one InstancedMesh, every dog is one instance of one
  dog mesh (body, head, legs, tail merged; legs and tail animate in the vertex shader).
  City towers are one InstancedMesh. v2.1 pickups add at most 2 instanced draws
  (orbs, drinks). v2.2 beach and promenade life is one InstancedMesh per kind: +5 draws
  on LOW, +9 on MEDIUM, +11 on HIGH / ULTRA. Typical totals during a run (F3): about
  23-24 draw calls on LOW, 29-30 MEDIUM, 33-34 HIGH, 35 ULTRA.
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
assets/audio/              boulevard-theme.mp3, the background song (supplied by Haran)
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


CHANGELOG
---------
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
