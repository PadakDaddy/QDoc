import { prisma } from "@qdoc/db";
import { sendAlmostReadyEmail } from "./email.js";

export type OutboxWorkerConfig = {
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  processingTimeoutMs: number;
  shutdownGraceMs: number;
};

type OutboxItem = Awaited<ReturnType<typeof loadPendingOutboxItems>>[number];

export function getOutboxWorkerConfigFromEnv(): OutboxWorkerConfig {
  return {
    intervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? "5000"),
    batchSize: Number(process.env.WORKER_OUTBOX_BATCH_SIZE ?? "10"),
    maxAttempts: Number(process.env.WORKER_OUTBOX_MAX_ATTEMPTS ?? "5"),
    processingTimeoutMs: Number(process.env.WORKER_OUTBOX_PROCESSING_TIMEOUT_MS ?? "60000"),
    shutdownGraceMs: Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? "10000"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadString(payload: unknown, key: string) {
  if (!isRecord(payload) || typeof payload[key] !== "string") {
    throw new Error(`Invalid outbox payload: ${key}`);
  }

  return payload[key];
}

function getRetryDelayMs(attempts: number) {
  return Math.min(60_000, 1000 * 2 ** attempts);
}

async function loadPendingOutboxItems(config: OutboxWorkerConfig) {
  const now = new Date();
  const staleProcessingCutoff = new Date(Date.now() - config.processingTimeoutMs);

  return prisma.outbox.findMany({
    where: {
      OR: [
        {
          status: "pending",
          availableAt: {
            lte: now,
          },
        },
        {
          status: "processing",
          updatedAt: {
            lte: staleProcessingCutoff,
          },
        },
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
    take: config.batchSize,
  });
}

async function claimOutboxItem(item: OutboxItem, config: OutboxWorkerConfig) {
  const now = new Date();
  const staleProcessingCutoff = new Date(Date.now() - config.processingTimeoutMs);
  const claimed = await prisma.outbox.updateMany({
    where: {
      id: item.id,
      OR: [
        {
          status: "pending",
          availableAt: {
            lte: now,
          },
        },
        {
          status: "processing",
          updatedAt: {
            lte: staleProcessingCutoff,
          },
        },
      ],
    },
    data: {
      status: "processing",
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return prisma.outbox.findUnique({
    where: {
      id: item.id,
    },
  });
}

async function processTicketStatusChanged(item: OutboxItem) {
  const notificationLogId = getPayloadString(item.payload, "notificationLogId");

  const notification = await prisma.notificationLog.findUnique({
    where: {
      id: notificationLogId,
    },
    select: {
      id: true,
    },
  });

  if (!notification) {
    throw new Error("Notification log not found");
  }
}

async function processTicketAlmostReadyEmail(item: OutboxItem) {
  const notificationLogId = getPayloadString(item.payload, "notificationLogId");
  const userEmail = getPayloadString(item.payload, "userEmail");
  const siteName = getPayloadString(item.payload, "siteName");
  const queueName = getPayloadString(item.payload, "queueName");
  const aheadCount = isRecord(item.payload) && typeof item.payload.aheadCount === "number" ? item.payload.aheadCount : null;

  if (aheadCount === null) {
    throw new Error("Invalid outbox payload: aheadCount");
  }

  const notification = await prisma.notificationLog.findUnique({
    where: {
      id: notificationLogId,
    },
    select: {
      id: true,
    },
  });

  if (!notification) {
    throw new Error("Notification log not found");
  }

  await sendAlmostReadyEmail({
    to: userEmail,
    siteName,
    queueName,
    aheadCount,
  });
}

async function processOutboxItem(item: OutboxItem) {
  if (item.type === "ticket.status_changed") {
    await processTicketStatusChanged(item);
    return;
  }

  if (item.type === "ticket.almost_ready_email") {
    await processTicketAlmostReadyEmail(item);
    return;
  }

  throw new Error(`Unsupported outbox type: ${item.type}`);
}

async function markOutboxProcessed(item: OutboxItem) {
  await prisma.outbox.updateMany({
    where: {
      id: item.id,
      status: "processing",
      updatedAt: item.updatedAt,
    },
    data: {
      status: "processed",
      processedAt: new Date(),
    },
  });
}

async function markOutboxFailed(item: OutboxItem, config: OutboxWorkerConfig, error: unknown) {
  const attempts = item.attempts + 1;
  const shouldRetry = attempts < config.maxAttempts;

  const failed = await prisma.outbox.updateMany({
    where: {
      id: item.id,
      status: "processing",
      updatedAt: item.updatedAt,
    },
    data: {
      status: shouldRetry ? "pending" : "failed",
      attempts,
      availableAt: new Date(Date.now() + getRetryDelayMs(item.attempts)),
    },
  });

  if (failed.count !== 1) {
    return;
  }

  console.error("Outbox item failed", {
    id: item.id,
    type: item.type,
    attempts,
    willRetry: shouldRetry,
    error: error instanceof Error ? error.message : "Unknown error",
  });
}

export async function processOutboxBatch(config: OutboxWorkerConfig = getOutboxWorkerConfigFromEnv()) {
  const items = await loadPendingOutboxItems(config);
  await processOutboxItems(items, config);
}

async function processOutboxItems(items: OutboxItem[], config: OutboxWorkerConfig) {
  for (const item of items) {
    const claimed = await claimOutboxItem(item, config);

    if (!claimed) {
      continue;
    }

    try {
      await processOutboxItem(claimed);
      await markOutboxProcessed(claimed);
    } catch (error) {
      await markOutboxFailed(claimed, config, error);
    }
  }
}

export async function processOutboxItemsById(ids: string[], config: OutboxWorkerConfig = getOutboxWorkerConfigFromEnv()) {
  if (ids.length === 0) {
    return;
  }

  const now = new Date();
  const staleProcessingCutoff = new Date(Date.now() - config.processingTimeoutMs);
  const items = await prisma.outbox.findMany({
    where: {
      id: {
        in: ids,
      },
      OR: [
        {
          status: "pending",
          availableAt: {
            lte: now,
          },
        },
        {
          status: "processing",
          updatedAt: {
            lte: staleProcessingCutoff,
          },
        },
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  await processOutboxItems(items, config);
}

export function startOutboxWorker(config: OutboxWorkerConfig = getOutboxWorkerConfigFromEnv()) {
  let shuttingDown = false;
  let activeBatch: Promise<void> | null = null;
  let loop: Promise<void> | null = null;

  async function runWorkerLoop() {
    while (!shuttingDown) {
      try {
        activeBatch = processOutboxBatch(config);
        await activeBatch;
      } catch (error) {
        console.error("Outbox worker poll failed", error);
      } finally {
        activeBatch = null;
      }

      await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
    }
  }

  async function stop() {
    shuttingDown = true;

    if (activeBatch) {
      await Promise.race([activeBatch, new Promise((resolve) => setTimeout(resolve, config.shutdownGraceMs))]);
    }

    await prisma.$disconnect();
  }

  loop = runWorkerLoop();

  return {
    config,
    loop,
    stop,
  };
}
