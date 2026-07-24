/**
 * TV Display — public digital-signage slideshow for a waiting-room TV.
 * ---------------------------------------------------------------------------
 * PUBLIC, SESSION-LESS HALF of the signage feature: everything the TV itself
 * talks to. The staff-facing half (Settings → TV Display) lives behind the auth
 * gate in `routes/api/tv-display.routes.ts`; both share one store module,
 * `services/files/tv-display-store.ts`, which owns the media folder and the
 * settings file. This file touches no database and no PHI. To remove the whole
 * feature: delete these three files, the contract, the settings tab, and the
 * two mount lines (search "tv-display").
 *
 * WHY IT EXISTS
 *   The clinic's LG webOS TV runs an on/off + app-launch daemon (a separate
 *   project, `lgtv-scheduler`). The goal is an unattended looping slideshow of
 *   mixed photos + short videos on that TV during opening hours. The TV's Plex
 *   app cannot be driven remotely (it acknowledges playback commands but never
 *   plays — a dead end documented in the daemon project). The robust path is:
 *   the daemon opens the TV's built-in web browser at this page, and this page
 *   loops the contents of a media folder forever. All playback logic is ours,
 *   so mixed photo/video looping "just works" (the browser renders both).
 *
 * HOW STAFF UPDATE CONTENT
 *   Either from Settings → TV Display (upload/delete/reorder, no file access
 *   needed), or by dropping files straight into the media folder — both are
 *   first-class: the folder IS the playlist and its filename order IS the play
 *   order. The page re-scans every 60s, so changes appear within a minute
 *   without a restart or a page reload.
 *
 * SECURITY POSTURE (intentionally public, LAN signage)
 *   - Mounted BEFORE the auth gate in index.ts, exactly like the public video
 *     routes (`/v`) and the chair-display SSE route: the TV browser has no
 *     login session. This is deliberate and safe because the ONLY thing
 *     reachable here is whatever a human dropped into the media folder — a
 *     folder that must contain signage content only, never PHI.
 *   - Every route here is a READ. All writes (settings, uploads, deletes,
 *     reorder, commands) require a staff session on the /api half, so nothing
 *     session-less can change what the TV shows.
 *   - The media endpoint serves files strictly from within MEDIA_DIR: the
 *     requested name is reduced to its basename and the resolved path is
 *     verified to stay inside MEDIA_DIR (path-traversal is rejected), and only
 *     an allow-list of image/video extensions is served.
 *
 * CONFIG
 *   Behavior is stored in `data/tv-display.settings.json` and edited from the
 *   settings tab (see the store module for paths + defaults). URL query params
 *   still override the stored settings for one-off testing without touching the
 *   saved config:
 *     ?photoMs=8000   image dwell time in ms
 *     ?shuffle=1|0    randomize order each loop
 *     ?fit=cover      fill screen, cropping (vs "contain" = letterbox)
 *     ?sound=1|0      play video audio. If the browser blocks unmuted autoplay,
 *                     the video retries muted so the loop never stalls (the
 *                     debug overlay reports SOUND BLOCKED).
 *     ?debug=1        show a small diagnostic overlay
 */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { log } from '../../utils/logger.js';
import { streamFile } from '../../utils/stream-file.js';
import {
  MIME,
  addClient,
  getSettings,
  listMedia,
  mediaFilePath,
  sendState,
  type SignageClientKind,
} from '../../services/files/tv-display-store.js';

const router = Router();

/**
 * GET /tv-display/events?client=page|daemon
 * The push channel — the reason nothing here polls. The TV page and the LG
 * daemon each hold one of these open; the server sends a `state` frame on
 * connect and again whenever staff save something, plus `command` frames
 * (on/off/reload) to daemon streams. Idle cost is one open socket and a 25s
 * keepalive comment shared by all streams.
 *
 * Public like the rest of this router: the TV has no session. It is read-only —
 * a stream can only receive, never change anything.
 */
