#!/usr/bin/env node

/**
 * FHIRTogether CLI - Search for available appointment slots
 */

const https = require('http');
const { URL } = require('url');

const BASE_URL = process.env.FHIR_BASE_URL || 'http://localhost:3000';

async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function searchSlots(serviceType, startDate, endDate) {
  console.log('🔍 Searching for available appointment slots...\n');
  
  const params = new URLSearchParams({
    status: 'free',
    _count: '50'
  });
  
  if (serviceType) {
    params.append('serviceType', serviceType);
  }
  
  if (startDate) {
    params.append('start', startDate);
  }
  
  if (endDate) {
    params.append('end', endDate);
  }

  try {
    const url = `${BASE_URL}/Slot?${params.toString()}`;
    const bundle = await makeRequest(url);
    
    if (!bundle.entry || bundle.entry.length === 0) {
      console.log('❌ No available slots found');
      return [];
    }

    console.log(`✅ Found ${bundle.total} available slots:\n`);
    
    const slots = bundle.entry.map(entry => entry.resource);
    
    // Group by service type
    const slotsByService = {};
    slots.forEach(slot => {
      const serviceCode = slot.serviceType?.[0]?.coding?.[0]?.code || 'unknown';
      const serviceName = slot.serviceType?.[0]?.coding?.[0]?.display || 'Unknown Service';
      
      if (!slotsByService[serviceCode]) {
        slotsByService[serviceCode] = {
          name: serviceName,
          slots: []
        };
      }
      
      slotsByService[serviceCode].slots.push(slot);
    });

    // Display results
    for (const [code, service] of Object.entries(slotsByService)) {
      console.log(`📋 ${service.name} (${service.slots.length} slots available):`);
      
      service.slots.slice(0, 5).forEach(slot => {
        const start = new Date(slot.start).toLocaleString();
        const end = new Date(slot.end).toLocaleString();
        console.log(`   • ${slot.id}: ${start} - ${end}`);
      });
      
      if (service.slots.length > 5) {
        console.log(`   ... and ${service.slots.length - 5} more slots`);
      }
      console.log('');
    }

    return slots;
  } catch (error) {
    console.error('❌ Error searching slots:', error.message);
    return [];
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const serviceType = args.find(arg => arg.startsWith('--service='))?.split('=')[1];
const startDate = args.find(arg => arg.startsWith('--start='))?.split('=')[1];
const endDate = args.find(arg => arg.startsWith('--end='))?.split('=')[1];

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
FHIRTogether CLI - Search Appointments

Usage: node search-slots.js [options]

Options:
  --service=TYPE    Filter by service type (e.g., EKG, X-Ray, Visit, Physical)
  --start=DATE      Start date/time (ISO format)
  --end=DATE        End date/time (ISO format)
  --help, -h        Show this help message

Examples:
  node search-slots.js --service=EKG
  node search-slots.js --service="X-Ray" --start=2024-01-01T09:00:00Z
  node search-slots.js --start=2024-01-01T00:00:00Z --end=2024-01-02T00:00:00Z
`);
  process.exit(0);
}

// Run the search
searchSlots(serviceType, startDate, endDate).catch(console.error);