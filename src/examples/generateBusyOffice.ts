/**
 * Data Generator for Busy Medical Office
 * 
 * Generates realistic test data:
 * - 3 providers (Dr. Smith, Dr. Johnson, Dr. Williams)
 * - Each seeing 50-60 patients per day
 * - 180 days (6 months) of future appointments
 * - Realistic scheduling patterns (8am-5pm, 15-30 min slots)
 */

import { SqliteStore } from '../store/sqliteStore';
import { Schedule, Slot, Appointment } from '../types/fhir';

interface Provider {
  id: string;
  name: string;
  specialty: string;
  location: string;
  avgAppointmentLength: number; // minutes
  startHour: number;
  endHour: number;
  daysPerWeek: number[];
}

const PROVIDERS: Provider[] = [
  {
    id: 'practitioner-smith',
    name: 'Dr. Sarah Smith',
    specialty: 'Family Medicine',
    location: 'Main Clinic - Room 101',
    avgAppointmentLength: 20,
    startHour: 8,
    endHour: 17,
    daysPerWeek: [1, 2, 3, 4, 5], // Mon-Fri
  },
  {
    id: 'practitioner-johnson',
    name: 'Dr. Michael Johnson',
    specialty: 'Internal Medicine',
    location: 'East Wing - Room 204',
    avgAppointmentLength: 25,
    startHour: 9,
    endHour: 18,
    daysPerWeek: [1, 2, 3, 4, 5], // Mon-Fri
  },
  {
    id: 'practitioner-williams',
    name: 'Dr. Emily Williams',
    specialty: 'Pediatrics',
    location: 'Pediatric Center - Room 305',
    avgAppointmentLength: 15,
    startHour: 8,
    endHour: 16,
    daysPerWeek: [1, 2, 3, 4, 5], // Mon-Fri
  },
];

const PATIENT_NAMES = [
  'Alice Anderson', 'Bob Brown', 'Carol Clark', 'David Davis',
  'Emma Evans', 'Frank Foster', 'Grace Green', 'Henry Harris',
  'Isabella Isaac', 'Jack Jackson', 'Karen King', 'Leo Lewis',
  'Maria Martin', 'Nathan Nelson', 'Olivia Oliver', 'Paul Parker',
  'Quinn Queen', 'Rachel Robinson', 'Sam Smith', 'Tina Taylor',
  'Uma Underwood', 'Victor Vincent', 'Wendy White', 'Xavier Xing',
  'Yara Young', 'Zachary Zhang', 'Amy Adams', 'Ben Baker',
  'Chloe Carter', 'Dylan Dixon', 'Ella Edwards', 'Felix Ford',
  'Gina Garcia', 'Hugo Hughes', 'Iris Irving', 'Jake Jordan',
  'Kate Kelly', 'Liam Lopez', 'Mia Moore', 'Noah Nelson',
  'Oscar Owens', 'Penny Perry', 'Quincy Quinn', 'Rose Reed',
  'Sean Scott', 'Tara Thomas', 'Ulysses Upton', 'Vera Vaughn',
  'Will Wilson', 'Xena Xu', 'Yvonne Yang', 'Zoe Zimmerman',
];