router.get('/events', async (req: Request, res: Response): Promise<void> => {
  const kind: SignageClientKind = req.query.client === 'daemon' ? 'daemon' : 'page';

  // Bypass the global 30s request timeout, or the stream would 408 (the same
  // hygiene the app's other SSE handlers use).
  req.setTimeout(0);
  res.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Jittered retry hint so a server restart doesn't bring every client back at
  // the same instant.
  res.write(`retry: ${2500 + Math.floor(Math.random() * 2500)}\n\n`);

  const dispose = addClient(kind, res);
  req.on('close', dispose);
  res.on('error', dispose);

  try {
    await sendState(res);
  } catch (error) {
    log.error('[TV Display] initial state push failed', { error: (error as Error).message });
  }
});

/**
 * GET /tv-display/manifest
 * Current playlist (live directory scan, ordered by filename) plus the stored
 * settings. The page fetches this ONCE at boot so it can render before the event
 * stream says anything, and again only if the stream is down (its degraded
 * mode); every normal update arrives as a pushed `state` frame. Also handy for
 * diagnostics — open it in a browser to see exactly what the TV would play.
 * A missing folder is not an error: an empty list makes the page show its
 * placeholder until content appears.
 */
router.get('/manifest', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [items, settings] = await Promise.all([listMedia(), getSettings()]);
    // Signage content changes rarely and the page polls on its own timer; a
    // short no-cache keeps every poll honest (picks up folder edits at once).
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items, settings });
  } catch (error) {
    log.error('[TV Display] manifest scan failed', { error: (error as Error).message });
    res.status(500).json({ items: [], error: 'manifest scan failed' });
  }
});

/**
 * GET /tv-display/settings
 * Raw, un-enveloped settings — a diagnostics read (`curl` it to see what the
 * daemon is enforcing) and the daemon's one-shot bootstrap if it ever starts
 * while the event stream can't be established. Not polled by anything.
 */
router.get('/settings', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ settings: await getSettings() });
  } catch (error) {
    log.error('[TV Display] settings read failed', { error: (error as Error).message });
    res.status(500).json({ error: 'settings read failed' });
  }
});

/**
 * GET /tv-display/media/:file
 * Streams one media file from MEDIA_DIR. Path-traversal-safe and extension-
 * gated (both enforced by the store's mediaFilePath guard). Supports Range (via
 * the shared streamFile helper) so video seeks/loops behave.
 */
router.get('/media/:file', async (req: Request<{ file: string }>, res: Response): Promise<void> => {
  try {
    const full = mediaFilePath(req.params.file);
    if (!full) {
      res.status(403).send('Forbidden');
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(full);
    } catch {
      res.status(404).send('Not found');
      return;
    }
    if (!stat.isFile()) {
      res.status(404).send('Not found');
      return;
    }

    const ext = full.slice(full.lastIndexOf('.')).toLowerCase();
    streamFile(req, res, full, stat.size, MIME[ext] || 'application/octet-stream');
  } catch (error) {
    log.error('[TV Display] media stream failed', { error: (error as Error).message });
    res.status(500).send('Failed to stream media');
  }
});

/**
 * GET /tv-display
 * The full-screen slideshow page. Self-contained HTML+JS (no external assets,
 * no build step) so it is served verbatim and works in the webOS browser.
 */
router.get('/', (_req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Never cache the shell: the TV browser must pick up page updates on the next
  // (re)launch rather than replaying a stale copy. The page is tiny; the media
  // it references is what's actually large, and that streams on demand.
  res.setHeader('Cache-Control', 'no-store');
  res.send(PAGE_HTML);
});

