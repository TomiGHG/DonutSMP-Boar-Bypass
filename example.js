'use strict';

/**
 * Minimal example: connect to a Bedrock server and stay online past Boar.
 *
 *   by TomiGHG - https://tomighg.de
 *
 * Run:  node example.js
 * On first start you'll get a Microsoft device-code login link in the console.
 */

const bedrock = require('bedrock-protocol');
const { installBoarBypass } = require('./boar-bypass');

const client = bedrock.createClient({
  host: 'donutsmp.net',   // your server
  port: 19132,            // Bedrock/Geyser port (UDP)
  username: 'YourGamerTag',
  offline: false,         // Microsoft auth (required by most servers)
  // profilesFolder: './auth-cache',  // where to cache the login token
});

// Wire up the Boar bypass. This alone keeps the connection alive.
installBoarBypass(client, { log: console.log });

client.on('join', () => console.log('Joined - server accepted us.'));
client.on('spawn', () => console.log('Spawned - Boar bypass is now keeping us online.'));

// Show incoming chat (optional).
client.on('text', (packet) => {
  if (packet.message) console.log('[CHAT]', packet.source_name || '', packet.message);
});

client.on('disconnect', (packet) => console.log('Disconnected:', packet.message || packet));
client.on('close', () => console.log('Connection closed.'));
