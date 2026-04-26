# FHIRTogether Architecture Diagram

## System Overview

```mermaid
graph TB
  subgraph Clients["Client Applications"]
    WebApps["Web Apps / Mobile"]
    EHR["Legacy EHR Systems"]
    NewHL7["New System — HL7"]
    NewREST["New System — REST"]
  end

  subgraph Gateway["Fastify HTTP Server"]
    Swagger["Swagger UI /docs"]
    Auth["API Key Auth + Basic Auth fallback"]
    subgraph Routes["Routes Layer"]
      SystemR["/System routes"]
      LocationR["/Location routes"]
      DirectoryR["/Directory — public"]
      ScheduleR["/Schedule routes"]
      SlotR["/Slot routes"]
      ApptR["/Appointment routes"]
      HL7R["/hl7/siu + MLLP socket"]
    end
    Evaporation["Evaporation Timer"]
  end

  subgraph Store["Storage Layer"]
    StoreIF["FhirStore Interface"]
    SQLite["SqliteStore — better-sqlite3"]
  end

  subgraph DB["Database"]
    SysTbl["systems"]
    LocTbl["locations"]
    SchedTbl["schedules"]
    SlotTbl["slots"]
    ApptTbl["appointments"]
  end

  NewHL7 -->|"SIU + MSH-4/MSH-8 — auto-registers"| HL7R
  NewREST -->|"POST /System/register"| SystemR
  EHR -->|"HL7v2 SIU"| HL7R
  WebApps -->|"FHIR REST + Bearer token"| Auth
  Auth --> Routes
  Routes --> StoreIF
  StoreIF --> SQLite
  SQLite --> DB
  Evaporation -->|"Deletes expired systems"| SysTbl

  classDef public fill:#dcfce7,stroke:#22c55e
  classDef auth fill:#dbeafe,stroke:#3b82f6
  classDef store fill:#fef3c7,stroke:#f59e0b
  class DirectoryR public
  class Auth auth
  class SQLite,DB store
```

## Multi-Tenant Data Model

```mermaid
erDiagram
    systems ||--o{ locations : "has"
    systems ||--o{ schedules : "owns"
    locations ||--o{ schedules : "hosts"
    schedules ||--o{ slots : "defines"
    slots ||--o{ appointments : "booked as"

    systems {
        text id PK
        text name
        text url
        text api_key_hash
        text msh_application
        text msh_facility
        text msh_secret_hash
        text challenge_token
        text status
        text last_activity_at
        text created_at
        int ttl_days
    }
    locations {
        text id PK
        text system_id FK
        text name
        text address
        text city
        text state
        text zip
        text phone
        text hl7_location_id
    }
    schedules {
        text id PK
        text system_id FK
        text location_id FK
        text actor
        int active
    }
    slots {
        text id PK
        text schedule_id FK
        text status
        text start
        text end
    }
    appointments {
        text id PK
        text status
        text start
        text end
        text participant
    }
```

## System Onboarding Flows

### HL7 Zero-Friction Path

```mermaid
sequenceDiagram
    participant EHR as Legacy EHR
    participant GW as FHIRTogether Gateway
    participant DB as Database

    EHR->>GW: SIU^S12 (MSH-4=HOSPITAL, MSH-8=secret)
    GW->>DB: findOrCreateSystemByMSH("HOSPITAL", "secret")
    alt First contact
        DB-->>GW: {isNew: true, status: "unverified"}
        GW->>DB: Create system + hash MSH-8 secret
    else Returning system
        DB-->>GW: {isNew: false, secretMatch: true/false}
        alt Secret mismatch
            GW-->>EHR: ACK AR (rejected)
        end
    end
    GW->>DB: findOrCreateLocationByHL7(AIL segment)
    GW->>DB: Create/update Schedule + Slots
    GW-->>EHR: ACK AA (accepted)
```

### REST Registration Path

```mermaid
sequenceDiagram
    participant Sys as New System
    participant GW as FHIRTogether Gateway
    participant URL as System URL

    Sys->>GW: POST /System/register {name, url}
    GW-->>Sys: {systemId, challengeToken, challengeUrl}
    Note over Sys: Serve token at url/.well-known/fhirtogether-verify
    Sys->>GW: POST /System/{id}/verify
    GW->>URL: GET {url}/.well-known/fhirtogether-verify (TLS validated)
    URL-->>GW: challengeToken
    GW-->>Sys: {apiKey} (returned ONCE)
    Note over Sys: Use Authorization: Bearer {apiKey} for all requests
```

