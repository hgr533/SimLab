# Beach Boulevard Runner v2.5.55

**New in v2.5.55:** error card shows the real error and detects an incomplete (cut-off) file. Evolving crowd (v2.5.54): optional *Evolving crowd* (SET > Crowd gatherings), off by default, with LOW / NORMAL / HIGH strength. See CHANGELOG-v2.5.55.md.

A one-file Three.js endless runner set on a Tel Aviv-style beach promenade at sunset. You run up the boulevard and weave through pedestrians, dogs, cyclists, vendors and obstacles. Beside you are the beach, the cafés, the road and the city. Everything is in `BoulevardRunner-v2.5.55-phone.html`, including the audio. `index.html` is an identical copy.

*"Thread the crowd. Hold the line. Keep running."*

## Running it

**Phone (Android):**
1. Copy the HTML to the phone.
2. Open it in **Chrome**. The game needs **WebGL 2**.
3. Tap **FULLSCREEN** (bottom right), then tap to run.

If the game can't start WebGL 2, it shows "The game did not start".

**PC:** use either of these.
- Double-click `index.html` (or the phone HTML) to open it in Chrome, Edge or Firefox. It works straight from `file://`.
- Or serve the folder and open the address:
  ```
  cd BeachBoulevardRunner-v2.5.55
  python3 -m http.server 8000
  # open http://localhost:8000/
  ```

## Controls

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Change lane | ← → or A / D | swipe left / right | stick |
| Jump (dogs, planters) | Space | swipe up | A |
| Slide (banners) | Shift or ↓ or S | swipe down | B |
| Dash through people | Click | tap | X |
| Sprint (uses stamina) | hold ↑ or W | – | RB |
| Start / run again | Space, Enter, click | tap | – |

**Other keys:**
- **Q:** next quality preset
- **V:** next camera
- **N:** next weather phase
- **P** or **Esc:** pause / resume
- **M:** sound on/off
- **B:** muscle shading on/off
- **R:** restart (not on the title screen)
- **F3:** stats overlay

**Things to grab:**
- Violet flow orbs. Collect all 5 for an ORB TRAIL.
- Gold air orbs over planters.
- Teal drinks, which refill stamina.
- Gems.

Jump a dog's leash for a **LEASH HOP** bonus, or dash across it for a **LEASH GAP**. Every 450 m the **HEAT** level rises.

## HUD

- **Top left:** SCORE, distance, **GEMS n**, HEAT level and multiplier.
- **Top centre:** a rhythm indicator (COAST and others) with a small history graph.
- **Top right:** current weather phase.
- **Bottom left:** the **FLOW** bar, **COMBO** and **STAMINA**.
- **Bottom right:**
  - **SET** (shows the current preset) opens the settings.
  - **FULLSCREEN**.
  - **VIEW** cycles the cameras.
  - **MUSC** turns muscle shading on/off.
  - **Pause** (two bars).
- **Pause just freezes the game.** No menu card covers the view. Press the pause button, P or Esc again to continue.
- **Run end:** you get a RUN RESULTS card with a grade and your personal best.

## Quality presets and auto-tune

| Preset | Description from SET | Draw calls measured in rain* |
|---|---|---|
| LOW | for old GPUs: 0.65x resolution, light crowd, no close-up models | ~73 |
| MEDIUM | 1x resolution, more crowd, a few close-up models | ~92 |
| HIGH | up to 2x resolution, MSAA, detailed close-ups | ~95 |
| ULTRA | up to 3x resolution, max crowd, longest detail range | ~97 |

\*Measured headless on v2.5.55. They match v2.5.52 within ±2.

- **GPU:** the preset is chosen automatically from your GPU. Change it in SET or with Q.
- **Auto-tune graphics** (SET): while you run, it tries 16 settings (resolution, detail range, crowd, traffic) for about 4 s each. It measures the real frame rate and keeps the best-looking setting that holds the **Target FPS** (AUTO, 30, 45 or 60). **Re-tune** starts it again.
- **Adaptive safety net** (SET): if FPS stays under 45, it first shortens the detail range, then drops one preset.

## Graphic styles and cameras

**Graphic style** is separate from quality and camera. All three styles use the same 3D models.
- **3D:** original shading.
- **3D ANIME:** soft cel shading with a rim light and thin ink outlines.
- **ANIME:** hard cel shading with screen-tone dots, posterized colour and thick ink outlines.

