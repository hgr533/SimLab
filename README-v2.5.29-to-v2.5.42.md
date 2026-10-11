# Beach Boulevard Runner — Changelog since v2.5.29

Single-file Three.js promenade runner. Latest build: **v2.5.42**.

---

## v2.5.30 — Crowd and vehicle polish

- Elderly poly-people added (grey/white hair, slower stooped walks, canes, rollators, couples arm-in-arm, wheelchairs with companions). Later discarded.
- Benches along the plaza for resting.
- Elderly shop at cafés, head indoors in rain, and have an on/off switch in SET.
- Bike fixes: wheels spin with speed, e-scooter riders stand upright, deck scooters keep at least 2 m clearance from the player.
- Draw-call count kept roughly the same.

## v2.5.31 — Preview and WebGL stability

- Sandbox proxy connection issues addressed by stripping embedded audio to a slim fallback (empty arrays + fetch 404s) so the iframe payload stays smaller.
- JS syntax breaks from `//` comments in earlier patches fixed with targeted string replacements.
- Tailwind v4 auto-scanning hang fixed with explicit `@source` directives and cache clear.
- WebGL 2 context creation verified against Mali-G57 / ANGLE reports.
- Watcher timeout increased to reduce false “scripts blocked” warnings.

## v2.5.32–v2.5.37 — Reshimu observer and Bushido AI

- **Reshimu observer** added as a non-steering telemetry layer.
  - Samples at 4 Hz via `setInterval` outside the rAF loop.
  - Ring buffer of position, velocity, actions, rewards, and collisions.
  - Rapidity / Belief / Law modules.
  - Deferred TzimtzumSimulation for offline parameter optimization (not in the gameplay loop).
- **Bushido tactical AI** integrated:
  - Kerr ergosphere radius scaled by speed and heat.
  - Gi (rectitude) — lane spring.
  - Yu (courage) — panic / stubbornness response.
  - Jin (benevolence) — family coherence nudges.
  - QNH optimizer (chaosAdmit / compactnessTargetM tied to heat).
- InstancedMesh crowd uses targetX exponential damping (`Math.exp` / `tanh`) and keepClear distance.
- Vertex-shader wheel spin retained.

## v2.5.38 — AI merge confirmation

- Bushido forces confirmed additive and non-breaking against existing velocity damping.
- Reshimu observer presence verified after the AI merge.

## v2.5.39 — Reshimu UI consolidation

- Reshimu observer merged into the existing FPS counter box.
- FPS panel extended with Reshimu rows (belief, rapidity, law).
- Reshimu tick now writes directly to the FPS slots.
- Version string bumped.

## v2.5.40 — Anime / manga shader pass

Graphic style system (`uGraphicStyle`): 0 = 3D, 1 = 3D Anime, 2 = Anime.

| Technique       | 3D Anime          | Anime                     |
|-----------------|-------------------|---------------------------|
| Shade bands     | 4, soft edges     | 2, hard steps             |
| Saturation      | +28%              | +55%                      |
| Shadow tint     | cool blue-purple  | same, stronger on dark    |
| Rim light       | faint warm        | stronger                  |
| Hard specular   | small flat blob   | larger flat blob          |
| Screen-tone     | none              | mid-band dots             |
| Color steps     | none              | 8-step posterize          |
| Ink             | medium            | thick                     |

- Vendor proximity rings extended to popsicle and balloon sellers.
- Button labels updated to reflect soft cel / hard cel + tone.

## v2.5.41 — Rounded figures

| Mesh              | Before              | After                                      |
|-------------------|---------------------|--------------------------------------------|
| Vendors (P1)      | box legs/arms/torso | limb legs/arms, tapered torso, ellipsoid head |
| Mid crowd (Qd)    | box limbs and torso | limb legs/arms, ellipsoid torso and head   |
| Far crowd (ep)    | boxes               | limbs and ellipsoids                       |
| Mid/far dogs      | box body and head   | ellipsoid body and head                    |

Near crowd and the runner were already using rounded paths.

## v2.5.42 — Rounded cars and remaining poly-world

| Item                    | Before           | After                                      |
|-------------------------|------------------|--------------------------------------------|
| Cars (aM)               | box hull/cabin   | ellipsoid hull and cabin, ellipsoid lights |
| Ice-cream truck         | box body         | ellipsoid body                             |
| Scooter rider (WR)      | box limbs        | limb legs/arms, ellipsoid torso and head   |
| Seated people (DC)      | box limbs        | limb legs, ellipsoid torso and head        |
| Standing helpers (el, DM) | box limbs/torso | limb legs/arms, ellipsoid torso and head   |
| Planter pots (fM)       | box pots         | ellipsoid pots                             |

Buildings, pavement, and benches remain boxy by design. Wheels were already cylinders.

---

## Running the latest build

Open `BoulevardRunner-v2.5.42-phone.html` in a modern browser with WebGL 2 enabled (Chrome recommended).  

Local server (optional, for cleaner asset fetches):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/BoulevardRunner-v2.5.42-phone.html
```

Controls: SPACE / click / tap to run. SET panel for graphic style, camera (3rd / 1st / bird), and feature toggles. Reshimu telemetry appears inside the FPS counter when active.

---

## Notes

- The HTML is self-contained. Embedded audio is a slim fallback; missing external audio files fail silently.
- TzimtzumSimulation stays deferred — it does not run inside the frame loop.
- Screen-tone in Anime mode is a simple mid-band dot pattern and is skipped on light and dark bands.
- All damping uses frame-rate-independent methods where possible.
