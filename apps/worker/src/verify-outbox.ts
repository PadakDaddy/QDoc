import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@qdoc/db";
import { processOutboxItemsById, type OutboxWorkerConfig } from "./outbox.js";

const config: OutboxWorkerConfig = {
  intervalMs: 10,
  batchSize: 10,
  maxAttempts: 2,
  processingTimeoutMs: 10,
  shutdownGraceMs: 1000,
};

const runId = randomUUID();
const createdNotificationLogIds: string[] = [];
const createdOutboxIds: string[] = [];

async function cleanupVerificationRecords() {
  await prisma.outbox.deleteMany({
    where: {
      id: {
        in: createdOutboxIds,
      },
    },
  });

  await prisma.notificationLog.deleteMany({
    where: {
      id: {
        in: createdNotificationLogIds,
      },
    },
  });
}

async function createOutboxItem(notificationLogId: string) {
  return prisma.outbox.create({
    data: {
      type: "ticket.status_changed",
      payload: {
        ticketId: `verify-ticket-${randomUUID()}`,
        siteId: `verify-site-${runId}`,
        queueId: "verify-queue",
        userId: "verify-user",
        notificationLogId,
        verifyRunId: runId,
        fromStatus: "waiting",
        toStatus: "called",
        action: "ticket.call",
      },
    },
  });
}

async function verifyProcessedPath() {
  const notification = await prisma.notificationLog.create({
    data: {
      channel: "in_app",
      message: `Verify outbox processing ${runId}`,
    },
  });
  createdNotificationLogIds.push(notification.id);
  const item = await createOutboxItem(notification.id);
  createdOutboxIds.push(item.id);

  await processOutboxItemsById([item.id], config);

  const processed = await prisma.outbox.findUniqueOrThrow({
    where: {
      id: item.id,
    },
  });

  assert.equal(processed.status, "processed");
  assert.equal(processed.attempts, 0);
  assert.notEqual(processed.processedAt, null);
}

async function verifyFailedPath() {
  const item = await createOutboxItem(`missing-${randomUUID()}`);
  createdOutboxIds.push(item.id);

  await processOutboxItemsById([item.id], config);

  const retrying = await prisma.outbox.findUniqueOrThrow({
    where: {
      id: item.id,
    },
  });

  assert.equal(retrying.status, "pending");
  assert.equal(retrying.attempts, 1);

  await prisma.outbox.update({
    where: {
      id: item.id,
    },
    data: {
      availableAt: new Date(0),
    },
  });

  await processOutboxItemsById([item.id], config);

  const failed = await prisma.outbox.findUniqueOrThrow({
    where: {
      id: item.id,
    },
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 2);
  assert.equal(failed.processedAt, null);
}

async function main() {
  await verifyProcessedPath();
  await verifyFailedPath();
  console.log("Outbox verification passed");
}

main()
  .finally(async () => {
    await cleanupVerificationRecords();
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
