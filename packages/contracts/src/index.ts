export const queueStatuses = ['open', 'paused', 'closed'] as const
export type QueueStatus = (typeof queueStatuses)[number]

export const ticketStatuses = ['waiting', 'called', 'in_service', 'done', 'no_show', 'cancelled'] as const
export type TicketStatus = (typeof ticketStatuses)[number]

export type AppStage = 'v1-foundation' | 'v1-domain-schema'
