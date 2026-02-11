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

```mermaid
flowchart LR
  A[Legacy EHR]
  B[FHIRTogether FHIR Server]
  C[Scheduling Broker - BlueHive]
  D[Users and Provider Apps]

  A -->|HL7v2 SIU S13 S15| B
  B -->|FHIR Schedule Slot Appointment| C
  C -->|Book and Update via FHIR| B
  B -->|HL7v2 ACK or Updates| A
  D -->|Discover availability and request booking| C
  C -->|Notifications and confirmations| D
```

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
npm run dev
````

Swagger UI: [http://localhost:4010/docs](http://localhost:4010/docs)

## 🧩 Pluggable Store Interface

**Important:** The store interface is **not** for connecting directly to your EHR or Practice Management system. Instead, it's a **working data repository** for the scheduling portal that holds appointment data representing schedules for providers/resources.

### Understanding the Store

The store you select is:
- ✅ A **storage system you're comfortable with** (SQLite, PostgreSQL, MySQL, MongoDB, etc.)
- ✅ A **working cache** that syncs FROM your EHR or PM system
- ✅ Used to **hold appointment scheduling data** for fast queries and updates
- ❌ **NOT the source of truth** — your EHR/PM system remains authoritative
- ❌ **NOT a direct database connection** to your production EHR/PM

This architecture allows the scheduling portal to provide fast, responsive scheduling while keeping your source system's data isolated and protected.

### Implementing a Store Backend

To integrate with your preferred storage system, implement the `FhirStore` interface:

```ts
interface FhirStore {
  getSlots(query: FhirSlotQuery): Promise<Slot[]>;
  createSlot(slot: Slot): Promise<Slot>;
  getSchedules(query: FhirScheduleQuery): Promise<Schedule[]>;
  createSchedule(schedule: Schedule): Promise<Schedule>;
  createAppointment(appt: Appointment): Promise<Appointment>;
}
```

Backend modules are located in `/src/store/`:

* `mongoStore.ts` - Example for your mongoDB as your backend
* `postgresStore.ts` - for postgres
* `mysqlStore.ts` - MariaDB and MySQL example
* `mssqlStore.ts` - Microsoft SQL Server
* `simulator.ts` - a Simulator showing specific results for testing with an in-memory backend (no persistance) and examples initiated at launch.

Use the `.env` file to select your backend (defaults to simulator):

```env
STORE_BACKEND=postgres
```

---

## 🔄 HL7v2 Message Ingest

Send HL7v2 scheduling messages (e.g., `SIU^S12`, `S13`, `S15`) to:

```
POST /hl7/siu
```

**Option 1: Raw HL7 text** (Content-Type: `text/plain` or `x-application/hl7-v2+er7`)
```
MSH|^~\&|LEGACY_EHR|MAIN_HOSPITAL|FHIRTOGETHER|SCHEDULING_GATEWAY|20231209120000||SIU^S12|12345|P|2.3
SCH|10001^10001|10001^10001|||10001|OFFICE^Office visit|reason|OFFICE|30|m|...
PID|1||42||DOE^JOHN||19800101|M|||123 Main St^^City^ST^12345||5551234567
...
```

**Option 2: JSON wrapper** (Content-Type: `application/json`)
```json
{
  "message": "MSH|^~\\&|SCHED|...<raw HL7v2>",
  "wrapMLLP": false
}
```

**Response for text requests:** Raw HL7 ACK message
```
MSH|^~\&|FHIRTOGETHER|SCHEDULING_GATEWAY|LEGACY_EHR|MAIN_HOSPITAL|20231209120001||ACK^S12|ACK12345|P|2.3
MSA|AA|12345|Message processed successfully
```

**Response for JSON requests:** JSON-wrapped ACK
```json
{
  "message": "MSH|^~\\&|FHIRTOGETHER|SCHEDULING_GATEWAY|...\rMSA|AA|12345|Message processed successfully|||"
}
```

**ACK Codes:**
- `AA` (Application Accepted) - Message processed successfully
- `AR` (Application Rejected) - Message format error, do not retry
- `AE` (Application Error) - Processing failure, can retry

The server parses the message and converts it into FHIR `Slot` and `Schedule` resources internally.

## 📦 API Endpoints

FHIR-compliant endpoints (all responses follow FHIR Bundles or resource schemas):

| Method | Path             | Description                      |
| ------ | ---------------- | -------------------------------- |
| GET    | `/Slot`          | Search for free/busy slots       |
| POST   | `/Slot`          | Block a time slot                |
| GET    | `/Schedule`      | Retrieve provider availability   |
| POST   | `/Schedule`      | Define provider planning horizon |
| POST   | `/Appointment`   | Book an appointment              |
| POST   | `/hl7/siu`       | Ingest HL7v2 SIU message (text or JSON) |

## 🧪 Test Server Mode

Endpoints also support administrative operations (in test mode only):

* `DELETE /Slot`
* `DELETE /Schedule`
* `POST /$simulate-week` — generate random provider availability

## 🔐 Auth (Optional)

FHIR-style bearer token authentication is planned. You can stub in simple token-based headers using the `authPlugin`.

## 📄 License

MIT

## 🤝 Contributing

If you're modernizing a legacy EHR or want to contribute HL7v2 mappings, backend drivers, or scheduler logic — PRs welcome!

## 🧭 Roadmap

* [ ] Implement an optional no-login scheduling portal for browsing schedules and booking like https://cal.com/ or Calend.ly.
* [ ] Add login/authentication support for admins
* [ ] Implement google/microsoft/apple login for the scheduling portal for end users
* [ ] Implement the ability for an admin to define custom appointment types with different durations and constraints
  - [ ] Admin UI for managing providers, appointment types, and schedules
  - [ ] Implement yaml import/export for schedule definitions including API to update
  
* [ ] FHIR Subscription support for appointment updates
* [ ] Add SMART-on-FHIR / OAuth support - review https://github.com/mieweb/poc-auth-architecture 
* [ ] `$find-appointment` operation
* [ ] HL7v2 SRM^S03 request/response handling
* [ ] FHIR Bulk Export for schedules

---

## 🛡️ Project Goal

> Bring legacy scheduling infrastructure into the FHIR world — one appointment at a time.

