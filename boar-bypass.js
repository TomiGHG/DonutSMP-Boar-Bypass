'use strict';

/**
 * ===========================================================================
 *  Boar Anti-Bot Bypass for Minecraft Bedrock (Geyser servers)
 * ===========================================================================
 *  Author:   TomiGHG
 *  Website:  https://tomighg.de
 *  ---------------------------------------------------------------------------
 *  Drop-in module for the `bedrock-protocol` library (PrismarineJS).
 *  Free to use. If you share this or build on it, please keep this header.
 * ===========================================================================
 *
 *  WHAT IS "BOAR"?
 *  ---------------
 *  "Boar" is an anti-bot that some Bedrock/Geyser servers (e.g. DonutSMP) run.
 *  A freshly connected client that only completes the login handshake and then
 *  goes quiet is flagged and kicked with:
 *
 *      Boar > Timed out!
 *
 *  A REAL Bedrock client constantly proves it is alive by:
 *    1) streaming `player_auth_input` every client tick (~20/sec), even when
 *       standing perfectly still,
 *    2) answering `network_stack_latency` ping challenges with the exact
 *       transformed timestamp the server expects,
 *    3) echoing `tick_sync` packets back.
 *
 *  A naive bot does none of these, so Boar times it out. This module makes the
 *  bot mimic all three, so the connection stays alive indefinitely.
 *
 *  IMPORTANT: these three responses are what keeps you online. If ANY of them
 *  is missing (especially the auth-input stream) Boar will still time you out.
 *
 *
 *  HOW TO USE
 *  ----------
 *      const bedrock = require('bedrock-protocol');
 *      const { installBoarBypass } = require('./boar-bypass');
 *
 *      const client = bedrock.createClient({ host, port, username, ... });
 *      installBoarBypass(client);   // <-- that's it
 *
 *  The module waits for `start_game` (to learn the runtime entity id and the
 *  spawn position) and for `spawn` (to start the heartbeat), then handles
 *  everything on its own. It also tracks server position corrections so the
 *  auth-input we send never drifts from where the server thinks we are.
 *
 *  Tested stable for 4+ minutes of pure idle on a Boar-protected server with
 *  bedrock-protocol's default version (1.26.30). The field list below is for
 *  1.26.x — older versions have fewer fields (see the notes inline).
 */

/**
 * Install the Boar bypass on a bedrock-protocol client.
 *
 * @param {object} client                 a bedrock-protocol Client
 * @param {object} [opts]
 * @param {number} [opts.heartbeatMs=100] how often to send player_auth_input.
 *        Real clients send ~20/s (every 50ms). 100ms (10/s) is plenty for Boar
 *        and lighter on CPU. Do NOT go much higher than ~100ms.
 * @param {function} [opts.log]           optional logger, e.g. console.log
 * @returns {function} stop()             call to tear the bypass down again
 */
