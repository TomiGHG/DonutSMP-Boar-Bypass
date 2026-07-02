# Boar Anti-Bot Bypass (Minecraft Bedrock)

A tiny, self-contained module that keeps a **Bedrock** bot online on servers
protected by the **Boar** anti-bot (e.g. Geyser servers like DonutSMP), which
otherwise kicks idle bots with:

```
Boar > Timed out!
```

Built for the [`bedrock-protocol`](https://github.com/PrismarineJS/bedrock-protocol)
library (PrismarineJS).

**by [TomiGHG](https://tomighg.de) · https://tomighg.de**

> ⚠️ Educational / automation use. Botting may violate a server's rules – use
> at your own risk and only on servers where you are allowed to.

## Why bots get timed out
A **real** Bedrock client constantly proves it is alive. A naive bot only
finishes the login handshake and then goes quiet, so Boar times it out. Boar
checks three things:

| Server sends            | A real client replies with                                   |
|-------------------------|--------------------------------------------------------------|
| *(nothing / idle)*      | `player_auth_input` every client tick – **even standing still** |
| `network_stack_latency` | the **same** packet, with the timestamp *transformed* (see below) |
| `tick_sync`             | `tick_sync` echoed back (`response_time = request_time`)     |

Miss **any** of these and you get `Boar > Timed out!`.

### The timestamp transform
`network_stack_latency` is a ping challenge: you must reply with a specific
transform of the timestamp, not the raw value. The rules (1.26.x era):

```
-9876  ->  -9876543210
-9877  ->  -9876543211
else   ->  value * 1_000_000
```

All math is signed 64-bit, sent back as unsigned 64-bit.

## Install
```bash
npm install bedrock-protocol
```
Then drop [`boar-bypass.js`](./boar-bypass.js) into your project.

## Usage
```js
const bedrock = require('bedrock-protocol');
const { installBoarBypass } = require('./boar-bypass');

const client = bedrock.createClient({
  host: 'your.server',
  port: 19132,
  username: 'YourGamerTag',
  // ...your usual options
});

installBoarBypass(client); // that's it – stays online
```

The module waits for `start_game` (to learn the runtime entity id + spawn
position) and `spawn` (to start the heartbeat), then handles the three checks
on its own. It also tracks server position corrections so the auth-input never
drifts from where the server thinks you are.

### Options
```js
const stop = installBoarBypass(client, {
  heartbeatMs: 100,     // how often to send player_auth_input (default 100)
  log: console.log,     // optional logger
});

// later, to tear it down manually:
stop();
```

`heartbeatMs`: real clients send ~20/s (50ms). `100` (10/s) is plenty for Boar
and lighter on CPU. Don't go much higher than ~100ms.

## Version notes
- Tested on **bedrock-protocol** default version **1.26.30**, stable 4+ minutes idle.
- The `player_auth_input` field list targets **1.26.x**. The fields
  `analogue_move_vector`, `camera_orientation` and `raw_move_vector` are
  **easy to miss** – leaving them out on 1.26.x throws a serialization error
  (`Cannot read 'x'`). On **older** protocols (pre-1.21.x) those fields don't
  exist, so remove them there.

## Files
| File             | Purpose                              |
|------------------|--------------------------------------|
| `boar-bypass.js` | the module (the whole thing)         |
| `example.js`     | minimal runnable usage example       |

---

Made by **TomiGHG** · <https://tomighg.de>

## License
MIT – free to use. Please keep the author credit (TomiGHG · tomighg.de) when
redistributing.
