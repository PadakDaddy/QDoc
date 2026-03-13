import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { ACTIVE_TICKET_STATUSES, QueueStatus } from '../common/contracts'
import { PrismaService } from '../prisma/prisma.service'
import { HospitalSort, SearchHospitalsDto } from './dto/search-hospitals.dto'

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadiusKm = 6371
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function queueStatusRank(status: QueueStatus) {
  switch (status) {
    case 'Open':
      return 0
    case 'Paused':
      return 1
    case 'Closed':
      return 2
    default:
      return 3
  }
}

type HospitalView = {
  id: string
  name: string
  address: string
  phone: string
  lat: number
  lng: number
  queueStatus: QueueStatus
  departments: Array<{ id: string; name: string }>
  currentWaiting: number
  estimatedWaitMin: number
  lastUpdatedAt: string
  distanceKm: number
}

@Injectable()
export class HospitalsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(query: SearchHospitalsDto) {
    const hospitals = await this.prisma.hospital.findMany({
      include: {
        departments: {
          select: {
            id: true,
            name: true,
          },
        },
        queues: {
          include: {
            tickets: {
              where: {
                status: {
                  in: ACTIVE_TICKET_STATUSES,
                },
              },
              select: {
                status: true,
              },
            },
            waitSnapshots: {
              orderBy: {
                capturedAt: 'desc',
              },
              take: 1,
              select: {
                averageMinutes: true,
                capturedAt: true,
              },
            },
          },
        },
      },
    })

    const keyword = query.keyword?.trim().toLowerCase() ?? ''
    const departmentKeyword = query.departmentName?.trim().toLowerCase() ?? ''

    const filtered = hospitals
      .filter((hospital) => {
        if (!departmentKeyword) {
          return true
        }

        return hospital.departments.some((department) =>
          department.name.toLowerCase().includes(departmentKeyword),
        )
      })
      .filter((hospital) => {
        if (!keyword) {
          return true
        }

        const departmentNames = hospital.departments.map((department) => department.name.toLowerCase())
        return (
          hospital.name.toLowerCase().includes(keyword) ||
          hospital.address.toLowerCase().includes(keyword) ||
          departmentNames.some((name) => name.includes(keyword))
        )
      })
      .map<HospitalView>((hospital) => {
        const distance = distanceKm(query.lat, query.lng, hospital.lat, hospital.lng)

        const waiting = hospital.queues.reduce((sum, queue) => sum + queue.tickets.length, 0)

        const latestSnapshot = hospital.queues
          .flatMap((queue) => queue.waitSnapshots)
          .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]

        const avgMin = latestSnapshot?.averageMinutes ?? hospital.avgMin

        return {
          id: hospital.id,
          name: hospital.name,
          address: hospital.address,
          phone: hospital.phone,
          lat: hospital.lat,
          lng: hospital.lng,
          queueStatus: hospital.queueStatus as QueueStatus,
          departments: hospital.departments,
          currentWaiting: waiting,
          estimatedWaitMin: waiting * avgMin,
          lastUpdatedAt: (latestSnapshot?.capturedAt ?? hospital.updatedAt).toISOString(),
          distanceKm: Number(distance.toFixed(2)),
        }
      })
      .filter((hospital) => hospital.distanceKm <= query.radiusKm)

    return this.sortHospitals(filtered, query.sortBy)
  }

  async getHospitalById(hospitalId: string) {
    const hospital = await this.prisma.hospital.findUnique({
      where: {
        id: hospitalId,
      },
      include: {
        departments: {
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            name: 'asc',
          },
        },
        queues: {
          include: {
            tickets: {
              where: {
                status: {
                  in: ACTIVE_TICKET_STATUSES,
                },
              },
              select: {
                id: true,
              },
            },
            waitSnapshots: {
              orderBy: {
                capturedAt: 'desc',
              },
              take: 1,
              select: {
                averageMinutes: true,
                capturedAt: true,
              },
            },
          },
        },
      },
    })

    if (!hospital) {
      throw new NotFoundException('Hospital not found')
    }

    const waiting = hospital.queues.reduce((sum, queue) => sum + queue.tickets.length, 0)
    const latestSnapshot = hospital.queues
      .flatMap((queue) => queue.waitSnapshots)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]

    const avgMin = latestSnapshot?.averageMinutes ?? hospital.avgMin

    return {
      id: hospital.id,
      name: hospital.name,
      address: hospital.address,
      phone: hospital.phone,
      lat: hospital.lat,
      lng: hospital.lng,
      queueStatus: hospital.queueStatus,
      departments: hospital.departments,
      currentWaiting: waiting,
      estimatedWaitMin: waiting * avgMin,
      lastUpdatedAt: (latestSnapshot?.capturedAt ?? hospital.updatedAt).toISOString(),
    }
  }

  async getDepartmentNames() {
    const departments = await this.prisma.department.findMany({
      distinct: ['name'],
      orderBy: {
        name: 'asc',
      },
      select: {
        name: true,
      },
    })

    return departments.map((department) => department.name)
  }

  async getDepartments(hospitalId: string) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        departments: {
          where: {
            queues: {
              some: {},
            },
          },
          orderBy: {
            name: 'asc',
          },
        },
      },
    })

    if (!hospital) {
      throw new NotFoundException('Hospital not found')
    }

    return {
      hospitalId: hospital.id,
      departments: hospital.departments,
    }
  }

  async getDoctors(hospitalId: string, departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: {
        id: departmentId,
        hospitalId,
      },
      include: {
        doctors: {
          orderBy: {
            name: 'asc',
          },
        },
      },
    })

    if (!department) {
      throw new NotFoundException('Department not found in hospital')
    }

    return {
      hospitalId,
      departmentId,
      doctors: department.doctors,
    }
  }

  private sortHospitals(items: HospitalView[], sortBy: HospitalSort) {
    const sorted = [...items]

    if (sortBy === 'wait') {
      sorted.sort((a, b) => a.estimatedWaitMin - b.estimatedWaitMin || a.distanceKm - b.distanceKm)
      return sorted
    }

    if (sortBy === 'status') {
      sorted.sort(
        (a, b) => queueStatusRank(a.queueStatus) - queueStatusRank(b.queueStatus) || a.distanceKm - b.distanceKm,
      )
      return sorted
    }

    sorted.sort((a, b) => a.distanceKm - b.distanceKm)
    return sorted
  }
}