// ---------------------------------------------------------------------------
// The page. Kept as a template literal (same approach as the public video page)
// so the whole feature is one file with nothing to wire into the client build.
// Behavior is documented inline. Every tunable arrives from the manifest poll,
// so a settings change applies within one poll with no reload and no restart;
// a URL query param, when present, pins that one tunable for the session.
// ---------------------------------------------------------------------------
const PAGE_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Shwan Orthodontics</title>
<style>
  html, body { margin: 0; padding: 0; width: 100vw; height: 100vh; background: #000; overflow: hidden; }
  body { cursor: none; }
  .layer {
    position: absolute; inset: 0; width: 100%; height: 100%;
    opacity: 0; transition: opacity 900ms ease; background: #000;
  }
  .layer.visible { opacity: 1; }
  img.layer, video.layer { object-fit: contain; }
  body.fit-cover img.layer, body.fit-cover video.layer { object-fit: cover; }
  #placeholder {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #667; font: 300 2.2vw -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center;
    background: #000; transition: opacity 900ms ease;
  }
  #placeholder.hidden { opacity: 0; pointer-events: none; }
  #debug {
    position: absolute; top: 10px; right: 14px; z-index: 20; display: none;
    color: #3f6; font: 16px/1.4 monospace; text-shadow: 0 0 4px #000; white-space: pre; text-align: right;
  }
  body.debug #debug { display: block; }
</style>
</head>
<body>
  <img    id="imgA" class="layer" alt="">
  <img    id="imgB" class="layer" alt="">
  <video  id="vid"  class="layer" muted playsinline preload="auto"></video>
  <div id="placeholder">Shwan Orthodontics</div>
  <div id="debug"></div>
