# FHIRTogether Quick Start Guide

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Generate Sample Data

Create realistic test data for a busy medical office with 3 providers and 30 days of appointments:

```bash
npm run generate-data
```

You'll see output like:
```
🚀 FHIRTogether Busy Office Data Generator

✓ Database initialized

🗑️  Clearing existing data...
✓ Data cleared

🏥 Generating schedules and slots for providers...
  ✓ Created schedule for Dr. Sarah Smith
  ✓ Created 510 slots for Dr. Sarah Smith
  ✓ Created schedule for Dr. Michael Johnson
  ✓ Created 432 slots for Dr. Michael Johnson
  ✓ Created schedule for Dr. Emily Williams
  ✓ Created 480 slots for Dr. Emily Williams

📅 Generating appointments (75% fill rate)...
  ✓ Created 382 appointments for Dr. Sarah Smith
  ✓ Created 324 appointments for Dr. Michael Johnson
  ✓ Created 360 appointments for Dr. Emily Williams

✅ Total appointments created: 1066
✅ Unique patients: 1066

📊 Database Statistics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Schedules:     3
  Total Slots:   1422
  Free Slots:    356
  Busy Slots:    1066
  Appointments:  1066
  Fill Rate:     75.0%
  Avg per provider/day: ~17 appointments
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3. Start the Server

```bash
npm run dev
```

You'll see:
```
🚀 FHIRTogether Scheduling Synapse
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server running at: http://0.0.0.0:4010
📚 API Documentation: http://localhost:4010/docs
💾 Store Backend: sqlite
🧪 Test Endpoints: Enabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4. Explore the API

Open your browser to: **http://localhost:4010/docs**

## 📁 Project Structure

```
FHIRTogether/
├── src/
│   ├── types/
│   │   └── fhir.ts              # FHIR resource type definitions
│   ├── store/
│   │   └── sqliteStore.ts       # SQLite3 database implementation
│   ├── routes/
│   │   ├── scheduleRoutes.ts    # /Schedule endpoints
│   │   ├── slotRoutes.ts        # /Slot endpoints
│   │   └── appointmentRoutes.ts # /Appointment endpoints
│   ├── examples/
│   │   ├── generateBusyOffice.ts # Data generator script
│   │   └── README.md             # Example documentation
│   └── server.ts                 # Main server entry point
├── data/
│   └── fhirtogether.db          # Database file (auto-created)
├── package.json
├── tsconfig.json
├── .env                          # Environment configuration
└── README.md
```

## 🧪 Example API Calls

### Get All Schedules
```bash
curl http://localhost:4010/Schedule
```

### Find Free Slots for a Provider
```bash
# First, get schedules to find a schedule ID
curl http://localhost:4010/Schedule

# Then search for free slots
curl "http://localhost:4010/Slot?schedule=Schedule/<schedule-id>&status=free&_count=10"
```

### View Today's Appointments
```bash
curl "http://localhost:4010/Appointment?date=2025-12-09"
```

### Book an Appointment
```bash
curl -X POST http://localhost:4010/Appointment \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Appointment",
    "status": "booked",
    "description": "Annual Physical",
    "slot": [
      { "reference": "Slot/<slot-id>" }
    ],
    "participant": [
      {
        "actor": {
          "reference": "Patient/patient-new-123",
          "display": "Jane Doe"
        },
        "status": "accepted"
      }
    ]
  }'
```

### Create a New Slot
```bash
curl -X POST http://localhost:4010/Slot \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Slot",
    "schedule": {
      "reference": "Schedule/<schedule-id>"
    },
    "status": "free",
    "start": "2025-12-15T10:00:00Z",
    "end": "2025-12-15T10:30:00Z"
  }'
```

## 🔧 Configuration

Edit `.env` file to customize:

```env
# Backend Store Selection
STORE_BACKEND=sqlite

# Server Configuration
PORT=4010
HOST=0.0.0.0
LOG_LEVEL=info

# Database Configuration
SQLITE_DB_PATH=./data/fhirtogether.db

# Enable test/admin endpoints (DELETE operations)
ENABLE_TEST_ENDPOINTS=true
```

## 📊 Generated Test Data

The busy office example includes:

- **3 Providers**:
  - Dr. Sarah Smith (Family Medicine) - 20 min appointments
  - Dr. Michael Johnson (Internal Medicine) - 25 min appointments  
  - Dr. Emily Williams (Pediatrics) - 15 min appointments

- **Appointment Volume**: ~50-60 patients per provider per day
- **Time Range**: 30 days of future appointments
- **Fill Rate**: 75% (realistic busy office)
- **Operating Hours**: 8am-6pm, Monday-Friday

## 🔄 Regenerating Data

As dates pass, the test data becomes stale. Regenerate fresh data anytime:

```bash
npm run generate-data
```

This clears all existing data and creates a fresh 30-day schedule starting from today.

## 🛠️ Development

### Build for Production
```bash
npm run build
npm start
```

### Run Linter
```bash
npm run lint
```

## 📖 API Documentation

Full interactive API documentation with request/response examples is available at:

**http://localhost:4010/docs**

All endpoints follow FHIR R4 specifications for:
- `Schedule` resources
- `Slot` resources
- `Appointment` resources

## 🧩 Next Steps

- Implement additional backend stores (PostgreSQL, MySQL, MongoDB)
- Add HL7v2 message ingestion (`POST /$hl7v2-ingest`)
- Implement `$find-appointment` operation
- Add SMART-on-FHIR authentication
- Set up FHIR Subscription support

## 📄 License

MIT
