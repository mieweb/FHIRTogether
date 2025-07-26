# FHIRTogether Scheduling Synapse

**FHIR-compliant gateway and test server for schedule and appointment availability.**

---

## 🧠 Overview

**FHIRTogether Scheduling Synapse** is a TypeScript + Fastify server designed to help **modernize legacy scheduling systems** by offering a **standards-compliant FHIR interface** over pluggable backend stores. It supports **FHIR `Schedule`, `Slot`, and `Appointment` resources** and can ingest **HL7v2 SIU messages**, making it ideal for:

- Acting as a **gateway** between legacy/proprietary EHRs and modern clients
- Serving as a **test server** to prototype or simulate provider group schedules
- Enabling **public applications** to discover and book available time

---

## 🔥 Key Features

- ✅ Full support for FHIR R4 RESTful APIs:
  - `/Schedule`, `/Slot`, `/Appointment`
- 🔁 HL7v2 message ingestion (`SIU^S12`, `S13`, `S15`)
- 🧩 Pluggable backend support: MongoDB, MySQL, PostgreSQL, MSSQL
- 🌐 OpenAPI 3.1 (Swagger UI) auto-generated from routes
- 🧪 Test mode for seeding schedules, clearing data, or simulating providers
- ⚡ Fastify-based, modern TypeScript stack
- 🔐 Simple bearer token authentication (SMART-on-FHIR ready)
- 🛠️ Command-line tools for appointment management

---

## 🛠 Use Case: Making Legacy Systems FHIR-Compliant

If you're working with a proprietary scheduling system that stores appointment data in a non-standard format (e.g., mainframe, custom RDBMS, HL7v2-only systems), **FHIRTogether** allows you to:

1. Implement a storage engine that adapts your system's internal schema to the FHIR `Slot`, `Schedule`, and `Appointment` structure.
2. Optionally translate HL7v2 `SIU` messages into storage-compatible entries.
3. Instantly expose a **FHIR-native API** over your legacy data.

No need to re-architect your legacy system — just implement a backend adapter.

## 🚀 Quickstart

```bash
git clone https://github.com/mieweb/FHIRTogether.git
cd FHIRTogether
npm install

# Copy environment file and configure
cp .env.example .env

# Start development server
npm run dev
```

The server will start at: http://localhost:3000

