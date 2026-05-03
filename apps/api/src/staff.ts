import type { IncomingMessage, ServerResponse } from "node:http";
import {
  activeTicketStatuses,
  staffQueueResponseSchema,
  staffTicketActionInputSchema,
  staffTicketResponseSchema,
  type TicketStatus,
} from "@qdoc/contracts";
import { prisma } from "@qdoc/db";
import { readJson, sendJson } from "./http.js";
import { getCurrentUserFromRequest, requireStaffMembership } from "./auth.js";

type StaffTicketAction = "call" | "start-service" | "complete" | "delay" | "restore" | "cancel";

type StaffTicketRecord = {
  id: string;
  siteId: string;
  queueId: string;
  userId: string;
  status: TicketStatus;
  updatedAt: Date;
  site: {
    name: string;
  };
  queue: {
    name: string;
  };
  user: {
    email: string;
  };
};

type StaffQueueTicketRecord = Omit<StaffTicketRecord, "user"> & {
  createdAt: Date;
  user: {
    email: string;
  };
};

const ticketTransitionByAction: Record<StaffTicketAction, { from: TicketStatus[]; to: TicketStatus; auditAction: string }> = {
  call: {
    from: ["waiting"],
    to: "called",
    auditAction: "ticket.call",
  },
  "start-service": {
    from: ["called"],
    to: "in_service",
    auditAction: "ticket.start_service",
  },
  complete: {
    from: ["in_service"],
    to: "completed",
    auditAction: "ticket.complete",
  },
  delay: {
    from: ["called"],
    to: "delay",
    auditAction: "ticket.delay",
  },
  restore: {
    from: ["delay"],
    to: "waiting",
    auditAction: "ticket.restore",
  },
  cancel: {
    from: ["waiting", "called", "delay"],
    to: "cancelled",
    auditAction: "ticket.cancel",
  },
};

const ticketStatusLabels: Record<TicketStatus, string> = {
  waiting: "waiting",
  called: "called",
  in_service: "in service",
  completed: "completed",
  delay: "delayed",
  cancelled: "cancelled",
};

const almostReadyMessage = "Your turn is coming up. Please stay nearby.";

