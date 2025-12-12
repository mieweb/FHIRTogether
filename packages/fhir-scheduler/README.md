# @mieweb/fhir-scheduler

A React component for browsing provider schedules and booking appointments, embeddable in any application.

<!-- Screenshots section auto-generated. See docs/README-SCREENSHOTS.md -->
<!-- Run: npx playwright test tests/screenshots.spec.ts to regenerate -->
## Screenshots

### Visit Type Selection
![Visit Type](docs/screenshots/00-visit-type.png)

### New Patient Intake Questionnaire
![Questionnaire](docs/screenshots/00b-questionnaire.png)

### Provider Selection
![Provider List](docs/screenshots/01-provider-list.png)

### Date Selection with Availability
![Date Selection](docs/screenshots/02-date-selection.png)

### Calendar View
![Calendar View](docs/screenshots/03-calendar-view.png)

### Time Slot Selection
![Time Slots](docs/screenshots/04-time-slots.png)

### Booking Form with Hold Timer
![Booking Form](docs/screenshots/05-booking-form.png)

### Completed Form
![Booking Filled](docs/screenshots/06-booking-filled.png)

### Confirmation
![Confirmation](docs/screenshots/07-confirmation.png)

### Mobile Responsive
| Provider List | Booking Form |
|---------------|--------------|
| ![Mobile Providers](docs/screenshots/08-mobile-provider-list.png) | ![Mobile Booking](docs/screenshots/09-mobile-booking.png) |

## Features

- 📅 Browse provider availability from any FHIR-compliant server
- 🔒 Slot hold/locking to prevent double-booking during checkout
- 📱 Responsive design for all screen sizes
- ⚛️ Available as React component or standalone Web Component
- 🎨 Clean, minimal styling that's easy to customize

## Installation

### React App

```bash
npm install @mieweb/fhir-scheduler
```

### Standalone (No React Required)

```html
<script type="module">
  import '@mieweb/fhir-scheduler/standalone';
</script>
```

## Usage

### React Component

```tsx
import { SchedulerWidget } from '@mieweb/fhir-scheduler';

function App() {
  const handleComplete = (appointment) => {
    console.log('Booked:', appointment);
  };

  return (
    <SchedulerWidget
      fhirBaseUrl="https://api.example.com/fhir"
      onComplete={handleComplete}
    />
  );
}
```

### Pre-selected Provider

```tsx
<SchedulerWidget
  fhirBaseUrl="https://api.example.com/fhir"
  providerId="Schedule/dr-smith-123"
  holdDurationMinutes={10}
  onComplete={handleComplete}
/>
```

### Web Component

```html
<fhir-scheduler
  fhir-base-url="https://api.example.com/fhir"
  hold-duration="10"
></fhir-scheduler>

<script type="module">
  import '@mieweb/fhir-scheduler/standalone';

  const scheduler = document.querySelector('fhir-scheduler');
  
  scheduler.addEventListener('complete', (e) => {
    console.log('Appointment booked:', e.detail);
  });

  scheduler.addEventListener('error', (e) => {
    console.error('Booking error:', e.detail);
  });
</script>
```

## Props / Attributes

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fhirBaseUrl` | `string` | *required* | Base URL of FHIR server |
| `providerId` | `string` | `undefined` | Pre-select a specific provider (skip provider list) |
| `questionnaireFormData` | `object` | `undefined` | Questionnaire schema for intake forms |
| `holdDurationMinutes` | `number` | `5` | How long to hold a slot during booking |
| `onComplete` | `(appt) => void` | `undefined` | Callback when booking succeeds |
| `onError` | `(error) => void` | `undefined` | Callback on booking failure |
| `className` | `string` | `''` | Additional CSS classes |

## Server Requirements

The FHIR server must support these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/Schedule?active=true` | List available providers |
| GET | `/Slot?schedule=...&status=free&start=...&end=...` | Get available slots |
| POST | `/Slot/:id/$hold` | Acquire hold on a slot |
| DELETE | `/Slot/:id/$hold/:token` | Release a hold |
| POST | `/Appointment` | Book an appointment |

### Slot Hold API

The slot hold mechanism prevents double-booking:

```typescript
// POST /Slot/slot-123/$hold
{
  "durationMinutes": 10,
  "sessionId": "client-uuid-abc123"
}

// Response
{
  "holdToken": "hold-xyz789",
  "slotId": "slot-123",
  "expiresAt": "2025-12-10T14:30:00Z",
  "status": "held"
}
```

## Component Flow

```
┌─────────────────┐
│  Provider List  │
│  (Select one)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Slot Calendar  │
│  (Pick a time)  │
└────────┬────────┘
         │ (Acquires hold)
         ▼
┌─────────────────┐
│  Booking Form   │
│  (Enter info)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Confirmation   │
│  (Success!)     │
└─────────────────┘
```

## Styling

All CSS classes use the `fs-` prefix to avoid conflicts. You can override styles:

```css
.fs-scheduler-widget {
  /* Widget container */
}

.fs-provider-card {
  /* Provider selection cards */
}

.fs-slot-button {
  /* Time slot buttons */
}

.fs-submit-button {
  /* Booking submit button */
}
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build library
npm run build

# Type check
npm run typecheck
```

## License

MIT — Part of the FHIRTogether project.
