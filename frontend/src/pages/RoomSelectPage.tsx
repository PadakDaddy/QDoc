import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CustomerShell } from '../components/CustomerShell'
import { useAuth } from '../features/auth/useAuth'
import { useOnboarding } from '../features/onboarding/useOnboarding'
import { getHospitalDepartmentsWithDoctors, getHospitalQueueSnapshotById } from '../services/hospitalService'
import { QueueServiceError, enrollQueue, getLatestActiveTicket } from '../services/queueService'

type RoomOption = {
  id: string
  badge: string
  doctorLabel: string
  roomLabel: string
}

export function RoomSelectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { session } = useAuth()
  const { contract } = useOnboarding()

  const hospitalId = searchParams.get('hospitalId') ?? contract.selectedHospitalId
  const patientName = searchParams.get('patientName') ?? session?.user.name ?? 'Self'

  const [searchKeyword, setSearchKeyword] = useState('')
  const [hospitalName, setHospitalName] = useState('Selected hospital')
  const [roomOptions, setRoomOptions] = useState<RoomOption[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hospitalId) {
      navigate('/hospitals', { replace: true })
      return
    }

    let cancelled = false

    async function loadRoomCandidates() {
      try {
        const [hospital, departments] = await Promise.all([
          getHospitalQueueSnapshotById(hospitalId),
          getHospitalDepartmentsWithDoctors(hospitalId),
        ])

        if (cancelled) {
          return
        }

        if (hospital) {
          setHospitalName(hospital.name)
        }

        const waitingSeed = hospital?.currentWaiting ?? 1

        const mapped = departments.slice(0, 2).map((department, index) => {
          const waiting = Math.max(0, waitingSeed - index * 4)
          const badge = waiting <= 1 ? 'Immediate check-in' : `${waiting} people waiting`
          const doctorName = department.doctors[0] ?? `${department.name} doctor`

          return {
            id: department.id,
            badge,
            doctorLabel: doctorName,
            roomLabel: `Room ${index + 1} · ${department.name}`,
          }
        })

        if (!mapped.length) {
          setRoomOptions([])
          setSelectedRoomId('')
          setError('No queue-enabled consultation rooms are available right now.')
          return
        }

        setRoomOptions(mapped)
        setSelectedRoomId((current) => current || mapped[0].id)
      } catch {
        if (!cancelled) {
          setRoomOptions([])
          setSelectedRoomId('')
          setError('Could not load room data. Please go back and try again.')
        }
      }
    }

    void loadRoomCandidates()

    return () => {
      cancelled = true
    }
  }, [hospitalId, navigate])

  const legalNotice = useMemo(
    () =>
      [
        'Legal notice for patient identity information',
        'This clinic collects minimum identity data for patient safety and check-in processing.',
        'Data is used only for treatment operations under applicable regulations.',
        'Information handling follows privacy and security policy requirements.',
      ],
    [],
  )

  async function handleQueueEnrollment() {
    if (!hospitalId || !selectedRoomId) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const ticket = await enrollQueue({
        hospitalId,
        departmentId: selectedRoomId,
        targetType: 'self',
        targetName: patientName,
        familyMemberId: null,
      })

      navigate(`/queue/status?ticketId=${encodeURIComponent(ticket.id)}`, { replace: true })
    } catch (caught) {
      if (caught instanceof QueueServiceError && caught.code === 'DUPLICATE_ACTIVE_TICKET') {
        const active = await getLatestActiveTicket()
        if (active) {
          navigate(`/queue/status?ticketId=${encodeURIComponent(active.id)}`, { replace: true })
          return
        }
      }

      setError(
        caught instanceof QueueServiceError
          ? caught.message
          : 'Check-in failed. Please try again in a moment.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <CustomerShell
      activeMenu="hospitals"
      searchKeyword={searchKeyword}
      onSearchKeywordChange={setSearchKeyword}
      onSearchSubmit={() => navigate(`/hospitals?keyword=${encodeURIComponent(searchKeyword.trim())}`)}
    >
      <section className="home-section-card">
        <header className="flow-header">
          <p className="flow-step">Queue registration</p>
          <h2>Select consultation room</h2>
          <p>
            Hospital: <strong>{hospitalName}</strong> · Patient: <strong>{patientName}</strong>
          </p>
        </header>

        <section className="flow-room-list">
          {roomOptions.map((room) => (
            <button
              key={room.id}
              type="button"
              className={`flow-room-card${selectedRoomId === room.id ? ' selected' : ''}`}
              onClick={() => setSelectedRoomId(room.id)}
            >
              <div>
                <span className="flow-badge">{room.badge}</span>
                <strong>{room.doctorLabel}</strong>
                <p>{room.roomLabel}</p>
              </div>
              <span className="flow-check" aria-hidden="true">
                {selectedRoomId === room.id ? '✓' : ''}
              </span>
            </button>
          ))}
        </section>

        <div className="flow-inline-actions">
          <button type="button" className="ghost-button" onClick={() => navigate('/hospitals')}>
            Back to Hospitals
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedRoomId || isSubmitting}
            onClick={handleQueueEnrollment}
          >
            {isSubmitting ? 'Processing...' : 'Complete Check-in'}
          </button>
        </div>
      </section>

      {error ? <p className="customer-error">{error}</p> : null}

      <section className="home-section-card flow-legal-card">
        {legalNotice.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
    </CustomerShell>
  )
}