function installBoarBypass(client, opts = {}) {
  const heartbeatMs = opts.heartbeatMs || 100;
  const log = opts.log || (() => {});

  // State we need for a believable auth-input packet.
  let runtimeEntityId = null;
  let hbTimer = null;
  let tick = 0n; // player_auth_input tick counter (int64 / BigInt)
  const self = {
    pitch: 0,
    yaw: 0,
    headYaw: 0,
    position: { x: 0, y: 0, z: 0 },
  };

  // --- 1) Learn who we are and where we spawned ---------------------------
  // start_game gives us our runtime entity id and initial position. We must
  // echo a plausible position in every auth-input, so we track it here.
  client.on('start_game', (packet) => {
    runtimeEntityId = packet.runtime_entity_id;
    if (packet.player_position) {
      self.position = {
        x: packet.player_position.x,
        y: packet.player_position.y,
        z: packet.player_position.z,
      };
    }
    if (packet.rotation) {
      self.pitch = packet.rotation.x;
      self.yaw = packet.rotation.z;
      self.headYaw = packet.rotation.z;
    }
  });

  // Keep our tracked position/rotation in sync with what the server believes.
  // If these drift, some anti-bots notice the mismatch.
  client.on('move_player', (packet) => {
    if (String(packet.runtime_id) !== String(runtimeEntityId)) return;
    if (packet.position) self.position = { x: packet.position.x, y: packet.position.y, z: packet.position.z };
    if (packet.pitch != null) self.pitch = packet.pitch;
    if (packet.yaw != null) self.yaw = packet.yaw;
    if (packet.head_yaw != null) self.headYaw = packet.head_yaw;
  });
  client.on('correct_player_move_prediction', (packet) => {
    if (packet.position) self.position = { x: packet.position.x, y: packet.position.y, z: packet.position.z };
  });

  // --- 2) network_stack_latency challenge ---------------------------------
  // The server pings us with a timestamp and needs_response = 1. A real client
  // replies with a specific TRANSFORM of that timestamp (not the raw value).
  // Get the transform wrong and Boar flags you. The rules below match the
  // vanilla Bedrock client for the 1.26.x era:
  //   - the two "magic" probe values -9876 / -9877 map to fixed replies,
  //   - every other value is multiplied by 1_000_000.
  // All math is done in signed 64-bit and sent back as unsigned 64-bit.
  client.on('network_stack_latency', (packet) => {
    if (!packet.needs_response) return;
    const ts = BigInt.asIntN(64, BigInt(packet.timestamp));
    let responseTs;
    if (ts === -9876n) responseTs = BigInt.asUintN(64, -9876543210n);
    else if (ts === -9877n) responseTs = BigInt.asUintN(64, -9876543211n);
    else responseTs = BigInt.asUintN(64, ts * 1000000n);
    try {
      client.write('network_stack_latency', { timestamp: responseTs, needs_response: 0 });
    } catch (e) { /* ignore: connection may be closing */ }
  });

  // --- 3) tick_sync echo --------------------------------------------------
  // The server sends tick_sync with a request_time; we bounce it straight back,
  // putting the request_time into BOTH request_time and response_time.
  client.on('tick_sync', (packet) => {
    try {
      client.write('tick_sync', { request_time: packet.request_time, response_time: packet.request_time });
    } catch (e) { /* ignore */ }
  });

  // --- 4) The heartbeat: stream player_auth_input -------------------------
  // Start once we've actually spawned (runtimeEntityId is known by then).
  client.on('spawn', () => {
    if (hbTimer) return;
    tick = 0n;
    hbTimer = setInterval(sendAuthInput, heartbeatMs);
    log(`Boar bypass active: player_auth_input every ${heartbeatMs}ms`);
  });

  function sendAuthInput() {
    if (!client || runtimeEntityId == null) return;
    tick += 1n;
    try {
      client.write('player_auth_input', {
        // Where we are / where we look. We are not moving, so these stay put.
        pitch: self.pitch,
        yaw: self.yaw,
        position: { x: self.position.x, y: self.position.y, z: self.position.z },
        move_vector: { x: 0, z: 0 },
        head_yaw: self.headYaw,

        // No inputs pressed. Passing all flags false (or an empty object) means
        // "standing still, doing nothing" - which is exactly what we want.
        input_data: {
          item_interact: false,
          block_action: false,
          item_stack_request: false,
          client_predicted_vehicle: false,
        },
        input_mode: 'mouse',
        play_mode: 'normal',
        interaction_model: 'crosshair',
        interact_rotation: { x: 0, z: 0 },

        // Monotonic tick counter. Must increase by 1 every packet.
        tick: tick,
        delta: { x: 0, y: 0, z: 0 },

        // --- Easy-to-miss 1.26.x fields ---
        // These three were added in newer protocols. If you leave them out on
        // 1.26.x the packet fails to serialize ("Cannot read 'x'"). On OLDER
        // versions (pre-1.21.x) they do not exist - remove them there.
        analogue_move_vector: { x: 0, z: 0 },
        camera_orientation: { x: 0, y: 0, z: 0 },
        raw_move_vector: { x: 0, z: 0 },
      });
    } catch (e) {
      // On a serialization error, report once and stop instead of spamming.
      log('player_auth_input error:', e.message);
      stop();
    }
  }

  // --- teardown -----------------------------------------------------------
  function stop() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }
  client.on('close', stop);
  client.on('disconnect', stop);

  return stop;
}

module.exports = { installBoarBypass };

/**
 * ---------------------------------------------------------------------------
 * QUICK REFERENCE - the three things Boar checks, and our answer:
 *
 *   Server sends            ->  We reply with
 *   ----------------------------------------------------------------------
 *   (nothing / idle)        ->  player_auth_input every ~100ms (the heartbeat)
 *   network_stack_latency   ->  same packet, timestamp transformed:
 *                                 -9876 -> -9876543210
 *                                 -9877 -> -9876543211
 *                                 else  -> value * 1_000_000
 *   tick_sync               ->  tick_sync with response_time = request_time
 *
 * Miss any one of these and you get "Boar > Timed out!".
 * ---------------------------------------------------------------------------
 */
