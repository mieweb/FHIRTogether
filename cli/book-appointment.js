#!/usr/bin/env node

/**
 * FHIRTogether CLI - Book an appointment
 */

const https = require('http');
const { URL } = require('url');

const BASE_URL = process.env.FHIR_BASE_URL || 'http://localhost:3000';

async function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const result = {
            status: res.statusCode,
            data: JSON.parse(responseData)
          };
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function bookAppointment(slotId, patientId, reasonCode, description) {
  console.log('📅 Booking appointment...\n');
  
  try {
    // First, verify the slot exists and is available
    const slotUrl = `${BASE_URL}/Slot/${slotId}`;
    const slotResponse = await makeRequest(slotUrl);
    
    if (slotResponse.status !== 200) {
      console.error('❌ Slot not found');
      return null;
    }
    
    const slot = slotResponse.data;
    
    if (slot.status !== 'free') {
      console.error(`❌ Slot is not available (status: ${slot.status})`);
      return null;
    }
    
    console.log(`✅ Slot found: ${new Date(slot.start).toLocaleString()} - ${new Date(slot.end).toLocaleString()}`);
    
    // Create appointment
    const appointment = {
      resourceType: 'Appointment',
      status: 'booked',
      serviceType: slot.serviceType,
      specialty: slot.specialty,
      description: description || 'Appointment booked via CLI',
      slot: [{
        reference: `Slot/${slotId}`
      }],
      participant: [
        {
          actor: {
            reference: `Patient/${patientId}`,
            display: `Patient ${patientId}`
          },
          required: 'required',
          status: 'accepted'
        }
      ]
    };
    
    if (reasonCode) {
      appointment.reasonCode = [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/appointment-reason',
          code: reasonCode,
          display: reasonCode
        }]
      }];
    }
    
    const appointmentUrl = `${BASE_URL}/Appointment`;
    const appointmentResponse = await makeRequest(appointmentUrl, 'POST', appointment);
    
    if (appointmentResponse.status === 201) {
      const createdAppointment = appointmentResponse.data;
      console.log(`✅ Appointment booked successfully!`);
      console.log(`   📋 Appointment ID: ${createdAppointment.id}`);
      console.log(`   🕐 Time: ${new Date(slot.start).toLocaleString()} - ${new Date(slot.end).toLocaleString()}`);
      console.log(`   👤 Patient: ${patientId}`);
      console.log(`   🏥 Service: ${slot.serviceType?.[0]?.coding?.[0]?.display || 'Unknown'}`);
      
      if (description) {
        console.log(`   📝 Description: ${description}`);
      }
      
      return createdAppointment;
    } else {
      console.error('❌ Failed to book appointment:', appointmentResponse.data);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error booking appointment:', error.message);
    return null;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const slotId = args.find(arg => arg.startsWith('--slot='))?.split('=')[1];
const patientId = args.find(arg => arg.startsWith('--patient='))?.split('=')[1];
const reasonCode = args.find(arg => arg.startsWith('--reason='))?.split('=')[1];
const description = args.find(arg => arg.startsWith('--description='))?.split('=')[1];

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
FHIRTogether CLI - Book Appointment

Usage: node book-appointment.js --slot=SLOT_ID --patient=PATIENT_ID [options]

Required:
  --slot=ID         Slot ID to book
  --patient=ID      Patient ID

Options:
  --reason=CODE     Reason code for appointment
  --description=TXT Description for appointment
  --help, -h        Show this help message

Examples:
  node book-appointment.js --slot=slot-123 --patient=patient-456
  node book-appointment.js --slot=slot-123 --patient=patient-456 --reason=routine --description="Annual checkup"
`);
  process.exit(0);
}

if (!slotId || !patientId) {
  console.error('❌ Missing required parameters. Use --help for usage information.');
  process.exit(1);
}

// Book the appointment
bookAppointment(slotId, patientId, reasonCode, description).catch(console.error);