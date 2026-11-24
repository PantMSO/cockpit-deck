# Changelog

## 1.2.3 (2026-11-24)

**Fixed**
- Switching aircraft could make the plugin loop: handling the change asked MSFS for the new aircraft's input
  events, which announced a change before the new aircraft had been recorded, so the same change was handled again,
  thousands of times a second, flooding the sim with requests until the plugin crashed and restarted. It came up when
  switching to the DG-1001 glider with 1.2.2. The aircraft title is now recorded before anything else happens, the
  input event list is requested once per switch, and a new automated check covers it (78 in total).

## 1.2.2 (2026-11-24)

**Trim from the deck.** Every FLY page (C172, piston, turboprop, jet, glider) now has **TRIM ▲** above **TRIM ▼** in
the left column. Each shows the trim gauge; tap to nudge, hold to keep trimming (`ELEV_TRIM_UP` / `ELEV_TRIM_DN`;
checked live that UP is nose up). ▲ lights while stick button 4 is held and ▼ while 6 is held: the stick echo setting
`trim` is replaced by `trimUp` / `trimDown`. To make room, PAUSE left those FLY pages, and the jet page dropped ALTITUDE.

## 1.2.1 (2026-11-24)

**Added**
- **Pages for every aircraft.** The deck works out what kind of aircraft is loaded, in free flight or a mission, and
  switches to pages built for it: **piston, turboprop, jet, helicopter, glider**, the Cessna 172 pages, or the
  standard pages for anything else (balloons, airships, eVTOLs). Detection uses the aircraft's SimVars, so add-ons work too.
  - Every kind has FLY · ENGINE · AUTOPILOT · RADIO · LIGHTS. Gliders have a SOAR page (vario, wind, tow, ballast) in place of AUTOPILOT.
  - Pages adapt within a kind: the gear key only on retractable aircraft, engines 1 and 2 stacked on twins, a magneto key per piston engine, L/R tanks where the aircraft has them.
  - Jets: elevator trim (lights while the stick's trim buttons are held), speedbrake (tap) and arm (hold), A/THR, APU start/stop (hold 1 s), FLC, and a SPD target on the AP knob.
  - Helicopters: rotor %, torque, height above ground, rotor brake, N1/N2 and TOT.
- `msfs.aircraft` accepts `piston`, `turboprop`, `jet`, `heli` and `glider` as well as `auto`, `skyhawk` and `generic`.
- `tools/switchcheck.js`: presses an aircraft's switch keys for real on the ground, checks each one, and puts it back.
- `tools/livecheck.js` now checks whichever aircraft is loaded.
- 29 new automated checks (77 in total).

**Changed**
- The log names the aircraft's kind, category and engine type when the page set changes.

## 1.1.1 (2026-11-24)

First public release of the Skyhawk + stick work (1.1.0 was an internal build).

**Added**
- **Cessna 172 Skyhawk pages** (FLY, ENGINE, AUTOPILOT, RADIO, LIGHTS) that appear automatically when a C172 is
  loaded in MSFS 2024, and back to the standard pages for other aircraft. `msfs.aircraft` in the settings can force either set.
  - ENGINE: master BAT/ALT, avionics bus 1 and 2, fuel pump, magnetos (tap steps up to BOTH, hold 1 s for OFF),
    spring-loaded starter (crank while held), mixture readout with rich / lean.
  - AUTOPILOT: AP, FD, HDG, NAV, APR, ALT and V/S, each showing its target, plus one knob with − / + for
    HDG, ALT, V/S, CRS and BARO.
  - FLY: trim position, flaps in degrees, parking brake, live stick view, RPM + throttle, both fuel tanks, oil, fuel flow + EGT.
  - LIGHTS: beacon, nav, strobe, taxi, landing, pitot heat, fuel selector, CHT, volts, auto start/stop (hold 1 s).
- **Aircraft input events** through SimConnect (list, read, subscribe, set). The C172's magnetos, fuel selector and fuel
  pump don't respond to the classic key events, and some classic SimVars don't follow its switches. Input events show the
  switch's real position.
- **Flight stick support** (Logitech Extreme 3D Pro by default, any joystick by USB id): a live stick key, keys light
  while their stick button is held, and stick button 11 (unbound in MSFS) disconnects the autopilot, with **DISC** shown on the AP key.
- **Hold-to-confirm** keys with a filling ring. A short tap shows *HOLD 1 S* instead of acting.
- Keys can now act on release (used by the starter).
- `tools/livecheck.js`: read-only check of every Skyhawk key against a running sim and the real stick.
- 22 new automated checks (48 in total). The end-to-end test now runs offline (`COCKPITDECK_OFFLINE=1`), so it can't touch a running sim or stick.

**Changed**
- SimConnect events can carry a value (used for full-rich mixture).
- The stick reader rides out brief read errors (up to about 0.5 s) instead of showing NOT FOUND, and looks for the stick again straight away if it really goes.
- The log names both the aircraft title and model when the page set changes.
- The process check behind automatic profile switching can fail now and then while MSFS is loading. Those failures are now logged at most once a minute.

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
