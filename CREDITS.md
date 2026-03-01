# Credits

## NickWaterton / samsung-tv-ws-api

Several features in this project were inspired by and developed with reference to:

**[samsung-tv-ws-api](https://github.com/NickWaterton/samsung-tv-ws-api)**
by [NickWaterton](https://github.com/NickWaterton)
Licensed under **LGPL-3.0**

Specific contributions from that project that informed this app:

- **Dynamic matte list** — The `get_matte_list()` method (exposed via `/api/mattes`) lets the app fetch the TV's actual supported matte types and colour variants at runtime rather than relying on a hardcoded list. This ensures the matte dropdown is accurate for any Frame TV generation.
- **Motion controls** — The `set_motion_timer()` and `set_motion_sensitivity()` API calls, exposed through the Motion card in the Art Mode tab, were documented in NickWaterton's fork.
- **Auto-brightness sensor** — The `set_brightness_sensor_setting()` call, surfaced as the "Auto Brightness" toggle in the Appearance card, was similarly documented there.

A copy of the LGPL-3.0 licence can be found at:
<https://www.gnu.org/licenses/lgpl-3.0.html>

---

## DSR! / samsungtvws

The core Samsung TV WebSocket library used by this project:

**[samsungtvws](https://github.com/xchwarze/samsung-tv-ws-api)**
by [DSR!](https://github.com/xchwarze)
Licensed under **LGPL-3.0**