<script>
(function () {
  'use strict';

  // ---- live config -------------------------------------------------------
  // Defaults are replaced by the stored settings on every manifest poll, so an
  // edit in Settings → TV Display shows up in about a second. A query param, when
  // present, pins that tunable for this session and ignores the stored value
  // (one-off testing without touching the saved config).
  var q = new URLSearchParams(location.search);
  // photoMsByName: per-image dwell overrides keyed by filename (see the store).
  // Not query-pinnable — it is only ever pushed from the saved settings.
  var cfg = { photoMs: 7000, photoMsByName: {}, shuffle: false, sound: true, fit: 'contain' };
  var pinned = {
    photoMs: q.has('photoMs'),
    shuffle: q.has('shuffle'),
    sound:   q.has('sound'),
    fit:     q.has('fit')
  };
  if (pinned.photoMs) cfg.photoMs = Math.max(1000, parseInt(q.get('photoMs'), 10) || 7000);
  if (pinned.shuffle) cfg.shuffle = q.get('shuffle') === '1';
  if (pinned.sound)   cfg.sound   = q.get('sound') === '1';
  if (pinned.fit)     cfg.fit     = q.get('fit') === 'cover' ? 'cover' : 'contain';
  if (q.get('debug') === '1') document.body.classList.add('debug');

  // The page does NOT poll. It fetches once at boot so it can start playing
  // immediately, then holds an event stream open and applies whatever the server
  // pushes (a save reaches the screen in about a second, at zero idle cost).
  // FALLBACK_MS only matters if that stream is unavailable — then, and only
  // then, the page re-fetches on this slow interval so the screen can never get
  // stuck on stale content.
  var FALLBACK_MS = 300000;   // 5 min, degraded mode only

  // Build absolute paths from the page's own location so requests hit the
  // feature's mount regardless of trailing slash (the page is served at both
  // /tv-display and /tv-display/) and regardless of what base path this feature
  // is mounted under. Relative URLs would wrongly resolve /tv-display -> /.
  var BASE = location.pathname.replace(/\\/+$/, '');   // e.g. "/tv-display"
  var MEDIA = BASE + '/media/';
  var MANIFEST = BASE + '/manifest';
  var EVENTS = BASE + '/events?client=page';

  // ---- elements ----------------------------------------------------------
  var imgs = [document.getElementById('imgA'), document.getElementById('imgB')];
  var vid = document.getElementById('vid');
  var placeholder = document.getElementById('placeholder');
  var dbg = document.getElementById('debug');

  // ---- state -------------------------------------------------------------
  var playlist = [];      // [{name, type}]
  var idx = -1;           // index of the item currently shown
  var imgFlip = 0;        // which of the two <img> layers to use next
  var timer = null;       // pending advance timer
  var manifestKey = '';   // JSON of last manifest, to detect changes
  var advancing = false;

  function log(msg) {
    if (!dbg) return;
    dbg.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg +
      '\\nitems=' + playlist.length + ' idx=' + idx +
      ' photoMs=' + cfg.photoMs + ' fit=' + cfg.fit +
      ' sound=' + (cfg.sound ? 1 : 0) + ' shuffle=' + (cfg.shuffle ? 1 : 0);
  }

  function hideAll() {
    imgs[0].classList.remove('visible');
    imgs[1].classList.remove('visible');
    vid.classList.remove('visible');
  }

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  // How long this picture stays up: its per-file override if one is set and
  // valid, otherwise the global photoMs. Videos never call this (they play to
  // their natural end).
  function photoDurationFor(name) {
    var ms = cfg.photoMsByName && cfg.photoMsByName[name];
    return (typeof ms === 'number' && ms >= 1000) ? ms : cfg.photoMs;
  }

  function shuffleInPlace(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
  }

  // Advance to the next playlist item. Robust to an empty/changing list.
  function next() {
    clearTimer();
    if (advancing) return;
    if (!playlist.length) {
      hideAll();
      placeholder.classList.remove('hidden');
      // keep polling; when content appears, poll() will kick playback
      return;
    }
    placeholder.classList.add('hidden');
    advancing = true;

    idx = (idx + 1) % playlist.length;
    // Re-shuffle at each wrap so a shuffled loop isn't the same order forever.
    if (cfg.shuffle && idx === 0 && playlist.length > 2) shuffleInPlace(playlist);
    var it = playlist[idx];
    log('show ' + it.type + ' ' + it.name);

    if (it.type === 'image') {
      var el = imgs[imgFlip];
      imgFlip = 1 - imgFlip;
      el.onload = function () {
        hideAll();
        el.classList.add('visible');
        advancing = false;
        timer = setTimeout(next, photoDurationFor(it.name));
      };
      el.onerror = function () {
        log('IMG ERROR ' + it.name);
        advancing = false;
        timer = setTimeout(next, 500); // skip a bad file quickly
      };
      el.src = MEDIA + encodeURIComponent(it.name);
    } else {
      vid.onended = function () { advancing = false; next(); };
      vid.onerror = function () {
        log('VID ERROR ' + it.name + ' code=' + (vid.error ? vid.error.code : '?'));
        advancing = false;
        timer = setTimeout(next, 500);
      };
      vid.muted = !cfg.sound;   // sound=on attempts unmuted playback
      vid.src = MEDIA + encodeURIComponent(it.name);
      hideAll();
      vid.classList.add('visible');
      var p = vid.play();
      if (p && p.catch) {
        p.catch(function (e) {
          if (cfg.sound && !vid.muted) {
            // Unmuted autoplay blocked by this browser: retry muted rather
            // than stalling the loop.
            log('SOUND BLOCKED (' + e.name + ') -> retrying muted');
            vid.muted = true;
            var p2 = vid.play();
            if (p2 && p2.catch) {
              p2.catch(function (e2) {
                log('AUTOPLAY BLOCKED ' + e2.name);
                advancing = false;
                timer = setTimeout(next, 800);
              });
            }
            return;
          }
          // Muted autoplay is normally allowed; if ever blocked, skip on.
          log('AUTOPLAY BLOCKED ' + e.name);
          advancing = false;
          timer = setTimeout(next, 800);
        });
      } else {
        advancing = false;
      }
    }
  }

  // Apply stored settings (respecting any pinned query params). Only the pieces
  // that can be changed mid-item are applied immediately; photoMs takes effect
  // on the next image, which is what a viewer would expect anyway.
  function applySettings(s) {
    if (!s) return;
    var before = JSON.stringify(cfg);
    if (!pinned.photoMs && typeof s.photoMs === 'number') cfg.photoMs = Math.max(1000, s.photoMs);
    // Per-image overrides take effect on the NEXT picture (like photoMs), which
    // is what a viewer expects — the current dwell already started. Pinning
    // photoMs (?photoMs=, e.g. the settings-tab preview) pins timing wholesale,
    // so overrides are ignored and every picture runs at the pinned speed.
    if (!pinned.photoMs && s.photoMsByName && typeof s.photoMsByName === 'object') {
      cfg.photoMsByName = s.photoMsByName;
    }
    if (!pinned.sound && typeof s.sound === 'boolean' && s.sound !== cfg.sound) {
      cfg.sound = s.sound;
      vid.muted = !cfg.sound;      // live: unmutes/mutes the clip playing now
    }
    if (!pinned.shuffle && typeof s.shuffle === 'boolean') cfg.shuffle = s.shuffle;
    if (!pinned.fit && (s.fit === 'cover' || s.fit === 'contain')) {
      cfg.fit = s.fit;
      document.body.classList.toggle('fit-cover', cfg.fit === 'cover');
    }
    // Keep the debug overlay honest: without this it would keep showing the
    // config from whenever the current item started.
    if (JSON.stringify(cfg) !== before) log('settings applied');
  }

  // Apply one state payload ({settings, items}) — from a pushed frame or, in
  // degraded mode, from a manifest fetch. Identical handling either way.
  function applyState(data) {
    applySettings(data && data.settings);

    var items = (data && data.items) || [];
    var key = JSON.stringify(items.map(function (i) { return i.name; }));
    if (key === manifestKey) return;        // playlist unchanged
    manifestKey = key;

    if (cfg.shuffle) shuffleInPlace(items);
    var wasEmpty = playlist.length === 0;
    playlist = items;
    log('playlist updated');

    // If we were idle (empty before) and now have content, start playing.
    if (wasEmpty && playlist.length) { idx = -1; next(); }
    // If everything vanished, next() will show the placeholder on its next tick.
    if (!playlist.length) { clearTimer(); idx = -1; next(); }
  }

  function fetchState() {
    fetch(MANIFEST, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(applyState)
      .catch(function () { /* transient; the stream or the fallback retries */ });
  }

  // ---- push --------------------------------------------------------------
  // One EventSource, opened once. The browser reconnects it on its own (the
  // server sends a jittered retry hint), so there is nothing to poll and nothing
  // to schedule while it is healthy.
  var stream = null;
  var streamOk = false;

  function connect() {
    if (!window.EventSource) { streamOk = false; return; }   // degraded mode
    try {
      stream = new EventSource(EVENTS);
    } catch (e) {
      streamOk = false;
      return;
    }
    stream.onopen = function () {
      streamOk = true;
      log('stream connected');
    };
    stream.addEventListener('state', function (ev) {
      streamOk = true;
      try {
        applyState(JSON.parse(ev.data));
      } catch (e) { /* malformed frame: ignore, the next one wins */ }
    });
    stream.onerror = function () {
      // EventSource retries by itself; just note it so the fallback can cover
      // a long outage.
      streamOk = false;
      log('stream lost (auto-retrying)');
    };
  }

  // Safety net: only does anything while the stream is NOT healthy, so a normal
  // day makes zero periodic requests.
  function fallbackTick() {
    if (streamOk) return;
    fetchState();
  }

  // Screen-wake: request a wake lock where supported (harmless no-op otherwise).
  // The mixed playlist's videos also keep the panel awake; this covers long
  // photo-only stretches on browsers that honor the API.
  function keepAwake() {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }
  // Re-acquire the wake lock when the page becomes visible again.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') keepAwake();
  });

  // ---- boot --------------------------------------------------------------
  if (cfg.fit === 'cover') document.body.classList.add('fit-cover');
  keepAwake();
  fetchState();               // render immediately, without waiting for a frame
  connect();                  // then stay current by push
  setInterval(fallbackTick, FALLBACK_MS);
})();
</script>
</body>
</html>`;

export default router;