**Essential Endpoints:**
- 📚 **Swagger UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
- 🏥 **FHIR Metadata**: [http://localhost:3000/metadata](http://localhost:3000/metadata)
- ❤️ **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

---

## 📦 API Endpoints

### FHIR Resources
All endpoints return FHIR R4-compliant resources or Bundles:

| Method | Path             | Description                      |
| ------ | ---------------- | -------------------------------- |
| GET    | `/Schedule`      | Search provider availability     |
| POST   | `/Schedule`      | Create provider schedule         |
| GET    | `/Schedule/{id}` | Get schedule by ID               |
| PUT    | `/Schedule/{id}` | Update schedule                  |
| DELETE | `/Schedule/{id}` | Delete schedule (test mode)      |
| GET    | `/Slot`          | Search for free/busy slots       |
| POST   | `/Slot`          | Block a time slot                |
| GET    | `/Slot/{id}`     | Get slot by ID                   |
| PUT    | `/Slot/{id}`     | Update slot                      |
| DELETE | `/Slot/{id}`     | Delete slot (test mode)          |
| GET    | `/Appointment`   | Search appointments              |
| POST   | `/Appointment`   | Book an appointment              |
| GET    | `/Appointment/{id}` | Get appointment by ID         |
| PUT    | `/Appointment/{id}` | Update appointment            |
| DELETE | `/Appointment/{id}` | Cancel appointment            |

### Special Operations

| Method | Path                | Description                      |
| ------ | ------------------- | -------------------------------- |
| POST   | `/$hl7v2-ingest`   | Ingest HL7v2 scheduling messages|
| POST   | `/$simulate-week`   | Generate random provider schedule|
| DELETE | `/Schedule`         | Clear all schedules (test mode)  |
| DELETE | `/Slot`             | Clear all slots (test mode)      |

### System Endpoints

| Method | Path           | Description                      |
| ------ | -------------- | -------------------------------- |
| GET    | `/metadata`    | FHIR capability statement        |
| GET    | `/health`      | System health check              |
| GET    | `/`            | Server information               |

### Authentication (Optional)

| Method | Path              | Description                      |
| ------ | ----------------- | -------------------------------- |
| POST   | `/auth/token`     | Generate access token            |
| GET    | `/auth/introspect`| Validate token                   |

---

## 🧩 Pluggable Store Interface

To integrate with your system, implement the `FhirStore` interface:

```typescript
interface FhirStore {
  getSlots(query: FhirSlotQuery): Promise<Slot[]>;
  createSlot(slot: Slot): Promise<Slot>;
  getSchedules(query: FhirScheduleQuery): Promise<Schedule[]>;
  createSchedule(schedule: Schedule): Promise<Schedule>;
  createAppointment(appt: Appointment): Promise<Appointment>;
  // ... additional methods
}
```

### Available Backend Stores

Backend modules are located in `/src/store/`:

* **`simulatorStore.ts`** - 🎯 **Working implementation** with in-memory storage and sample data
* `mongoStore.ts` - MongoDB adapter (stub)
* `postgresStore.ts` - PostgreSQL adapter (stub)  
* `mysqlStore.ts` - MariaDB and MySQL adapter (stub)
* `mssqlStore.ts` - Microsoft SQL Server adapter (stub)

Use the `.env` file to select your backend:

```env
# Backend Store Selection
STORE_BACKEND=simulator  # Options: simulator, mongodb, mysql, postgres, mssql
```

---

## 🔄 HL7v2 Message Ingestion

Send HL7v2 scheduling messages (e.g., `SIU^S12`, `S13`, `S15`) to:

```
POST /$hl7v2-ingest
```

**Request Body:**
```json
{
  "message": "MSH|^~\\&|SCHED|HOSPITAL|FHIR|GATEWAY|20240101090000||SIU^S12|MSG001|P|2.5\rSCH|SCH001|NEW|||30|MIN|ROUTINE||20240101090000|20240101093000|||DR001||||PENDING",
  "sourceSystem": "LegacyScheduler"
}
```

The server parses the message and converts it into FHIR `Slot` and `Schedule` resources internally.

### Supported SIU Message Types
- **SIU^S12** - New appointment booking → Create Schedule/Slot
- **SIU^S13** - Appointment rescheduling → Update Slot  
- **SIU^S15** - Appointment cancellation → Delete Slot

---

## 🧪 Test Server Mode

When `ENABLE_TEST_MODE=true`, additional endpoints are available:

```bash
# Clear all data
DELETE /Schedule
DELETE /Slot

# Generate sample provider schedule for testing
POST /$simulate-week
{
  "providerId": "dr-smith"
}
```

Example simulation response:
```json
{
  "resourceType": "OperationOutcome",
  "status": "success",
  "simulatedWeek": {
    "providerId": "dr-smith",
    "schedulesCreated": 1,
    "slotsCreated": 80,
    "scheduleIds": ["schedule-dr-smith"],
    "sampleSlots": [
      {
        "id": "slot-dr-smith-1643724000000",
        "start": "2024-02-01T09:00:00.000Z",
        "end": "2024-02-01T09:30:00.000Z",
        "status": "free"
      }
    ]
  }
}
```

---

## 🛠️ Command Line Tools

### Search for Available Slots

```bash
# Search for EKG appointments
node cli/search-slots.js --service=EKG

# Search for X-Ray appointments  
node cli/search-slots.js --service="X-Ray"

# Search with date range
node cli/search-slots.js --start=2024-01-01T09:00:00Z --end=2024-01-02T17:00:00Z
```

**Service Types:**
- `EKG` or `722` - EKG/ECG testing
- `X-Ray` or `708` - X-Ray imaging
- `124` - General Practice visits  
- `Physical` - Physical examinations

### Book Appointments

```bash
# Book an appointment
node cli/book-appointment.js --slot=slot-ekg-123 --patient=patient-456

# Book with details
node cli/book-appointment.js \
  --slot=slot-ekg-123 \
  --patient=patient-456 \
  --reason=routine \
  --description="Annual EKG screening"
```

### Complete Demo Workflow

```bash
# Run the complete demo showing search → book → verify
./examples/demo.sh
```

The demo will:
1. 🔍 Search for available EKG slots
2. 📅 Book the first available slot  
3. ✅ Verify the slot is no longer available
4. 📋 Confirm the appointment was created
5. 📊 Show other available service types

---

## 🔐 Authentication (Optional)

Simple bearer token authentication is available for future SMART-on-FHIR integration:

```bash
# Enable authentication
export ENABLE_AUTH=true

# Get a token
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"client_id": "my-app"}'

# Use the token
curl -H "Authorization: Bearer demo-token-my-app-1643724000000" \
  http://localhost:3000/Schedule
```

**Public endpoints** (no auth required):
- `/health`, `/metadata`, `/docs`, `/auth/*`, `/`

---

## ⚙️ Configuration

Environment variables (`.env` file):

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Backend Store Selection
STORE_BACKEND=simulator

# Database Configuration (when not using simulator)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fhirtogether
DB_USER=fhir
DB_PASSWORD=fhir

# Authentication (optional)
ENABLE_AUTH=false
JWT_SECRET=your-secret-key-here

# Test Mode Settings
ENABLE_TEST_MODE=true
```

---

## 🏗️ Development

```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev

# Build for production
npm run build

# Run production server
npm start

# Lint code
npm run lint

# Run tests
npm test
```

---

## 📊 Example Workflow

Here's a complete workflow demonstrating the scheduling system:

```bash
# 1. Start the server
npm run dev

# 2. Check available EKG slots
node cli/search-slots.js --service=EKG

# 3. Book an appointment
node cli/book-appointment.js \
  --slot=slot-schedule-ekg-1643724000000 \
  --patient=patient-john-doe

# 4. Verify the slot is no longer available
node cli/search-slots.js --service=EKG

# 5. Check the appointment was created
curl "http://localhost:3000/Appointment?patient=patient-john-doe"
```

---

## 🧭 Roadmap

* [x] FHIR R4 Schedule, Slot, Appointment resources
* [x] HL7v2 SIU message ingestion  
* [x] Pluggable backend architecture
* [x] OpenAPI 3.1 documentation
* [x] Command-line tools
* [x] Simple bearer token authentication
* [ ] Add SMART-on-FHIR / OAuth support  
* [ ] FHIR Subscription support for appointment updates
* [ ] `$find-appointment` operation  
* [ ] HL7v2 SRM^S03 request/response handling
* [ ] FHIR Bulk Export for schedules

---

## 📄 License

MIT

## 🤝 Contributing

If you're modernizing a legacy EHR or want to contribute HL7v2 mappings, backend drivers, or scheduler logic — PRs welcome!

---

## 🛡️ Project Goal

> Bring legacy scheduling infrastructure into the FHIR world — one appointment at a time.