function maskEmail(email: string) {
  const atIndex = email.lastIndexOf("@");

  if (atIndex <= 0) {
    return "masked";
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (localPart.length <= 1) {
    return `*@${domain}`;
  }

  const visiblePrefix = localPart.length === 2 ? localPart.slice(0, 1) : localPart.slice(0, 2);
  const maskedPart = "*".repeat(localPart.length - visiblePrefix.length);

  return `${visiblePrefix}${maskedPart}@${domain}`;
}

function getTicketStatusMessage(status: TicketStatus) {
  if (status === "called") {
    return "Your queue ticket has been called.";
  }

  return `Your queue ticket is now ${ticketStatusLabels[status]}.`;
}

function serializeStaffTicket(ticket: StaffTicketRecord) {
  return {
    id: ticket.id,
    siteId: ticket.siteId,
    siteName: ticket.site.name,
    queueId: ticket.queueId,
    queueName: ticket.queue.name,
    patientEmail: maskEmail(ticket.user.email),
    status: ticket.status,
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

function serializeStaffQueueTicket(ticket: StaffQueueTicketRecord) {
  return {
    id: ticket.id,
    siteId: ticket.siteId,
    siteName: ticket.site.name,
    queueId: ticket.queueId,
    queueName: ticket.queue.name,
    patientEmail: maskEmail(ticket.user.email),
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export async function handleStaffQueue(request: IncomingMessage, response: ServerResponse, siteId: string) {
  const auth = await requireStaffMembership(request, siteId);

  if (auth.status === "unauthorized") {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  if (auth.status === "forbidden") {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      queues: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          name: true,
          isOpen: true,
        },
      },
      tickets: {
        where: {
          status: {
            in: activeTicketStatuses,
          },
        },
        orderBy: [
          {
            queue: {
              createdAt: "asc",
            },
          },
          {
            sortRank: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        include: {
          site: {
            select: {
              name: true,
            },
          },
          queue: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  });

  if (!site) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  sendJson(
    response,
    200,
    staffQueueResponseSchema.parse({
      siteId: site.id,
      siteName: site.name,
      queues: site.queues,
      tickets: site.tickets.map(serializeStaffQueueTicket),
    }),
  );
}

export async function handleStaffTicketAction(
  request: IncomingMessage,
  response: ServerResponse,
  ticketId: string,
  action: StaffTicketAction,
) {
  const transition = ticketTransitionByAction[action];
  const currentUser = await getCurrentUserFromRequest(request);

  if (!currentUser) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  const input = staffTicketActionInputSchema.safeParse(await readJson(request));

  if (!input.success) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }

  const allowedSiteIds = currentUser.memberships
    .filter((membership) => membership.role === "staff" || membership.role === "admin")
    .map((membership) => membership.siteId);

  if (!allowedSiteIds.includes(input.data.siteId)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      siteId: input.data.siteId,
    },
    select: {
      id: true,
      siteId: true,
      queueId: true,
      userId: true,
      status: true,
    },
  });

  if (!ticket) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (!transition.from.includes(ticket.status)) {
    sendJson(response, 409, { error: "invalid_transition" });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const restoreSortRank =
      action === "restore"
        ? await tx.ticket
            .findFirst({
              where: {
                siteId: ticket.siteId,
                queueId: ticket.queueId,
                status: "waiting",
              },
              orderBy: [
                {
                  sortRank: "asc",
                },
                {
                  createdAt: "asc",
                },
              ],
              select: {
                sortRank: true,
              },
            })
            .then((frontTicket) => new Date((frontTicket?.sortRank ?? new Date()).getTime() - 1000))
        : null;

    const updated = await tx.ticket.updateMany({
      where: {
        id: ticket.id,
        status: ticket.status,
      },
      data: {
        status: transition.to,
        ...(restoreSortRank ? { sortRank: restoreSortRank } : {}),
      },
    });

    if (updated.count !== 1) {
      return null;
    }

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        status: transition.to,
        note: transition.auditAction,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: currentUser.id,
        action: transition.auditAction,
        metadata: {
          ticketId: ticket.id,
          siteId: ticket.siteId,
          fromStatus: ticket.status,
          toStatus: transition.to,
        },
      },
    });

    const notification = await tx.notificationLog.create({
      data: {
        ticketId: ticket.id,
        channel: "in_app",
        message: getTicketStatusMessage(transition.to),
      },
    });

    await tx.outbox.create({
      data: {
        type: "ticket.status_changed",
        payload: {
          ticketId: ticket.id,
          siteId: ticket.siteId,
          queueId: ticket.queueId,
          userId: ticket.userId,
          notificationLogId: notification.id,
          fromStatus: ticket.status,
          toStatus: transition.to,
          action: transition.auditAction,
        },
      },
    });

    const waitingTickets = await tx.ticket.findMany({
      where: {
        siteId: ticket.siteId,
        queueId: ticket.queueId,
        status: "waiting",
      },
      orderBy: [
        {
          sortRank: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
      include: {
        site: {
          select: {
            name: true,
          },
        },
        queue: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    for (const queueTicket of waitingTickets.slice(0, 3)) {
      const existingInAppAlmostReadyNotification = await tx.notificationLog.findFirst({
        where: {
          ticketId: queueTicket.id,
          channel: "in_app",
          message: almostReadyMessage,
        },
        select: {
          id: true,
        },
      });

      if (!existingInAppAlmostReadyNotification) {
        await tx.notificationLog.create({
          data: {
            ticketId: queueTicket.id,
            channel: "in_app",
            message: almostReadyMessage,
          },
        });
      }
    }

    const almostReadyTicket = waitingTickets[2];

    if (almostReadyTicket) {
      const existingAlmostReadyNotification = await tx.notificationLog.findFirst({
        where: {
          ticketId: almostReadyTicket.id,
          channel: "email",
          message: almostReadyMessage,
        },
        select: {
          id: true,
        },
      });

      if (!existingAlmostReadyNotification) {
        const almostReadyNotification = await tx.notificationLog.create({
          data: {
            ticketId: almostReadyTicket.id,
            channel: "email",
            message: almostReadyMessage,
          },
        });

        await tx.outbox.create({
          data: {
            type: "ticket.almost_ready_email",
            payload: {
              ticketId: almostReadyTicket.id,
              siteId: almostReadyTicket.siteId,
              siteName: almostReadyTicket.site.name,
              queueId: almostReadyTicket.queueId,
              queueName: almostReadyTicket.queue.name,
              userId: almostReadyTicket.userId,
              userEmail: almostReadyTicket.user.email,
              aheadCount: 2,
              notificationLogId: almostReadyNotification.id,
            },
          },
        });
      }
    }

    return tx.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        site: {
          select: {
            name: true,
          },
        },
        queue: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            email: true,
          },
        },
      },
    });
  });

  if (!result) {
    sendJson(response, 409, { error: "conflict" });
    return;
  }

  sendJson(
    response,
    200,
    staffTicketResponseSchema.parse({
      ticket: serializeStaffTicket(result),
    }),
  );
}

export function isStaffTicketAction(action: string): action is StaffTicketAction {
  return Object.hasOwn(ticketTransitionByAction, action);
}
