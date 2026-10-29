import { WebSocket, type RawData } from 'ws';

import { createStartingMoneyBrowserHost } from './starting-money-e2e.js';

function receive(socket: WebSocket, count: number): Promise<readonly Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const frames: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(
        new Error(
          `positions replay: expected ${String(count)} frames, got ${String(frames.length)}`,
        ),
      );
    }, 5000);
    const onMessage = (data: RawData) => {
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      frames.push(JSON.parse(buffer.toString('utf8')) as Record<string, unknown>);
      if (frames.length === count) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(frames);
      }
    };
    socket.on('message', onMessage);
  });
}

/** Real predecessor history, production static files, and the same SQLite file after reopen. */
export async function createFiveStartingPositionsBrowserHost(mode: 'AUTO' | 'MANUAL') {
  const host = await createStartingMoneyBrowserHost({
    prefix: `five-positions-${mode.toLowerCase()}-e2e`,
    diceInputMode: mode,
    raceChoice: mode === 'AUTO' ? 'PURE' : 'FREE',
    legacyCompletedProfile: true,
    sampleFaces: mode === 'AUTO' ? [15, 1, 5, 10, 19, 20] : [],
  });
  return Object.assign(host, {
    /** A second real socket replays the browser's exact bytes without injecting an unsolicited UI receipt. */
    replay: async (reconnectFrame: string, commandFrame: string) => {
      const socket = new WebSocket(`${host.baseURL.replace(/^http/, 'ws')}/state`, {
        origin: new URL(host.baseURL).origin,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
        const connected = receive(socket, 2);
        socket.send(reconnectFrame);
        await connected;
        const replayed = receive(socket, 2);
        socket.send(commandFrame);
        return await replayed;
      } finally {
        socket.terminate();
      }
    },
  });
}
