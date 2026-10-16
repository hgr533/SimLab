# v2.5.55 — fix: "The game did not start" (incomplete file) + real error text

Built on v2.5.54. Game code and Evolving Crowd are unchanged.

## What went wrong
The v2.5.54 file that failed on the phone was **cut off at exactly 4,194,304 bytes (4 MiB)**; the full file is 13,373,239 bytes. A cut-off file never reaches the end of the game script, so the game cannot start and the generic "did not start" card appeared. The first 4 MiB are byte-identical to the good build; the full v2.5.54 file loads fine in Chromium (WebGL via SwiftShader), with and without localStorage, with Evolving Crowd on or off. Cause: the copy/transfer, not the code.

## Changes
- **Real error on screen:** the "The game did not start" card now shows the actual error text (message, file, line) and the version.
- **Incomplete-file detection:** a marker at the very end of the file tells the card when the file was cut off, and it then says so ("delete and copy again, about 13 MB") instead of blaming WebGL.
- Also catches rejected promises; the card hides itself if the game does boot late (slow phones).
- Version label v2.5.55.

## Tests (headless Chromium, Pixel 7 + Redmi UA, file://)
Boots OK: normal, localStorage throwing, Evolving Crowd saved ON. Truncated 4 MiB file: shows "incomplete" message. Injected exception: shows its text.
