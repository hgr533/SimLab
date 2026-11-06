# Emerald Klondike

A lightweight, classic Klondike solitaire game for a Windows PC and an Android phone. Green felt, crisp cards, mouse and touch controls, and an English/Hebrew interface. No advertising or game account is required by the local game.

## Play on this PC

Extract the complete game folder, then double-click **Launch-Klondike.cmd**.
It opens the game in your default browser and works without an internet connection.
You can also open **dist/index.html** directly. Keep the files together in the same folder.

## Play on your Redmi

Open the published game link in Chrome on your phone. If the published link is private, sign in with the same account that owns it when prompted.

In Chrome's menu, choose **Add to Home screen** or **Install app**. Open the game online once and let it finish loading before testing it offline. The installed game can then use its cached files when the phone has no connection.

Installation and offline caching require the published HTTPS link (or localhost during development). A local file opened on the PC runs the game, but cannot install its service worker.

## How to play

- Choose **Easy** (draw one, unlimited stock passes), **Classic** (draw three, unlimited passes), or **Challenge** (draw three, one recycle pass). You can override the preset's draw count separately. Settings apply to the next deal; your current hand is preserved.
- Build tableau columns downward, alternating red and black. Only a King or a sequence starting with a King can fill an empty column.
- Build the four foundations upward by suit, starting with Aces.
- Tap a card or face-up sequence, then its destination; mouse and touch dragging are also supported.
- Double-click or double-tap a free card to send it to a legal foundation.
- Use **Undo** to take back a move, **Hint** for a legal suggestion, and **Auto-finish** when the remaining cards can be completed automatically.
- Use the language switch for English or Hebrew. The card table keeps its familiar arrangement in either language.

## Saved games

The game saves progress in the browser on each device. The PC and Redmi keep separate saves; there is no automatic cloud synchronization. Use the same browser and profile to return to your saved game. Clearing browser data removes locally saved progress.

## Technical notes

This is a buildless HTML/CSS/JavaScript application. There are no runtime frameworks, external fonts, remote card images, or WebGL requirements. It is intended to stay comfortable on modest hardware.

The `dist` folder contains the playable app, manifest, icons, and service worker. The service worker caches only the game's own known files and verifies the game document before caching it; it does not cache sign-in pages.
