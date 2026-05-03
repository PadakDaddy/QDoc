import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  currentUserSchema,
  otpRequestInputSchema,
  otpVerifyInputSchema,
} from "@qdoc/contracts";
import { prisma } from "@qdoc/db";
import { canDeliverOtp, deliverOtp, OtpDeliveryError } from "./email.js";
import { readJson, sendJson } from "./http.js";
import { clearSessionCookie, createSessionCookie, createSessionToken, readSession } from "./session.js";

const otpTtlMs = 10 * 60 * 1000;
const otpRequestCooldownMs = 60 * 1000;
const otpVerifyCooldownMs = 30 * 1000;
const maxPendingChallenges = 5;

const otpRequestCooldowns = new Map<string, number>();
const otpVerifyCooldowns = new Map<string, number>();
const otpRequestEmailsInFlight = new Set<string>();

function pruneExpiredEntries(map: Map<string, number>) {
  const now = Date.now();

  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) {
      map.delete(key);
    }
  }
}

function getRequesterKey(request: IncomingMessage) {
  return request.socket.remoteAddress ?? "unknown";
}

function reserveCooldown(map: Map<string, number>, key: string, ttlMs: number) {
  pruneExpiredEntries(map);

  if ((map.get(key) ?? 0) > Date.now()) {
    return false;
  }

  map.set(key, Date.now() + ttlMs);
  return true;
}

