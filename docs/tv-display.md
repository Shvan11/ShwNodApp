# Waiting-room TV display (digital signage)

An unattended, looping photo/video slideshow on the clinic's waiting-room LG
webOS TV, driven entirely from **Settings → TV Display**. What plays is an
explicit **playlist** — an ordered sequence in which a file may appear more than
once (so one logo/bumper can sit between every clip with **no duplicate file on
disk**). The media folder is just the pool of available files; dropping a file
into it puts it on the server but does not auto-play it — the settings tab then
prompts to add it to the playlist.

This doc is for **both humans and AI agents**: staff/IT who just want to
change what's on screen, and anyone (human or Claude) about to touch the
code or the scheduler. Read the relevant section — you don't need the whole
file for a simple content swap.

---

## For staff / IT: how to use it

**Add content** — two ways to get a file onto the server:
- Settings → TV Display → "Add pictures / videos" (drag/drop or file picker) —
  this also drops the file straight into the playlist, ready to play; or
- Copy files into the media folder on the server (ask IT for the path — it's also
  shown at the bottom of the Settings → TV Display tab). A file added this way is
  **not** in the playlist yet: the tab shows it under "in the folder but not in
  the playlist" with an **Add** button.

**The playlist is what plays.** In the tab, each row is one slot in the loop.
Reorder with the up/down arrows, **⧉ duplicate** a row to play that clip again
later (this is how you put a logo between every video — one file, many slots),
**✕ remove** a slot (the file stays on the server), or **🗑 delete** the file
entirely. Playlist edits are saved with the **"Save playlist"** button.

**Remove content** — ✕ takes a slot out of the loop; 🗑 deletes the file from the
server (and removes every slot that used it).

Changes reach the screen in about a second — no restart, no app, nothing to reload.

**Supported types** — anything else (Word docs, PSDs, HEIC iPhone photos,
MKV/AVI videos, stray text files) is silently skipped by the TV and flagged
in the Settings tab as "can't play":
```
Pictures : .jpg  .jpeg  .png  .gif  .webp
Videos   : .mp4 (H.264)   .webm   .ogg
```
Export/convert to one of those first (e.g. iPhone photos → JPG).

**Play order** — the playlist's own order, top to bottom, set with the up/down
arrows in the Settings tab (filenames are never renamed — order is stored in the
playlist, not in `01-`/`02-` prefixes). A clip can appear in multiple slots and
plays each time it's listed.

**Schedule** — Settings → TV Display → Schedule card sets the daily on/off
times and the volume the TV comes on at (staff can still adjust volume with
the remote during the day; the scheduler won't fight them).

**Manual controls** (need the TV scheduler connected — see Troubleshooting):
- **Turn TV on now** — wakes it immediately, stays on until the schedule's
  off-time.
- **Turn TV off now** — turns it off **for the rest of the day**: the
  scheduler will not try to wake it again until tomorrow's on-time (or you
  press "Turn TV on now"). For a longer pause (holidays, maintenance), use
  the "Run the waiting-room screen automatically" switch instead — that
  suspends everything until you flip it back on.
- **Reload the slideshow** — refreshes the page on the TV without touching power.

**Never put patient photos, x-rays, or any PHI in the media folder** — it is
served to a public, session-less URL that the TV's browser opens with no login.

### Troubleshooting

The Settings tab's "Right now" card shows two live indicators:
- **Screen** — the TV browser has the slideshow page open right now.
- **TV scheduler** — the background service that powers the TV on/off is
  connected. If this shows "Not connected", the manual buttons are disabled;
  check the "LG TV Signage" scheduled task on the server (see below).

If the screen is dark during opening hours with the scheduler connected: the
TV was reachable when this doc was last verified (2026-07-24), and the daemon
now **keeps re-waking it every ~60s** until it responds (see the "Robustness"
section below) — so a single missed Wake-on-LAN packet, a brief power cut, or
someone turning it off with the remote all self-heal within a minute or two.
If it stays dark much longer than that, the TV itself has lost power/network,
or its Wi-Fi has gone into a standby mode deep enough that WoL can't reach it
— check the physical TV and its network connection.

---

## For AI agents / developers: architecture

Two halves, one store, no database:

| Piece | File | Notes |
|---|---|---|
| Public, session-less routes (page, manifest, media stream, event stream, raw settings) | `routes/public/tv-display.routes.ts` | Mounted **before** the auth gate — the TV browser has no login. |
| Staff-facing admin API (settings, upload/delete media, edit playlist, one-shot commands) | `routes/api/tv-display.routes.ts` | Behind the normal staff-session gate; open to `ALL_ROLES`. |
| Shared store: settings file (incl. playlist) + media folder + SSE client registry | `services/files/tv-display-store.ts` | Both routers import this — it's the only thing that touches disk. |
| Shared contract | `shared/contracts/tv-display.contract.ts` | Zod SSoT for the admin API, per the repo's contract convention. |
| Settings tab UI | `public/js/components/react/TvDisplaySettings.tsx` | |
| External scheduler daemon (separate project, NOT in this repo) | `C:\Users\Administrator\lgtv-scheduler\tv_daemon.py` | Runs as Windows scheduled task **"LG TV Signage"** (S4U logon, survives RDP/console logoff). Log: `lgtv-watch.log` beside it. |

**No database, by design** — settings (including the `playlist` array) live in one
JSON file (`data/tv-display.settings.json`, override `TV_DISPLAY_SETTINGS_FILE`)
and media are plain files on disk (`tv-media/`, override `TV_DISPLAY_MEDIA_DIR`).
Both are per-deployment machine config, not clinic data — keeping them off the DB
means the waiting-room screen keeps playing through a database outage, and neither
is included in a DB backup/restore.