**Cameras** (VIEW button or V):
- **3RD PERSON:** chase camera behind the runner.
- **1ST PERSON:** through the runner's eyes. There's a head-bob option you can turn off for comfort.
- **BIRD'S-EYE:** overhead view, so you can see the gaps ahead.

## Weather

The weather moves through five phases (N skips to the next one):

| Phase | Look |
|---|---|
| GOLDEN / DUST | late afternoon, long shadows |
| SEA SPRAY / WIND | bright mist, wet surfaces |
| RAIN / SLICK | reflections, puddles, moody lights |
| CLEAR HAZE / RECOVER | soft light, distant city |
| CLOUDY / OVERCAST | grey sky, soft even light |

**What changes in rain:**
- Hidden: the yoga group.
- No new gatherings start: performers, ice-cream queues and vendor crowds. Performer and ice-cream gatherings that are already running break up.
- Vendors behave differently.
- Elderly people head indoors.
- Pedestrians open umbrellas. Couples and family adults share one, and children walk under it.
- Staying up in rain: geometric props, gems and flow visuals.

## The world

- **Cafés and restaurants:** on both sides. Pedestrians go in and out. The elderly also shop there.
- **Road traffic:** cars, plus an **ice cream truck** that drives with the traffic, stops at the curb and draws a queue for cones. A server stands at its window.
- **Sky:** **aircraft** (a small plane and a helicopter along the shore, an airliner from the sea) and a distant **city skyline** with lit windows.
- **Beach life:** **kites** over the beach, street **performers** (music, coins, juggling) and **crowd gatherings** (OFF / SOME / LOTS).
- **Vendors:** popsicle sellers roam the sand and carts are pushed along the boulevard. Pedestrians carry cash, take money out at **ATMs**, buy from vendors and tip performers.
- **Balloon people:** someone with a bunch of balloons about every 13 s.
- **Outdoor gyms:** fitness stations on the shore side every 400 m.
- **Bikes and scooters:** rental docks about every 270 m. People rent, ride and lock up at cafés, and the bike lanes have white dashes.
- **Elderly pedestrians:** walkers, canes, rollators, couples and bench sitters. They appear on the plaza walkway, plaza benches, cafés and the sand. Since v2.5.55 they are never on the boulevard deck or bike lanes.
- **Family groups:** adults and children walking together.
- **Leashed dogs (v2.5.55):**
  - About a 2.6 m leash that pulls taut.
  - Running bursts, darts, sniff detours and circles.
  - At full stretch the dog drags its owner, who leans or stumbles and then recovers.
  - Dogs stay on the deck and steer around obstacles, walls, cafés and the road. They are decoration only, apart from the leash hop bonus.
  - There are also free-running dogs and a dog-poop and bin routine.
- **Rounded people:** every person, rider and animal (cyclists, skaters, surfers, swimmers, gym, kite flyers, mid dogs and others) uses rounded limbs and ellipsoid bodies at every detail level. Nothing is a box any more (v2.5.55).
- **Surfers:** they walk the shore-side promenade with a board under the arm, and there is a surfer on the waves.
- **Yoga group:** six people every 450 m (450, 900, 1350 m and so on), hidden in rain.
- **Geometric props:** triangle shade sails, faceted planters, hex kiosks, angular benches, lifeguard towers and 6- or 8-sided parasols. They are placed so they stay clear of cafés, crosswalks and other objects.
- **Shared umbrellas:** in rain, as described above.

## Gems, Flow and speed blur

- **Gems:** diamonds, prisms and icosahedra in 5 colours, in the lanes about every 24–40 m.
  - Each one gives **+25 × combo** score and **+4% Flow**.
  - They are counted under the score.
  - They never block you.
  - They have their own chime and volume.
- **Flow meter:**
  - 0–30%: clean.
  - 30–70%: faceted sparkles orbit the runner.
  - 70–99%: polygon shards burst on near misses.
  - 100%: a 3.5 s **Flow Zone** with rotating prism rings and a prismatic colour grade.
  - Getting hit cuts Flow.
- **Speed blur** (off by default, with a strength slider): thin streak lines at the screen edges at high speed. There is no full-screen effect, and it's off in bird's-eye view.

## SET menu (everything in it)

**Quality**
- LOW / MEDIUM / HIGH / ULTRA
- **Show FPS:** small corner overlay with current FPS, average, 1% low, minimum and frame time, plus **RESET**
- **Reset FPS**
- **Auto-tune graphics**, with Target FPS (AUTO / 30 / 45 / 60) and **Re-tune**
- **Adaptive safety net**

