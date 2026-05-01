# Use Node.js 22 as the base image (Vite requires 20.19+ or 22.12+)
FROM node:22

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json for root
COPY package.json package-lock.json ./

# Copy package.json for fhir-scheduler
COPY packages/fhir-scheduler/package.json packages/fhir-scheduler/package-lock.json* ./packages/fhir-scheduler/

# Install dependencies for root
RUN npm install

# Install dependencies for fhir-scheduler
WORKDIR /app/packages/fhir-scheduler
RUN npm install

# Go back to root
WORKDIR /app

# Copy the rest of the application code
COPY . .

# Build the fhir-scheduler standalone bundle
WORKDIR /app/packages/fhir-scheduler
RUN npm run build:standalone

# Go back to root
WORKDIR /app

# Expose the application port
EXPOSE 4010

# Set the default command to run the application
ENV NODE_ENV=production
CMD ["node", "packages/fhir-scheduler/dist/server.js"]
