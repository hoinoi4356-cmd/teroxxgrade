'use strict';

/**
 * Офлайн-перевірка парсера A2S та запиту до локального «фейкового» сервера.
 * Нічого не потребує: ні паролів, ні інтернету.
 *
 *   node test/smoke-online.js
 */

const assert = require('assert');
const dgram = require('dgram');
const { parseInfoPacket, queryA2S } = require('../src/server-status');

function cstr(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([b, Buffer.from([0])]);
}

function infoPacket({ players = 7, maxPlayers = 20, bots = 0 } = {}) {
  const appId = Buffer.alloc(2);
  appId.writeUInt16LE(252490 & 0xffff, 0); // Rust (для тесту достатньо 2 байт)
  return Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49]),
    Buffer.from([17]), // protocol
    cstr('UNITY RUST | MAX 16'),
    cstr('Procedural Map'),
    cstr('rust'),
    cstr('Rust'),
    appId,
    Buffer.from([players, maxPlayers, bots]),
    Buffer.from([0x00]), // EDF
  ]);
}

function main() {
  const parsed = parseInfoPacket(infoPacket({ players: 3, maxPlayers: 20, bots: 1 }));
  assert(parsed, 'parseInfoPacket must parse a valid packet');
  assert.strictEqual(parsed.name, 'UNITY RUST | MAX 16');
  assert.strictEqual(parsed.players, 3);
  assert.strictEqual(parsed.maxPlayers, 20);
  assert.strictEqual(parsed.bots, 1);
  assert.strictEqual(parseInfoPacket(Buffer.from([1, 2, 3])), null, 'garbage must be rejected');

  // payload без повного заголовка теж має читатися (split-пакети)
  const withoutHeader = parseInfoPacket(infoPacket().subarray(4));
  assert(withoutHeader && withoutHeader.players === 7, 'raw payload must parse too');

  const server = dgram.createSocket('udp4');
  let requests = 0;
  server.on('message', (_msg, rinfo) => {
    requests += 1;
    // Перший запит — віддаємо challenge, як справжній Rust-сервер.
    const answer =
      requests === 1
        ? Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x12, 0x34, 0x56, 0x78])
        : infoPacket({ players: 5, maxPlayers: 20 });
    server.send(answer, rinfo.port, rinfo.address);
  });
  server.bind(0, '127.0.0.1', async () => {
    const port = server.address().port;
    try {
      const live = await queryA2S('127.0.0.1', port, 1500);
      assert(live, 'queryA2S must get an answer from the fake server');
      assert.strictEqual(live.players, 5);
      assert.strictEqual(live.maxPlayers, 20);
      assert.strictEqual(requests, 2, 'must resend the request after a challenge');
      console.log('OK: A2S online query works (challenge + players=5/20)');
    } finally {
      server.close();
    }
  });
}

main();