const APPOINTMENT_REASONS = [
  'Annual Physical',
  'Follow-up Visit',
  'New Patient Visit',
  'Sick Visit',
  'Preventive Care',
  'Chronic Disease Management',
  'Vaccination',
  'Lab Review',
  'Medication Management',
  'Health Screening',
];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function setTime(date: Date, hours: number, minutes: number): Date {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Format a Date as a naive ISO 8601 string without timezone suffix.
 * e.g. "2026-02-17T08:00:00"
 *
 * Stored datetimes are treated as local wall-clock time.
 * 8:00 AM means 8:00 AM regardless of server/client timezone.
 */
function toNaiveISO(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function isDayInSchedule(date: Date, daysPerWeek: number[]): boolean {
  return daysPerWeek.includes(date.getDay());
}

async function generateSchedulesAndSlots(store: SqliteStore, daysAhead: number = 180) {
  console.log('🏥 Generating schedules and slots for providers...');
  
  const today = new Date();
  const endDate = addDays(today, daysAhead);

  const scheduleIds: { [providerId: string]: string } = {};

  for (const provider of PROVIDERS) {
    // Create schedule for provider
    const schedule: Schedule = {
      resourceType: 'Schedule',
      active: true,
      actor: [
        {
          reference: `Practitioner/${provider.id}`,
          display: provider.name,
        },
      ],
      serviceType: [
        {
          text: provider.specialty,
        },
      ],
      planningHorizon: {
        start: toNaiveISO(today),
        end: toNaiveISO(endDate),
      },
      comment: `Schedule for ${provider.name}`,
    };

    const createdSchedule = await store.createSchedule(schedule);
    scheduleIds[provider.id] = createdSchedule.id!;
    console.log(`  ✓ Created schedule for ${provider.name}`);

    // Generate slots for each day
    let slotCount = 0;
    for (let d = 0; d < daysAhead; d++) {
      const currentDate = addDays(today, d);
      
      if (!isDayInSchedule(currentDate, provider.daysPerWeek)) {
        continue;
      }

      // Create slots throughout the day
      let currentTime = setTime(currentDate, provider.startHour, 0);
      const endTime = setTime(currentDate, provider.endHour, 0);

      while (currentTime < endTime) {
        const slotEnd = new Date(currentTime.getTime() + provider.avgAppointmentLength * 60000);
        
        if (slotEnd > endTime) break;

        const slot: Slot = {
          resourceType: 'Slot',
          schedule: {
            reference: `Schedule/${createdSchedule.id}`,
            display: provider.name,
          },
          status: 'free',
          start: toNaiveISO(currentTime),
          end: toNaiveISO(slotEnd),
          serviceType: [
            {
              text: provider.specialty,
            },
          ],
        };

        await store.createSlot(slot);
        slotCount++;
        currentTime = slotEnd;
      }
    }
    
    console.log(`  ✓ Created ${slotCount} slots for ${provider.name}`);
  }

  return scheduleIds;
}

async function generateAppointments(store: SqliteStore, scheduleIds: { [key: string]: string }, fillRate: number = 0.75) {
  console.log(`\n📅 Generating appointments (${fillRate * 100}% fill rate)...`);
  
  let appointmentCount = 0;
  const patientIds = new Set<string>();

  for (const provider of PROVIDERS) {
    const scheduleId = scheduleIds[provider.id];
    
    // Get all free slots for this provider
    const allSlots = await store.getSlots({
      schedule: `Schedule/${scheduleId}`,
      status: 'free',
    });

    // Shuffle slots to distribute appointments evenly across all dates
    const shuffledSlots = [...allSlots].sort(() => Math.random() - 0.5);
    
    // Book appointments for a percentage of available slots
    const slotsToBook = Math.floor(allSlots.length * fillRate);
    const selectedSlots = shuffledSlots.slice(0, slotsToBook);

    for (const slot of selectedSlots) {
      // Generate patient
      const patientName = getRandomElement(PATIENT_NAMES);
      const patientId = `patient-${patientName.toLowerCase().replace(/\s+/g, '-')}-${getRandomInt(1000, 9999)}`;
      patientIds.add(patientId);

      const appointment: Appointment = {
        resourceType: 'Appointment',
        status: 'booked',
        description: getRandomElement(APPOINTMENT_REASONS),
        start: slot.start,
        end: slot.end,
        slot: [
          {
            reference: `Slot/${slot.id}`,
          },
        ],
        participant: [
          {
            actor: {
              reference: `Practitioner/${provider.id}`,
              display: provider.name,
            },
            status: 'accepted',
          },
          {
            actor: {
              reference: `Patient/${patientId}`,
              display: patientName,
            },
            status: 'accepted',
          },
          {
            actor: {
              reference: `Location/${provider.id.replace('practitioner-', 'location-')}`,
              display: provider.location,
            },
            status: 'accepted',
          },
        ],

      };

      await store.createAppointment(appointment);
      appointmentCount++;
    }

    console.log(`  ✓ Created ${selectedSlots.length} appointments for ${provider.name}`);
  }

  console.log(`\n✅ Total appointments created: ${appointmentCount}`);
  console.log(`✅ Unique patients: ${patientIds.size}`);
}

async function generateStatistics(store: SqliteStore) {
  console.log('\n📊 Database Statistics:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const schedules = await store.getSchedules({});
  const allSlots = await store.getSlots({});
  const freeSlots = await store.getSlots({ status: 'free' });
  const busySlots = await store.getSlots({ status: 'busy' });
  const appointments = await store.getAppointments({});

  console.log(`  Schedules:     ${schedules.length}`);
  console.log(`  Total Slots:   ${allSlots.length}`);
  console.log(`  Free Slots:    ${freeSlots.length}`);
  console.log(`  Busy Slots:    ${busySlots.length}`);
  console.log(`  Appointments:  ${appointments.length}`);
  console.log(`  Fill Rate:     ${((busySlots.length / allSlots.length) * 100).toFixed(1)}%`);
  
  // Calculate appointments per day
  const appointmentsPerProvider = Math.floor(appointments.length / PROVIDERS.length);
  const daysWithAppointments = 180 * 5 / 7; // Approx working days
  const avgPerDay = Math.floor(appointmentsPerProvider / daysWithAppointments);
  
  console.log(`  Avg per provider/day: ~${avgPerDay} appointments`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function main() {
  console.log('🚀 FHIRTogether Busy Office Data Generator\n');
  
  const dbPath = process.env.SQLITE_DB_PATH || './data/fhirtogether.db';
  const store = new SqliteStore(dbPath);
  
  try {
    await store.initialize();
    console.log('✓ Database initialized\n');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await store.deleteAllAppointments();
    await store.deleteAllSlots();
    await store.deleteAllSchedules();
    console.log('✓ Data cleared\n');

    // Store the generation date for dynamic date shifting
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    store.setGenerationDate(toNaiveISO(today));
    console.log(`📅 Generation date set to: ${toNaiveISO(today).split('T')[0]}`);
    console.log('   (Dates will auto-shift to stay relative to today)\n');

    // Generate schedules and slots (6 months ahead)
    const scheduleIds = await generateSchedulesAndSlots(store, 180);

    // Generate appointments (50% fill rate - leaves availability throughout)
    await generateAppointments(store, scheduleIds, 0.50);

    // Show statistics
    await generateStatistics(store);

    console.log('\n✨ Data generation complete!');
    console.log('\n💡 Start the server with: npm run dev');
    console.log('💡 View Swagger docs at: http://localhost:4010/docs');
    
  } catch (error) {
    console.error('❌ Error generating data:', error);
    process.exit(1);
  } finally {
    await store.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { generateSchedulesAndSlots, generateAppointments };
