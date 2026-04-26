# SMART Scheduling Links Compatibility

FHIRTogether implements the [SMART Scheduling Links](https://github.com/smart-on-fhir/smart-scheduling-links/blob/master/specification.md) specification, enabling bulk publication of scheduling availability data for interoperability with the SMART Scheduling Links ecosystem.

## Quick Start

### 1. Enable `$bulk-publish` (enabled by default)

The SMART Scheduling Links feature is enabled by default. To disable it, set:

```env
SMART_SCHEDULING_ENABLED=false
```

### 2. Access the manifest

```bash
curl http://localhost:4010/\$bulk-publish
```

Response:

```json
{
  "transactionTime": "2026-04-26T12:00:00.000Z",
  "request": "http://localhost:4010/$bulk-publish",
  "output": [
    { "type": "Location", "url": "http://localhost:4010/$bulk-publish/locations.ndjson" },
    { "type": "Schedule", "url": "http://localhost:4010/$bulk-publish/schedules.ndjson" },
    { "type": "Slot",     "url": "http://localhost:4010/$bulk-publish/slots.ndjson" }
  ],
  "error": []
}
```

### 3. Fetch NDJSON files

```bash
# Locations
curl http://localhost:4010/\$bulk-publish/locations.ndjson

# Schedules
curl http://localhost:4010/\$bulk-publish/schedules.ndjson

# Slots (includes both free and busy)
curl http://localhost:4010/\$bulk-publish/slots.ndjson
```

### 4. Run Inferno tests

Point the [SMART Scheduling Links Inferno test suite](https://inferno.healthit.gov/suites/smart_scheduling_links) at your `$bulk-publish` URL:

```
https://your-server.example.com/$bulk-publish
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SMART_SCHEDULING_ENABLED` | `true` | Set to `false` to disable the `$bulk-publish` endpoint |
| `SMART_SCHEDULING_BASE_URL` | auto-detected | Base URL for manifest links (e.g., `https://api.example.com`) |
| `SMART_SCHEDULING_BOOKING_LINK_TEMPLATE` | — | Booking deep-link template. Use `{slotId}` as placeholder |
| `SMART_SCHEDULING_JURISDICTIONS` | — | Comma-separated state codes for manifest extensions (e.g., `MA,CT`) |

## Endpoints

| Method | Path | Content-Type | Description |
|---|---|---|---|
| GET | `/$bulk-publish` | `application/json` | Bulk Publication Manifest |
| GET | `/$bulk-publish/locations.ndjson` | `application/fhir+ndjson` | FHIR Location resources |
| GET | `/$bulk-publish/schedules.ndjson` | `application/fhir+ndjson` | FHIR Schedule resources |
| GET | `/$bulk-publish/slots.ndjson` | `application/fhir+ndjson` | FHIR Slot resources |

All endpoints are **public** (no authentication required) per the SMART Scheduling Links access control guidance.

## Architecture

```mermaid
graph LR
    Client[Slot Discovery Client] -->|GET| Manifest[/$bulk-publish]
    Manifest -->|links to| Locations[locations.ndjson]
    Manifest -->|links to| Schedules[schedules.ndjson]
    Manifest -->|links to| Slots[slots.ndjson]

    Locations -->|FHIR Location| DB[(FHIRTogether DB)]
    Schedules -->|FHIR Schedule| DB
    Slots -->|FHIR Slot| DB

    classDef endpoint fill:#e1f5fe,stroke:#0277bd
    classDef data fill:#fff3e0,stroke:#ef6c00
    classDef store fill:#e8f5e9,stroke:#2e7d32

    class Manifest,Locations,Schedules,Slots endpoint
    class Client data
    class DB store
```

FHIRTogether serves as both a **Slot Publisher** and a potential **compliance bridge** for systems that are not yet SMART Scheduling Links compliant. Data flows from HL7v2 SIU messages or REST API writes into the FHIRTogether database, and is then published via `$bulk-publish` in the SMART Scheduling Links format.

## Booking Deep Links

When `SMART_SCHEDULING_BOOKING_LINK_TEMPLATE` is configured, each Slot in the NDJSON output includes a booking deep-link extension:

```json
{
  "resourceType": "Slot",
  "id": "slot-123",
  "schedule": { "reference": "Schedule/sched-456" },
  "status": "free",
  "start": "2026-05-01T09:00:00Z",
  "end": "2026-05-01T09:30:00Z",
  "extension": [{
    "url": "http://fhir-registry.smarthealthit.org/StructureDefinition/booking-deep-link",
    "valueUrl": "https://example.com/book?slot=slot-123"
  }]
}
```

Clients can append `source` and `booking-referral` parameters per the specification.

## Jurisdiction Extensions

When `SMART_SCHEDULING_JURISDICTIONS` is set, the Slot output entry in the manifest includes a state extension to help clients filter by region:

```json
{
  "type": "Slot",
  "url": "https://example.com/$bulk-publish/slots.ndjson",
  "extension": { "state": ["MA", "CT"] }
}
```

## Spec Compliance

The implementation covers the following aspects of the SMART Scheduling Links specification:

- **Manifest endpoint** — `$bulk-publish` returns a conformant JSON manifest with `transactionTime`, `request`, `output[]`, and `error[]`
- **NDJSON output** — Location, Schedule, and Slot resources served as NDJSON with `application/fhir+ndjson` content type
- **Cache-Control headers** — All responses include `Cache-Control: max-age=300`
- **Slot fields** — Each slot includes `resourceType`, `id`, `schedule`, `status`, `start`, and `end`
- **Slot status normalization** — Non-standard FHIR statuses (e.g. `busy-tentative`) are mapped to `free` or `busy` per spec
- **Location telecom** — Every Location includes at least one `telecom` entry (URL fallback)
- **Booking deep-link extension** — Configurable per deployment
- **Jurisdiction extensions** — Configurable state filters applied to all output entries

### Inferno Test Suite Results

| Test | ID | Status | Notes |
|------|-----|--------|-------|
| Manifest URL form | 1.01 | Pass | URL ends in `$bulk-publish` |
| Manifest download | 1.02 | Pass | Returns 200 with valid JSON |
| Cache-Control header | opt | Pass | `max-age=300` |
| Manifest structure | 1.04 | Pass | All required fields present, correct types |
| State extensions | opt | Pass* | Requires `SMART_SCHEDULING_JURISDICTIONS` env var |
| Location resources | res | Pass** | See vaccine-specific gaps below |
| Schedule resources | res | Pass** | See vaccine-specific gaps below |
| Slot resources | res | Pass | All required fields, `free`/`busy` status only |

### Known Inferno Gaps (Vaccine-Specific Profiles)

The Inferno test suite validates resources against **vaccine-specific** FHIR profiles (`vaccine-location`, `vaccine-schedule`, `vaccine-slot`). FHIRTogether is a **general-purpose** scheduling system, so some vaccine-specific checks will not pass:

| Check | Profile Requirement | FHIRTogether Status |
|-------|-------------------|---------------------|
| VTrckS PIN identifier | `vaccine-location` requires at least one Location with a CDC VTrckS PIN | Not applicable — FHIRTogether is not vaccine-specific |
| COVID-19 service type | `vaccine-schedule` requires immunization + COVID-19 service type codings | Not applicable — Schedules use general service types |
| Location `identifier` | `vaccine-location` requires an `identifier` array | Locations do not include vaccine registry identifiers |

These are **not bugs** — they reflect the difference between a general scheduling platform and a vaccine-specific publisher. The core specification structural checks (manifest, NDJSON format, required FHIR fields) all pass.

## Automated Validation

Run the built-in Inferno-style validation against a running server:

```bash
# Start the server
npm start &

# Run validation (defaults to http://localhost:4010/$bulk-publish)
npm run validate-smart

# Or specify a custom URL
npx tsx src/examples/validateSmartScheduling.ts https://your-server.example.com/\$bulk-publish
```

The script checks:
- Manifest URL form, download, and JSON structure
- `transactionTime` format (FHIR instant)
- `Cache-Control` header presence
- All NDJSON files downloadable and parseable
- Resource-level field validation (type-specific checks)
- State extension presence (optional)

## Links

- [SMART Scheduling Links Specification](https://github.com/smart-on-fhir/smart-scheduling-links/blob/master/specification.md)
- [Inferno Test Suite](https://inferno.healthit.gov/suites/smart_scheduling_links)
- [FHIR Bulk Data `$bulk-publish`](http://build.fhir.org/ig/HL7/bulk-data/branches/bulk-publish/bulk-publish.html)
