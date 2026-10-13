# Beach Boulevard Runner v2.5.52

Built on v2.5.51.

## Elderly folk
- Elderly people no longer walk on the boulevard: the runner's deck, the left deck edge (x≈-3.85) and the bike lanes are off-limits. If one would have spawned on the deck, it goes to the plaza walkway or the sand instead.
- They still appear on the plaza walkway behind the cafés, on plaza benches, in cafés and on the sand.
- Checked with a 60,000-step simulation (about 18.5 km): 0 elderly on the deck. In v2.5.51 the same run had elderly on the deck in about two-thirds of samples.

## Vendors and surfers
- Rebuilt the vendor figure: shoes, jointed legs, hips, a rounded torso, neck, head, a cap with a brim that sits on the head, shoulders and hands. It has poses for pushing a cart, carrying a cooler and holding balloons, with the balloon strings running to the hand.
- The ice-cream truck has a half-body server at the window.
- Surfers have a rounded head, neck and shoulders, and both hands grip the board.
- Surfers now have a near model, so they no longer disappear up close (in v2.5.51 they were hidden near the camera). Near surfers also get the ink outline.
- Everything uses the game's normal material path. Draw calls are about the same.

## Leashed dogs
- The leash is longer, about 2.6 m, and pulls taut. Dogs now do running bursts, quick darts, sniff detours and circles around their owner. This partly reverses the v2.5.49 "dogs closer to owners" change on purpose.
- When the leash is at full length, the dog drags the owner toward it. The owner leans or stumbles and looks toward the dog, then recovers.
- Dogs stay on the deck. They avoid obstacles and never go into walls, cafés or the road. The existing beach-walk behaviour is unchanged.
- The dogs are decoration only. The longer leash just gives more chances for the existing "LEASH HOP" bonus.
- Dog choices come from a seeded hash, not the AI's random-number stream. The game is still deterministic, but runs are not the same as in v2.5.51 because the dogs and owners move differently.