### System Lifecycle

```mermaid
stateDiagram-v2
    [*] --> unverified: HL7 first contact
    [*] --> pending: REST /System/register
    pending --> active: TLS challenge verified
    unverified --> active: Admin promotes
    active --> expired: TTL exceeded (evaporation)
    unverified --> expired: TTL exceeded (evaporation)
    expired --> [*]: System + data cascade-deleted
```

## Data Flow: Booking an Appointment

```
1. Client Request
   POST /Appointment
   {
     "status": "booked",
     "slot": [{"reference": "Slot/123"}],
     "participant": [...]
   }
          │
          ▼
2. Route Handler (appointmentRoutes.ts)
   - Validates request schema
   - Extracts appointment data
          │
          ▼
3. Store Layer
   - Creates appointment record
   - Extracts slot references
   - Updates slot status to "busy"
          │
          ▼
4. Database
   - INSERT into appointments table
   - UPDATE slots SET status='busy'
          │
          ▼
5. Response to Client
   {
     "resourceType": "Appointment",
     "id": "generated-id",
     "status": "booked",
     ...
   }
```

## Data Generation Flow

```
npm run generate-data
       │
       ▼
generateBusyOffice.ts
       │
       ├─► 1. Clear existing data
       │      - DELETE all appointments
       │      - DELETE all slots
       │      - DELETE all schedules
       │
       ├─► 2. Create provider schedules
       │      - Dr. Smith (Family Medicine)
       │      - Dr. Johnson (Internal Medicine)
       │      - Dr. Williams (Pediatrics)
       │
       ├─► 3. Generate time slots (30 days)
       │      For each provider:
       │        For each working day:
       │          Create slots from start to end time
       │          (based on appointment duration)
       │
       ├─► 4. Book appointments (~75% fill)
       │      For each provider:
       │        Select random slots
       │        Create patient references
       │        Book appointments
       │        Mark slots as busy
       │
       └─► 5. Display statistics
              - Total schedules, slots, appointments
              - Fill rate
              - Avg appointments per provider/day
```

## Request/Response Examples

### Search for Free Slots

```
Request:
GET /Slot?schedule=Schedule/12345&status=free&start=2025-12-10T00:00:00Z

Response:
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 45,
  "entry": [
    {
      "fullUrl": "http://localhost:4010/Slot/slot-1",
      "resource": {
        "resourceType": "Slot",
        "id": "slot-1",
        "schedule": {
          "reference": "Schedule/12345",
          "display": "Dr. Sarah Smith"
        },
        "status": "free",
        "start": "2025-12-10T08:00:00Z",
        "end": "2025-12-10T08:20:00Z",
        "serviceType": [{"text": "Family Medicine"}]
      }
    },
    ...
  ]
}
```

### Book an Appointment

```
Request:
POST /Appointment
{
  "resourceType": "Appointment",
  "status": "booked",
  "description": "Annual Physical",
  "slot": [{"reference": "Slot/slot-1"}],
  "participant": [
    {
      "actor": {
        "reference": "Practitioner/practitioner-smith",
        "display": "Dr. Sarah Smith"
      },
      "status": "accepted"
    },
    {
      "actor": {
        "reference": "Patient/patient-123",
        "display": "Jane Doe"
      },
      "status": "accepted"
    }
  ]
}

Response:
{
  "resourceType": "Appointment",
  "id": "1733755200000-abc123xyz",
  "status": "booked",
  "description": "Annual Physical",
  "start": "2025-12-10T08:00:00Z",
  "end": "2025-12-10T08:20:00Z",
  "slot": [{"reference": "Slot/slot-1"}],
  "participant": [...],
  "meta": {
    "lastUpdated": "2025-12-09T13:00:00.000Z"
  }
}

Side Effect: Slot/slot-1 status changed from "free" to "busy"
```

## Technology Stack

```
┌─────────────────────────────────────────────┐
│              Application Layer              │
│  • TypeScript (Type Safety)                 │
│  • Fastify (HTTP Server)                    │
│  • @fastify/swagger (OpenAPI Docs)          │
│  • @fastify/cors (Cross-Origin)             │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│              Data Access Layer              │
│  • FhirStore interface (pluggable backend)  │
│  • Default: SqliteStore (better-sqlite3)    │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│             Storage Layer                   │
│  • Pluggable backend (default: SQLite3)     │
│  • File-based: ./data/fhirtogether.db       │
└─────────────────────────────────────────────┘
```

