# v2.5.58 — Laser show, plaza stands, FOG phases (built on v2.5.57)
All new switches default OFF, so with everything off the determinism hashes equal v2.5.57 (checked: off / Distance Physics / wheel).
Turning the laser or stands switch on also turns the Ferris wheel on.

## Laser show (SET: "Laser show", intensity LOW / NORMAL / HIGH)
- Rainbow beams at the base of every wheel (3 emitters): two rotating cones and one sweeping fan, hue cycles over time.
- Active at dusk / night phase (the game's dusk lighting, lights >= ~0.4), fades out as rain builds, glows wider and brighter in fog.
- ONE additive mesh, vertex-shader animation, no real lights, no full-screen pass. Draw calls +1 only when visible.
- Beams per emitter: LOW 4, NORMAL 7, HIGH 11. LOD cap: LOW preset 3, MEDIUM preset 5.

## Plaza stands (SET: "Plaza stands")
- 4 rounded stands around each wheel base (right strip): tickets, snacks / ice cream, drinks, balloons / souvenirs. Striped domes, edge bulbs, glowing signs, props (ice-cream cone, cups, bobbing balloon bunch). Lit at dusk (same lights as the wheel). Geometry is merged into the wheel mesh: 0 extra draw calls.
- Vendors are real poly-folk (existing figure instances, complete figures) pinned behind each counter, facing the street. Customers form small queues (needs Crowd gatherings SOME / LOTS), pay through the existing wallet code (ice / pop / balloon spend, cha-ching), and walk off with cones, drinks or balloons.
- Rain rule: vendors and customers leave when rain > 0.35; stands re-staff afterwards.
- Vendor calls use the game's inverse-square sound falloff and their own volume row "Plaza stands" under Ambience sounds.
- Private RNG for stand logic, so other random streams are untouched.

## FOG phases (SET: "Fog phases", density LIGHT / NORMAL / DENSE)
- Adds two weather presets to the cycle: FOG (day mist) and DUSK FOG (glowing misty dusk). Uses the existing scene fog and shader uniforms: no extra draw calls, no full-screen passes.
- Cool grey-white fog, softened sun, damp sheen, reduced view (NORMAL: far 100 / 92 m; LIGHT x1.45; DENSE x0.62).
- Effects: master volume -25% at full fog, people walk up to 30% slower, kites / aircraft ease off (weather factor), performers do not start in thick fog (milder than rain), wheel and stand lights get a halo boost, lasers widen and brighten.
- Turning it off removes the two presets from the cycle.

## Unchanged
- Improved error card and end-of-file marker. Phone html is full size (13,415,846 bytes, about 13.4 MB).
