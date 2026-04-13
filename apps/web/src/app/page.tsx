const foundations = [
  {
    title: 'Patient Web',
    description: 'Future private-beta patient flow for email sign-in, queue join, and live status updates.',
  },
  {
    title: 'Staff Console',
    description: 'Operational queue board that replaces the legacy WPF workflow with authenticated web tooling.',
  },
  {
    title: 'Worker Pipeline',
    description: 'Notification and outbox processing separated from request-time API behavior.',
  },
]

const routeGroups = [
  {
    label: 'Patient',
    title: '/app/patient',
    description: 'Reserved route group for invite-based entry, check-in, and queue tracking.',
  },
  {
    label: 'Staff',
    title: '/app/staff',
    description: 'Reserved route group for queue operations, site settings, and notification history.',
  },
]

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">QDoc v1-foundation</span>
        <h1>Private beta foundation for queue operations.</h1>
        <p>
          This branch starts the rebuild away from the legacy hackathon stack. The new platform keeps patient and
          staff flows in one web app, moves the backend to a modern monorepo, and prepares the next milestone for the
          shared PostgreSQL domain schema.
        </p>

        <div className="actions">
          <a className="action" href="/app/patient">
            Patient Routes
          </a>
          <a className="action secondary" href="/app/staff">
            Staff Routes
          </a>
        </div>
      </section>

      <section className="grid">
        {foundations.map((item) => (
          <article key={item.title} className="card">
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </section>

      <section className="route-grid">
        {routeGroups.map((item) => (
          <article key={item.title} className="route-card">
            <span>{item.label}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