function clearCooldown(map: Map<string, number>, key: string) {
  map.delete(key);
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

function hashOtp(email: string, code: string) {
  return createHmac("sha256", getSessionSecret()).update(`otp:${email}:${code}`).digest("base64url");
}

function isMatchingHash(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function reserveRequestEmail(email: string) {
  if (otpRequestEmailsInFlight.has(email)) {
    return false;
  }

  otpRequestEmailsInFlight.add(email);
  return true;
}

function releaseRequestEmail(email: string) {
  otpRequestEmailsInFlight.delete(email);
}

function getOtpRequestCooldownKey(request: IncomingMessage, email: string) {
  return `${getRequesterKey(request)}:${email}`;
}

function getOtpVerifyCooldownKey(request: IncomingMessage, email: string) {
  return `${getRequesterKey(request)}:${email}`;
}

function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

function getConfiguredOtpCode(email: string) {
  const fixedOtpEnabled = process.env.ALLOW_FIXED_OTP === "true" && process.env.APP_ENV !== "production";
  const fixedOtpEmail = process.env.FIXED_OTP_EMAIL?.trim().toLowerCase();
  const fixedOtpCode = process.env.FIXED_OTP_CODE?.trim();

  if (!fixedOtpEnabled || !fixedOtpEmail || !fixedOtpCode || !/^\d{6}$/.test(fixedOtpCode)) {
    return null;
  }

  return email.toLowerCase() === fixedOtpEmail ? fixedOtpCode : null;
}

function getOtpCode(email: string) {
  return getConfiguredOtpCode(email) ?? generateOtpCode();
}

async function hasTooManyPendingChallenges(email: string) {
  const pendingCount = await prisma.otpChallenge.count({
    where: {
      email,
      verifiedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  return pendingCount >= maxPendingChallenges;
}

async function loadCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        select: {
          siteId: true,
          role: true,
          site: {
            select: {
              name: true,
              _count: {
                select: {
                  tickets: {
                    where: {
                      status: "waiting",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  return currentUserSchema.parse({
    id: user.id,
    email: user.email,
    memberships: user.memberships.map((membership) => ({
      siteId: membership.siteId,
      siteName: membership.site.name,
      role: membership.role,
      waitingTicketCount: membership.site._count.tickets,
    })),
  });
}

export async function getCurrentUserFromRequest(request: IncomingMessage) {
  const session = readSession(request);

  if (!session) {
    return null;
  }

  return loadCurrentUser(session.userId);
}

export async function requireStaffMembership(request: IncomingMessage, siteId: string) {
  const currentUser = await getCurrentUserFromRequest(request);

  if (!currentUser) {
    return { status: "unauthorized" as const };
  }

  const membership = currentUser.memberships.find((item) => {
    return item.siteId === siteId && (item.role === "staff" || item.role === "admin");
  });

  if (!membership) {
    return { status: "forbidden" as const, currentUser };
  }

  return { status: "ok" as const, currentUser, membership };
}

export async function handleOtpRequest(request: IncomingMessage, response: ServerResponse) {
  const input = otpRequestInputSchema.safeParse(await readJson(request));

  if (!input.success) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }

  if (!canDeliverOtp()) {
    sendJson(response, 503, { error: "otp_delivery_unavailable" });
    return;
  }

  const requestCooldownKey = getOtpRequestCooldownKey(request, input.data.email);

  if (!reserveCooldown(otpRequestCooldowns, requestCooldownKey, otpRequestCooldownMs)) {
    sendJson(response, 429, { error: "rate_limited" });
    return;
  }

  if (!reserveRequestEmail(input.data.email)) {
    sendJson(response, 429, { error: "rate_limited" });
    return;
  }

  if (await hasTooManyPendingChallenges(input.data.email)) {
    clearCooldown(otpRequestCooldowns, requestCooldownKey);
    releaseRequestEmail(input.data.email);
    sendJson(response, 429, { error: "rate_limited" });
    return;
  }

  const code = getOtpCode(input.data.email);
  let challengeId: string | null = null;

  try {
    const challenge = await prisma.otpChallenge.create({
      data: {
        email: input.data.email,
        codeHash: hashOtp(input.data.email, code),
        expiresAt: new Date(Date.now() + otpTtlMs),
      },
    });
    challengeId = challenge.id;

    await deliverOtp(input.data.email, code);
  } catch (error) {
    if (challengeId) {
      await prisma.otpChallenge.delete({ where: { id: challengeId } }).catch(() => undefined);
    }

    if (error instanceof OtpDeliveryError) {
      console.error("OTP delivery failed", { provider: process.env.EMAIL_PROVIDER ?? "console" });
      sendJson(response, 503, { error: "otp_delivery_unavailable" });
      return;
    }

    if (!challengeId) {
      clearCooldown(otpRequestCooldowns, requestCooldownKey);
    }

    throw error;
  } finally {
    releaseRequestEmail(input.data.email);
  }

  sendJson(response, 202, { ok: true });
}

export async function handleOtpVerify(request: IncomingMessage, response: ServerResponse) {
  const input = otpVerifyInputSchema.safeParse(await readJson(request));

  if (!input.success) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }

  const verifyCooldownKey = getOtpVerifyCooldownKey(request, input.data.email);

  if (!reserveCooldown(otpVerifyCooldowns, verifyCooldownKey, otpVerifyCooldownMs)) {
    sendJson(response, 429, { error: "rate_limited" });
    return;
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      email: input.data.email,
      verifiedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!challenge || !isMatchingHash(challenge.codeHash, hashOtp(input.data.email, input.data.code))) {
    sendJson(response, 401, { error: "invalid_otp" });
    return;
  }

  clearCooldown(otpVerifyCooldowns, verifyCooldownKey);

  const user = await prisma.$transaction(async (tx) => {
    const claimedChallenge = await tx.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        verifiedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        verifiedAt: new Date(),
      },
    });

    if (claimedChallenge.count !== 1) {
      return null;
    }

    const verifiedUser = await tx.user.upsert({
      where: { email: input.data.email },
      update: {},
      create: { email: input.data.email },
    });

    await tx.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        userId: verifiedUser.id,
      },
    });

    return verifiedUser;
  });

  if (!user) {
    sendJson(response, 401, { error: "invalid_otp" });
    return;
  }

  const currentUser = await loadCurrentUser(user.id);

  if (!currentUser) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  sendJson(response, 200, currentUser, {
    "set-cookie": createSessionCookie(createSessionToken(user)),
  });
}

export async function handleLogout(_request: IncomingMessage, response: ServerResponse) {
  sendJson(response, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
}

export async function handleMe(request: IncomingMessage, response: ServerResponse) {
  const currentUser = await getCurrentUserFromRequest(request);

  if (!currentUser) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  sendJson(response, 200, currentUser);
}
