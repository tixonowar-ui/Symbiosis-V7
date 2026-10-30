import {
  startHostApplication,
  type HostEntryConfig,
  type RunningHost,
} from '../../src/host/entry-point.js';

const source = process.argv[2];
if (source === undefined || process.send === undefined || process.disconnect === undefined)
  throw new Error('Network browser fixture requires an IPC parent and explicit host configuration');
const disconnect = process.disconnect.bind(process);
const send = process.send.bind(process);
const config = JSON.parse(source) as HostEntryConfig;
const state: { host: RunningHost | undefined } = { host: undefined };
let closing = false,
  closePromise: Promise<void> | undefined;
function close() {
  closing = true;
  if (state.host === undefined) return;
  closePromise ??= state.host
    .close()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.connected) disconnect();
    });
}
process.on('disconnect', close);
process.on('message', (message: unknown) => {
  if (message === 'CLOSE') close();
});
state.host = await startHostApplication(config);
if (closing || !process.connected) close();
else
  send(
    { kind: 'READY', address: state.host.address, deviceId: state.host.deviceId, pid: process.pid },
    (error) => {
      if (error !== null) close();
    },
  );