**Flow experience**
- **GROUNDING:** ambient sound only, gentle motion
- **CLASSIC:** playlist, balanced effects
- **SENSORY:** playlist, stronger shimmer, +20% rewards, dash costs 22

**Sound and feel**
- **Sound effects** (M)
- **Music:** 3 songs in a loop, with a song indicator and **Next song**
- Volume sliders: **Master**, **Music**, **Ambience**, **Effects** (0–100)
- **Ambience sounds:** each one has its own on/off and a 0–100 volume.
  - Crowd chatter, Rain, Wind, Seagulls, Bells & wheels, Cafe clinks, Dog barks
  - Footsteps, Horns, Traffic, Aircraft, Kites, Gatherings, Performers
  - City windows, Balloons, Ice cream truck, Vendors, Gym, Bikes & scooters, Gem pickups
  - Buttons: **Test sounds** and **All on**
- **Vibration** on near miss, pickup and contact (phones)

**Runner**
- FEMALE (ponytail, white top) or MALE (short hair, blue tee)

**Muscle shading**
- On/off. It works on HIGH / ULTRA only, fades out past about 17 m and costs nothing on LOW / MEDIUM.
- Strength: SOFTER / NORMAL / STRONGER
- **Only on bare skin**

**Sky and promenade** (on/off each)
- Elderly pedestrians
- Aircraft
- Bikes & scooters
- Outdoor gyms
- Vendors
- Ice cream truck

**Flow, gems and props**
- **Flow visuals** (on/off)
- **Geometric props** (on/off)
- **Speed blur** (on/off) with **Blur strength** (default 60)
- **Balloon people** (on/off)
- **Crowd gatherings:** OFF / SOME / LOTS

**Graphic style**
- 3D / 3D ANIME / ANIME
- **Family groups** (on/off)

**Camera**
- 3RD PERSON / 1ST PERSON / BIRD'S-EYE
- **Head-bob in 1st person** (on/off)

**Other**
- GPU readout with **Auto-detect**
- Settings are saved in the browser.

## Hidden FPS debug export

- **Turning it on:** either add `?debug=fps` to the URL, or open SET and **long-press the version label** ("v2.5.55") for about 1.2 s. Long-press again to turn it off. It is off after every reload.
- **The panel:** a small "FPS DEBUG EXPORT" panel appears.
- **What it records:** running frames only. It skips frames while paused, while SET is open and while the tab is hidden. It holds up to 18,000 frames.
- **Stats:**
  - avg FPS
  - 1% low and 0.1% low
  - frame-time percentiles p50 / p90 / p95 / p99 / p99.9
  - the preset, weather, style, camera and average draw calls
  - device info: screen size, pixel ratio, CPU cores, memory and GPU name
- **Buttons:**
  - **RESET:** clears the recording
  - **JSON:** saves the full report plus every frame time
  - **CSV:** saves a summary plus one line per frame
  - **COPY:** copies the summary
  - **HIDE:** turns the panel off

See `DEBUG-FPS.txt` for full instructions.

## Performance notes

- **Built for phones and modest GPUs.** The crowd, dogs, bikes, props, gems and umbrellas are drawn as instanced meshes. There are no three.js lights, shadow maps, render targets or full-screen post passes. Everything uses the game's own sun, ambient and fog shader.
- **Draw calls in rain:** about 73 / 92 / 95 / 97 (LOW / MEDIUM / HIGH / ULTRA). Triangle counts are roughly 156k / 243k / 343k / 440k in the same scene.
- **Each new effect costs about one draw call.** Speed blur only adds its draw when it's on and you're running fast.
- **Anime styles** add one outline draw per outlined group. They cost nothing in 3D.
- **On weak devices:** use LOW, or let Auto-tune and the adaptive safety net handle it.

## Known issues (v2.5.55)

- **Surfer board grip:** walking surfers hold the board at their side, slightly behind the arm, not clearly tucked under it.
- **Surfer hands and shoulders:** they render in the dark wetsuit colour.
- **Over-stretched leash:** rarely, a dog's leash stretches past 2.6 m (about 0.4% of the time in a long simulation). This happens when the owner is boxed in by an obstacle. The dog never goes through the obstacle.
- **Owner lean:** when a dog pulls, the owner's lean is subtle.

## Version history

See `CHANGELOG-v2.5.55.md` for this release (v2.5.55: all remaining box people converted to rounded). The v2.5.52 changelog is in `dist/`. Earlier changelogs (v2.5.50, v2.5.51, v2.5.52) are in the project's `dist/` folder.