**The playlist is the single source of truth for what plays.** It's an ordered
array of filenames (repeats allowed) stored beside the settings. The public/TV
read path serves the *resolved* playlist (in order, repeats kept, dangling
entries — files removed by hand — skipped) as the SSE `items`, so the TV page
just plays `items` top to bottom. Order lives here, **not** in filename prefixes,
so files are never renamed. **Upgrade/seed:** a settings file from before
playlists (`playlist` absent → stored as `null`) is seeded **once** from the
folder's current filename order the first time the *authenticated* management
side reads it (`ensurePlaylist`), so an existing deployment keeps playing its
content and only then becomes strict. The public read path treats `null` as
"fall back to folder order" **without writing**, preserving the public router's
zero-writes invariant. An **upload through the tab** auto-appends to the playlist
(explicit "play this"); a **hand-dropped** file does not (it surfaces as
"available" for a one-click Add). A **delete** prunes every slot that used the file.

**Push, not poll** — the TV page and the daemon each hold one SSE stream
open (`GET /tv-display/events?client=page|daemon`). A save from the Settings
tab reaches both within about a second via `broadcastState()`. The daemon
also receives one-shot commands (`on`/`off`/`reload`) the same way. Nothing
here runs a polling loop except a documented 5-minute degraded-mode fallback
on the TV page and a 25s SSE keepalive.

**The daemon is the only thing that talks to the physical TV** — over LG's
SSAP WebSocket protocol (port 3001) via the zero-dependency
`lgtvremote_cli` module (`site-packages`), plus Wake-on-LAN for powering it
on. It only ever tells the TV to open `SLIDESHOW_URL`
(`/tv-display`) — all playback logic (looping, per-image dwell, shuffle,
fit, sound) lives in that page's own JS, not the daemon.

### Robustness (added 2026-07-24)

Originally the daemon treated the on-time as a **one-shot edge**: send one
Wake-on-LAN at the boundary, then only retry a bare TCP connect. A TCP
connect can never wake a powered-off TV — only WoL can — so a single missed
packet (deep Wi-Fi standby, a power cut exactly at on-time, power restored
hours later) left the screen dark for the rest of the day with no recovery
and no log signal.

It's now **level-triggered** (a thermostat, not an alarm clock): a `want_on`
desired-state flag is reconciled continuously. While `enabled && want_on &&
in_window && disconnected`, the daemon re-sends WoL every `WOL_RETRY_S` (60s),
piggy-backing the existing 30s reconnect loop — no new threads/timers, and
zero extra cost once connected or outside the window. This means:
- A missed on-time WoL is retried automatically.
- A TV that loses power mid-afternoon and comes back at a random time is
  woken on the next retry after it can hear WoL again.
- A remote-control (or the TV's own eco/auto-off) power-off during opening
  hours is treated as a fault and undone within ~60–120s — **enforcing the
  window** is a deliberate choice; "Turn TV off now" from the web app (or the
  schedule switch) is the sanctioned way to actually keep it off.

**Web-app "Off" persists across restarts.** Pressing "Turn TV off now" sets
`want_on = False` and writes a suppression deadline (next on-time) to
`tv_daemon.state.json` beside the daemon script. On daemon/box restart, that
file is reloaded and the day's on-boundary is pre-consumed, so a restart
can't accidentally re-wake a TV staff deliberately turned off. "Turn TV on
now", or the next day's scheduled on-time, clears it.

Verified 2026-07-24: this TV wakes over Wi-Fi via WoL in ~3 seconds once a
packet is heard — the original 15:00 outage was purely the missing-retry
design flaw, not a hardware limitation. If a future outage shows the retries
going unheard for a long stretch, the next place to look is the TV's own
network/standby settings (Quick Start+, "Mobile TV On"/Wake-on-LAN), or
moving it to a wired Ethernet connection (its wired MAC is on file in
`~/.config/lgtvremote/devices.json` on the scheduler box).

### Gotchas — don't regress

- **Never** let a raw `stat`/`lstat` per file creep into `listMedia()` (the
  TV's hot path) — type comes off `readdir`'s `Dirent`. `listMediaDetailed()`
  (management UI only) is where per-file `stat` is fine.
- **The playlist array IS the play order** (`playlist` in the settings file) —
  files are **never renamed**. Because order lives in the array, per-image dwell
  overrides (`photoMsByName`) are keyed by the file's own name and only need
  dropping when the file is deleted (`forgetDuration`); there is no reorder
  re-keying. A file may appear in the array multiple times — don't dedupe it.
- **Only the management side may seed/persist the playlist.** `ensurePlaylist`
  (seed-once from folder order) and every playlist mutation run behind the auth
  gate. The public/TV path calls the read-only `resolvedPlaylist` (null → folder
  order, no write) — do not make it persist, or the "public router has zero
  writes" invariant breaks.
- **Never** hand-roll a settings interface — `TvDisplaySettings` in the
  shared contract is the SSoT on both sides.
- The public router has **zero writes** — every mutation lives on the
  authenticated `/api/tv-display*` half. Don't add a write to the public one.
- `mediaFilePath()` is the one path-traversal/extension guard used by every
  disk operation in both routers — never bypass it with a raw `path.join`.
- This file (`docs/tv-display.md`) used to be `tv-media/README.txt`,
  which the TV's own folder scanner flagged as an "unsupported file" (it's a
  `.txt`, not playable media) — every time someone read the "1 file the TV
  can't play" warning in Settings → TV Display, it was this file. Don't put
  documentation back inside `tv-media/` — it's playable-content-only, by the
  same rule that keeps PHI out of it.
