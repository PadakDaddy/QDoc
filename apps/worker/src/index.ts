import { startOutboxWorker } from "./outbox.js";

const worker = startOutboxWorker();

console.log("QDoc worker started", worker.config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker.stop().finally(() => {
      process.exit(0);
    });
  });
}