## File Dependencies

```
server.ts
├── imports dotenv (.env config)
├── imports SqliteStore
│   └── requires Database from better-sqlite3
│   └── implements FhirStore interface (types/fhir.ts)
├── imports registerApiKeyAuth (auth/apiKeyAuth.ts)
│   └── imports validateBasicAuth (auth/basicAuth.ts)
├── imports createMLLPServer (hl7/socket.ts)
├── registers routes/
│   ├── systemRoutes.ts     (System registration + management)
│   ├── locationRoutes.ts   (Location CRUD)
│   ├── directoryRoutes.ts  (Public provider directory)
│   ├── scheduleRoutes.ts
│   ├── slotRoutes.ts
│   ├── appointmentRoutes.ts
│   ├── hl7Routes.ts        (HL7v2 SIU ingestion)
│   └── importRoutes.ts
├── starts evaporation timer
└── registers swagger plugins

generateBusyOffice.ts
└── imports SqliteStore
    └── uses FHIR types (Schedule, Slot, Appointment)
```

## Environment Configuration Flow

```
.env file
  ↓
dotenv loads into process.env
  ↓
server.ts reads config
  ├── PORT (default: 4010)
  ├── HOST (default: 0.0.0.0)
  ├── STORE_BACKEND (default: sqlite)
  ├── LOG_LEVEL (default: info)
  ├── ENABLE_TEST_ENDPOINTS (default: true)
  ├── AUTH_USERNAME / AUTH_PASSWORD (admin Basic Auth)
  ├── SYSTEM_TTL_DAYS (default: 7)
  ├── EVAPORATION_CHECK_INTERVAL_HOURS (default: 1)
  └── DIRECTORY_SHOW_UNVERIFIED (default: false)
  ↓
Store backend reads config (e.g. SQLITE_DB_PATH)
  ↓
Creates/opens database (e.g. ./data/fhirtogether.db)
```

## Busy Office Simulation

```
3 Providers × 9 hours/day × 60 min/hour ÷ 20 min/appt = ~81 slots/provider/day
3 Providers × 81 slots × 21 working days (30 days) = ~5,103 total slots
5,103 slots × 75% fill rate = ~3,827 appointments
3,827 appointments ÷ 3 providers ÷ 21 days = ~60 appointments/provider/day
```

## API Endpoint Matrix

| Resource    | GET (search) | GET (by ID) | POST (create) | PUT (update) | DELETE |
|-------------|--------------|-------------|---------------|--------------|--------|
| System      | ✅           | —           | ✅ (register) | ✅           | ✅     |
| Location    | ✅           | ✅          | ✅            | ✅           | ✅     |
| Directory   | ✅ (public)  | —           | —             | —            | —      |
| Schedule    | ✅           | ✅          | ✅            | ✅           | ✅*    |
| Slot        | ✅           | ✅          | ✅            | ✅           | ✅*    |
| Appointment | ✅           | ✅          | ✅            | ✅           | ✅     |

*Requires ENABLE_TEST_ENDPOINTS=true

## Query Parameters Supported

### /System
- Admin: returns all systems
- Bearer: returns own system details

### /Location
- `zip` - Filter by zip code
- `_count` - Limit results

### /Directory (public)
- `zip` - Filter by zip code
- `specialty` - Filter by provider specialty
- `name` - Filter by provider or system name
- `status` - Filter by system status (active/unverified/all)
- `_format` - Response format (fhir/json/yaml/hl7)

### /Schedule
- `actor` - Filter by practitioner reference
- `active` - Filter by active status (true/false)
- `date` - Filter by date within planning horizon
- `_count` - Limit results

### /Slot
- `schedule` - Filter by schedule reference
- `status` - Filter by status (free/busy/busy-unavailable/busy-tentative)
- `start` - Filter slots starting after this datetime
- `end` - Filter slots ending before this datetime
- `_count` - Limit results

### /Appointment
- `date` - Filter by appointment date
- `status` - Filter by appointment status
- `patient` - Filter by patient reference
- `actor` - Filter by any participant actor
- `_count` - Limit results
