# FHIRTogether Busy Office Example

This directory contains a data generator that creates realistic test data for a busy medical office.

## Generated Data

The generator creates:

- **3 Providers**:
  - Dr. Sarah Smith (Family Medicine) - 20 min appointments, 8am-5pm
  - Dr. Michael Johnson (Internal Medicine) - 25 min appointments, 9am-6pm
  - Dr. Emily Williams (Pediatrics) - 15 min appointments, 8am-4pm

- **50-60 Appointments per Provider per Day** (average)
- **30 Days of Future Schedules**
- **~75% Fill Rate** (realistic busy office scenario)
- **Unique Patient Data** with realistic names and appointment reasons

## Usage

### Generate Fresh Data

```bash
npm run generate-data
```

This will:
1. Clear existing data
2. Create schedules for 3 providers
3. Generate time slots for 30 days
4. Book appointments at ~75% capacity
5. Display statistics

### Start the Server

```bash
npm run dev
```

Then visit:
- **API Docs**: http://localhost:4010/docs
- **Health Check**: http://localhost:4010/health

## Example Queries

### Find Free Slots for Dr. Smith
```bash
GET /Slot?schedule=Schedule/<id>&status=free&start=2025-12-10T00:00:00Z
```

### View All Schedules
```bash
GET /Schedule
```

### Check Today's Appointments
```bash
GET /Appointment?date=2025-12-09
```

### Book an Appointment
```bash
POST /Appointment
{
  "resourceType": "Appointment",
  "status": "booked",
  "description": "Annual Physical",
  "slot": [
    { "reference": "Slot/<slot-id>" }
  ],
  "participant": [
    {
      "actor": { "reference": "Patient/patient-123", "display": "John Doe" },
      "status": "accepted"
    }
  ]
}
```

## Data Regeneration

The data will become stale as dates pass. Simply run `npm run generate-data` again to regenerate fresh 30-day schedules starting from today.

## Statistics

After generation, you'll see output like:

```
📊 Database Statistics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Schedules:     3
  Total Slots:   2700
  Free Slots:    675
  Busy Slots:    2025
  Appointments:  2025
  Fill Rate:     75.0%
  Avg per provider/day: ~32 appointments
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

This represents a realistic busy medical practice!
