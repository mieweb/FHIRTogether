/**
 * Server Entry Point
 */

import buildApp from './app';

const start = async (): Promise<void> => {
  try {
    const app = await buildApp();
    
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    
    console.log(`🚀 FHIRTogether Scheduling Synapse started`);
    console.log(`📊 Server running at: http://${host}:${port}`);
    console.log(`📚 Swagger UI: http://${host}:${port}/docs`);
    console.log(`🏥 FHIR Metadata: http://${host}:${port}/metadata`);
    console.log(`❤️  Health Check: http://${host}:${port}/health`);
    console.log(`🗃️  Backend Store: ${process.env.STORE_BACKEND || 'simulator'}`);
    console.log(`🧪 Test Mode: ${process.env.ENABLE_TEST_MODE === 'true' ? 'Enabled' : 'Disabled'}`);
    
  } catch (err) {
    console.error('❌ Error starting server:', err);
    process.exit(1);
  }
};

start();