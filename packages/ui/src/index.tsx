import type { PropsWithChildren } from 'react'

type SectionCardProps = PropsWithChildren<{
  title: string
  description: string
}>

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section
      style={{
        padding: '24px',
        borderRadius: '24px',
        border: '1px solid rgba(84, 57, 39, 0.14)',
        background: 'rgba(255,255,255,0.84)',
      }}
    >
      <h2 style={{ margin: '0 0 10px' }}>{title}</h2>
      <p style={{ margin: 0, lineHeight: 1.6, color: '#6f6259' }}>{description}</p>
      {children ? <div style={{ marginTop: '16px' }}>{children}</div> : null}
    </section>
  )
}
