# FHIRTogether CLI Tools and Examples

This directory contains command-line tools and examples for interacting with the FHIRTogether Scheduling Synapse server.

## CLI Tools

### search-slots.js
Search for available appointment slots by service type and date range.

```bash
# Search for EKG appointments
node cli/search-slots.js --service=EKG

# Search for X-Ray appointments
node cli/search-slots.js --service="X-Ray"

# Search with date range
node cli/search-slots.js --start=2024-01-01T09:00:00Z --end=2024-01-02T17:00:00Z

# Get help
node cli/search-slots.js --help
```

**Service Type Examples:**
- `EKG` or `722` - EKG/ECG testing
- `X-Ray` or `708` - X-Ray imaging  
- `124` - General Practice visits
- `Physical` - Physical examinations

### book-appointment.js
Book an appointment for a specific slot and patient.

```bash
# Book an appointment
node cli/book-appointment.js --slot=slot-ekg-room-1-1643724000000 --patient=patient-123

# Book with reason and description
node cli/book-appointment.js \
  --slot=slot-ekg-room-1-1643724000000 \
  --patient=patient-123 \
  --reason=routine \
  --description="Annual EKG screening"

# Get help
node cli/book-appointment.js --help
```

## Examples

### demo.sh
Complete workflow demonstration showing:
1. Search for available EKG slots
2. Book the first available slot
3. Search again to verify the slot is no longer available
4. Confirm the appointment was created
5. Show other available service types

```bash
# Run the demo (server must be running)
./examples/demo.sh
```

## Configuration

Set the base URL for the FHIR server:
```bash
export FHIR_BASE_URL=http://localhost:3000
```

## Example Workflow

Here's a typical workflow for searching and booking appointments:

```bash
# 1. Start the server
npm run dev

# 2. Search for available slots
node cli/search-slots.js --service=EKG

# 3. Book an appointment (use a slot ID from step 2)
node cli/book-appointment.js --slot=slot-schedule-ekg-1643724000000 --patient=patient-john-doe

# 4. Search again to see the slot is no longer available
node cli/search-slots.js --service=EKG

# 5. Verify appointment was created
curl http://localhost:3000/Appointment?patient=patient-john-doe
```

## Return Values

### search-slots.js
Returns available slots grouped by service type:
- Slot ID
- Start/end times
- Service type information

### book-appointment.js  
Returns booking confirmation:
- Appointment ID
- Scheduled time
- Patient information
- Service details

Both tools provide detailed console output and exit codes for automation.