# Changelog

## 1.0.3 (2026-11-24)

**Fixed**
- Automatic profile switching didn't work. The plugin asked Stream Deck for the profiles by their
  draft names ("Cockpit Deck - MSFS 2024") instead of the names they were installed under
  ("CockpitDeck-MSFS2024"), and Stream Deck rejected the request with "Profile not found".
- If the settings file couldn't be read, tapping the SPEED units key could overwrite the built-in
  defaults in memory.

**Changed**
- The deck only switches back to your previous profile if Cockpit Deck switched it in the first
  place, and only once no supported game is running.
- At startup the plugin checks that every profile it may switch to is declared in `manifest.json`,
  and logs an error if one isn't.
- New automated check: the profile names used for switching must match the manifest and exist as files.

## 1.0.2 (2026-11-24, internal debug build)

- Debug builds (`debug.flag`) gained a local-only diagnostics endpoint on `127.0.0.1:28650`. It was
  used to prove the switch command on real hardware and find the 1.0.3 bug.

## 1.0.1 (2026-11-24, internal debug build)

- Debug builds save every key image sent to the deck to `%APPDATA%\CockpitDeck\debug\`.
- Forza's UDP socket no longer shares its port with other programs, so a port conflict is logged
  instead of silently losing telemetry.
- Tests run in their own data folder and on port 5399, so they never touch an installed copy.

## 1.0.0 (2026-11-24)

First version.
- MSFS 2024 through SimConnect: Flight, Autopilot, Lights, Radio and Systems pages with live state.
- Forza Horizon 6 telemetry dash through Data Out, plus Rewind / Horn / Menu keys.
- Key faces drawn at 144×144 with live colours and glows.
- Bundled 15-key profiles and automatic profile switching.
