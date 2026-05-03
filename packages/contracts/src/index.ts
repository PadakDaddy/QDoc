import { z } from "zod";

export const ticketStatusSchema = z.enum([
  "waiting",
  "called",
  "in_service",
  "completed",
  "delay",
  "cancelled",
]);

export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const activeTicketStatuses: TicketStatus[] = ["waiting", "called", "in_service", "delay"];

export const siteSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  queueName: z.string(),
  estimatedWaitLabel: z.string(),
});

export type SiteSummary = z.infer<typeof siteSummarySchema>;

export const emailSchema = z.string().trim().email().toLowerCase();

export const otpRequestInputSchema = z.object({
  email: emailSchema,
});

export type OtpRequestInput = z.infer<typeof otpRequestInputSchema>;

export const otpVerifyInputSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/),
});

export type OtpVerifyInput = z.infer<typeof otpVerifyInputSchema>;

export const membershipSummarySchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  role: z.enum(["staff", "admin"]),
  waitingTicketCount: z.number().int().nonnegative(),
});

export const currentUserSchema = z.object({
  id: z.string(),
  email: emailSchema,
  memberships: membershipSummarySchema.array(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

export const authErrorSchema = z.object({
  error: z.enum([
    "conflict",
    "forbidden",
    "invalid_request",
    "invalid_otp",
    "invalid_transition",
    "internal_error",
    "otp_delivery_unavailable",
    "queue_closed",
    "rate_limited",
    "unauthorized",
    "not_found",
  ]),
});

export type AuthError = z.infer<typeof authErrorSchema>;

export const staffQueueSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isOpen: z.boolean(),
});

export const staffQueueResponseSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  queues: staffQueueSummarySchema.array(),
  tickets: z
    .object({
      id: z.string(),
      siteId: z.string(),
      siteName: z.string(),
      queueId: z.string(),
      queueName: z.string(),
      patientEmail: z.string().min(1),
      status: ticketStatusSchema,
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .array(),
});

export type StaffQueueResponse = z.infer<typeof staffQueueResponseSchema>;

export const staffTicketSummarySchema = z.object({
  id: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  queueId: z.string(),
  queueName: z.string(),
  patientEmail: z.string().min(1),
  status: ticketStatusSchema,
  updatedAt: z.string().datetime(),
});

export type StaffTicketSummary = z.infer<typeof staffTicketSummarySchema>;

export const staffTicketResponseSchema = z.object({
  ticket: staffTicketSummarySchema,
});

export type StaffTicketResponse = z.infer<typeof staffTicketResponseSchema>;

export const staffTicketActionInputSchema = z.object({
  siteId: z.string().min(1),
});

export type StaffTicketActionInput = z.infer<typeof staffTicketActionInputSchema>;

export const patientSiteSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  waitingTicketCount: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative(),
});

export type PatientSiteSummary = z.infer<typeof patientSiteSummarySchema>;

export const patientSitesResponseSchema = z.object({
  sites: patientSiteSummarySchema.array(),
});

export type PatientSitesResponse = z.infer<typeof patientSitesResponseSchema>;

export const patientQueueSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isOpen: z.boolean(),
});

export type PatientQueueSummary = z.infer<typeof patientQueueSummarySchema>;

export const patientQueuesResponseSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  queues: patientQueueSummarySchema.array(),
});

export type PatientQueuesResponse = z.infer<typeof patientQueuesResponseSchema>;

export const checkInInputSchema = z.object({
  queueId: z.string().min(1),
});

export type CheckInInput = z.infer<typeof checkInInputSchema>;

export const patientNotificationSummarySchema = z.object({
  id: z.string(),
  channel: z.string(),
  message: z.string(),
  createdAt: z.string().datetime(),
});

export type PatientNotificationSummary = z.infer<typeof patientNotificationSummarySchema>;

export const patientTicketSummarySchema = z.object({
  id: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  queueId: z.string(),
  queueName: z.string(),
  status: ticketStatusSchema,
  createdAt: z.string().datetime(),
  notifications: patientNotificationSummarySchema.array(),
});

export type PatientTicketSummary = z.infer<typeof patientTicketSummarySchema>;

export const checkInResponseSchema = z.object({
  ticket: patientTicketSummarySchema,
});

export type CheckInResponse = z.infer<typeof checkInResponseSchema>;

export const activeTicketsResponseSchema = z.object({
  tickets: patientTicketSummarySchema.array(),
});

export type ActiveTicketsResponse = z.infer<typeof activeTicketsResponseSchema>;
