#!/bin/bash

# FHIRTogether Demo Script
# Shows the complete workflow: search, book, search again

set -e

BASE_URL="http://localhost:3000"
PATIENT_ID="demo-patient-$(date +%s)"

echo "🚀 FHIRTogether Scheduling Demo"
echo "================================="
echo ""

echo "1️⃣  Initial Search - Looking for EKG appointments..."
echo "---------------------------------------------------"
node cli/search-slots.js --service=EKG
echo ""

echo "2️⃣  Getting first available EKG slot..."
echo "---------------------------------------"
SLOT_RESPONSE=$(curl -s "${BASE_URL}/Slot?status=free&serviceType=722&_count=1")
SLOT_ID=$(echo "$SLOT_RESPONSE" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (data.entry && data.entry.length > 0) {
  console.log(data.entry[0].resource.id);
} else {
  console.log('');
}
")

if [ -z "$SLOT_ID" ]; then
  echo "❌ No EKG slots available for booking"
  exit 1
fi

echo "✅ Found slot: $SLOT_ID"
echo ""

echo "3️⃣  Booking the appointment..."
echo "-----------------------------"
node cli/book-appointment.js --slot="$SLOT_ID" --patient="$PATIENT_ID" --reason="routine" --description="EKG screening appointment"
echo ""

echo "4️⃣  Search again to confirm slot is no longer available..."
echo "--------------------------------------------------------"
node cli/search-slots.js --service=EKG
echo ""

echo "5️⃣  Verifying appointment was created..."
echo "---------------------------------------"
APPOINTMENT_RESPONSE=$(curl -s "${BASE_URL}/Appointment?patient=$PATIENT_ID")
APPOINTMENT_COUNT=$(echo "$APPOINTMENT_RESPONSE" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(data.total || 0);
")

echo "✅ Patient $PATIENT_ID has $APPOINTMENT_COUNT appointment(s)"
echo ""

echo "6️⃣  Showing different service types available..."
echo "-----------------------------------------------"
echo "🔬 X-Ray appointments:"
node cli/search-slots.js --service=708 | head -10
echo ""

echo "👩‍⚕️ General Practice appointments:"
node cli/search-slots.js --service=124 | head -10
echo ""

echo "✅ Demo completed successfully!"
echo "==============================="
echo ""
echo "📋 Summary:"
echo "   • Searched for available EKG slots"
echo "   • Booked slot $SLOT_ID for patient $PATIENT_ID"
echo "   • Verified slot is no longer available"
echo "   • Confirmed appointment was created"
echo "   • Showed other available service types"