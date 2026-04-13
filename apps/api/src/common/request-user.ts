export type RequestMembership = {
  id: string
  organizationId: string
  organizationSlug: string
  role: 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER'
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED'
}

export type RequestUser = {
  id: string
  sessionId: string
  email: string
  displayName: string | null
  memberships: RequestMembership[]
}
