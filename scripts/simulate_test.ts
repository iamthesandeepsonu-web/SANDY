import { initDatabase, db, runTransaction } from '../src/database/db.js';
import { userRepo } from '../src/database/repositories/userRepo.js';
import { serviceRepo } from '../src/database/repositories/serviceRepo.js';
import { validityRepo } from '../src/database/repositories/validityRepo.js';
import { licenseRepo } from '../src/database/repositories/licenseRepo.js';
import { mappingRepo } from '../src/database/repositories/mappingRepo.js';
import { orderRepo } from '../src/database/repositories/orderRepo.js';
import { paymentRepo } from '../src/database/repositories/paymentRepo.js';
import { settingsRepo } from '../src/database/repositories/settingsRepo.js';
import { fulfillmentService } from '../src/services/fulfillmentService.js';
import { upiService } from '../src/services/upiService.js';
import { binancePayService } from '../src/services/binancePayService.js';
import { licenseApiService } from '../src/services/licenseApiService.js';
import { keyboards } from '../src/bot/keyboards.js';
import express from 'express';
import { mockLdRoutes } from '../src/api/routes/mockLdRoutes.js';
import http from 'http';

async function runSimulationTests() {
  console.log('🚀 Starting Comprehensive System Simulation Tests...\n');
  initDatabase();

  // Start internal mock server for the test runner on port 3000
  const app = express();
  app.use(express.json());
  app.use('/api/mock-ld', mockLdRoutes);
  const server = http.createServer(app);
  
  await new Promise<void>((resolve) => {
    server.listen(3000, () => resolve());
  });

  // Configure test LD endpoint to point to mock server
  settingsRepo.set('ld_api_endpoint', 'http://localhost:3000/api/mock-ld');
  settingsRepo.set('ld_api_token', 'test_mock_token');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${details ? '- ' + details : ''}`);
    }
  }

  try {
    // Setup temporary test fixture service
    serviceRepo.create('srv_apple', 'Apple', 'Premium Apple Digital License & VIP Pass', 1);
    validityRepo.create('srv_apple', '1 Day', 450, 'val_apple_1d', 1, 1);
    validityRepo.create('srv_apple', '7 Days', 800, 'val_apple_7d', 1, 2);
    validityRepo.create('srv_apple', '30 Days', 1850, 'val_apple_30d', 1, 3);
    mappingRepo.upsert('srv_apple', 'val_apple_7d', 'LD_PROD_APPLE_7D', 'External Provider: Apple 7 Days VIP');

    // TEST 1: User Registration & Wallet Crediting
    console.log('--- TEST 1: User & Wallet Management ---');
    const testTgId = 998000000 + Math.floor(Math.random() * 900000);
    const user = userRepo.upsertFromTelegram(testTgId, `testuser_${testTgId}`, 'Test Telegram User');
    assert(user.telegram_id === testTgId, 'User registration from Telegram');
    assert(user.balance === 0, 'Initial balance is 0.00');

    const creditedUser = userRepo.adjustBalance(user.id, 1000, 'TOPUP', 'Test initial wallet credit', `REF_INIT_${Date.now()}`);
    assert(creditedUser.balance === 1000, 'Wallet credited with ₹1000', `Balance: ${creditedUser.balance}`);

    // TEST 2: Services & Validities Structure
    console.log('\n--- TEST 2: Service & Validity Verification ---');
    const appleService = serviceRepo.getById('srv_apple');
    assert(Boolean(appleService && appleService.name === 'Apple'), 'Default service "Apple" seeded');

    const validities = validityRepo.getByServiceIdWithStock('srv_apple');
    assert(validities.length >= 2, 'Validities retrieved for Apple', `Count: ${validities.length}`);
    const val1d = validities.find(v => v.name === '1 Day');
    assert(Boolean(val1d && val1d.price === 450), 'Apple 1 Day price is ₹450');

    // TEST 3: Tier 1 Fulfillment (Local Stock)
    console.log('\n--- TEST 3: Tier 1 Local Stock Fulfillment ---');
    licenseRepo.addBulk('srv_apple', 'val_apple_1d', `APPLE-1D-PROD-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*9000+1000)}`);
    const initialLocalStock = licenseRepo.getAvailableCount('srv_apple', 'val_apple_1d');
    assert(initialLocalStock > 0, `Local stock available for Apple 1 Day (Count: ${initialLocalStock})`);

    const purchaseResult1 = await fulfillmentService.processPurchase(user.id, 'srv_apple', 'val_apple_1d');
    assert(purchaseResult1.success === true, 'Local stock purchase succeeded');
    assert(Boolean(purchaseResult1.licenseKey && purchaseResult1.licenseKey.startsWith('APPLE-1D')), `Valid local key delivered: ${purchaseResult1.licenseKey}`);
    assert(purchaseResult1.order?.fulfillment_type === 'LOCAL', 'Order marked fulfillment_type = LOCAL');

    const userAfterBuy1 = userRepo.getById(user.id)!;
    assert(userAfterBuy1.balance === 550, `Balance deducted correctly: ₹${userAfterBuy1.balance} (Expected 550)`);

    // TEST 4: Tier 2 Fulfillment (External LD API Fallback)
    console.log('\n--- TEST 4: Tier 2 External LD API Fallback Fulfillment ---');
    // For Apple 7 Days, local stock is 0, but mapped to external product 'LD_PROD_APPLE_7D'
    const val7d = validities.find(v => v.name === '7 Days')!;
    const mapping7d = mappingRepo.getByServiceAndValidity('srv_apple', val7d.id);
    assert(Boolean(mapping7d && mapping7d.external_product_id === 'LD_PROD_APPLE_7D'), 'External API mapping exists for Apple 7 Days');

    // Top up user balance to afford ₹800 (550 + 500 = 1050)
    userRepo.adjustBalance(user.id, 500, 'TOPUP', 'Topup for 7d purchase');
    const userBefore7d = userRepo.getById(user.id)!;
    assert(userBefore7d.balance === 1050, `User balance topped up to ₹${userBefore7d.balance}`);

    // Seed local backup licenses to test that backup stock is NOT touched when product is API mapped
    licenseRepo.addBulk('srv_apple', val7d.id, `BACKUP-KEY-${Date.now()}-1\nBACKUP-KEY-${Date.now()}-2`);
    const backupStockBefore = licenseRepo.getAvailableCount('srv_apple', val7d.id);
    assert(backupStockBefore >= 2, 'Backup local licenses present for test');

    const purchaseResult2 = await fulfillmentService.processPurchase(user.id, 'srv_apple', val7d.id);
    assert(purchaseResult2.success === true, 'Fallback to External LD API succeeded');
    assert(purchaseResult2.order?.fulfillment_type === 'API', 'Order marked fulfillment_type = API');
    assert(Boolean(purchaseResult2.licenseKey && purchaseResult2.licenseKey.includes('APPLE_7D')), `External key delivered: ${purchaseResult2.licenseKey}`);

    // Verify backup stock was NOT touched
    const backupStockAfter = licenseRepo.getAvailableCount('srv_apple', val7d.id);
    assert(backupStockAfter === backupStockBefore, `Backup local stock remained protected and untouched (Count: ${backupStockAfter})`);

    const userAfterBuy2 = userRepo.getById(user.id)!;
    assert(userAfterBuy2.balance === 250, `User balance deducted: ₹${userAfterBuy2.balance} (Expected 250)`);

    // TEST 5: Out of Stock & Safety Isolation
    console.log('\n--- TEST 5: Out of Stock & Safety Isolation ---');
    // Apple 30 Days has 0 local stock and NO API mapping
    const val30d = validities.find(v => v.name === '30 Days')!;
    userRepo.adjustBalance(user.id, 2000, 'TOPUP', 'Topup for 30d test');
    const userBeforeOOS = userRepo.getById(user.id)!;

    const purchaseResult3 = await fulfillmentService.processPurchase(user.id, 'srv_apple', val30d.id);
    assert(purchaseResult3.success === false, 'Unstocked & unmapped product correctly rejected');
    assert(purchaseResult3.errorCode === 'OUT_OF_STOCK', 'Error code is OUT_OF_STOCK');

    const userAfterOOS = userRepo.getById(user.id)!;
    assert(userAfterOOS.balance === userBeforeOOS.balance, `User balance untouched when product is Out of Stock: ₹${userAfterOOS.balance}`);

    // TEST 6: Payment Top-Up & UPI Auto Verification
    console.log('\n--- TEST 6: Payment System & Verification ---');
    const upiRef = 'UPI_TEST_' + Date.now();
    const upiQr = await upiService.generateUpiQr(450, upiRef);
    assert(upiQr.payload.includes('am=450.00'), 'UPI Payload contains correct amount');
    assert(upiQr.payload.includes(upiRef), 'UPI Payload contains reference ID');

    const paymentRecord = paymentRepo.create({
      userId: user.id,
      telegramId: user.telegram_id,
      paymentMethod: 'UPI_AUTO',
      amount: 450,
      referenceId: upiRef
    });
    assert(paymentRecord.status === 'PENDING', 'Payment record initialized as PENDING');

    // Verify payment completion
    const balanceBeforePayment = userRepo.getById(user.id)!.balance;
    const verifyResult = paymentRepo.completePayment(paymentRecord.id, 'BANK_UTR_998811');
    assert(verifyResult.payment.status === 'COMPLETED', 'Payment status updated to COMPLETED');
    assert(verifyResult.alreadyProcessed === false, 'Payment processed cleanly');

    const userAfterTopup = userRepo.getById(user.id)!;
    assert(userAfterTopup.balance === balanceBeforePayment + 450, `Wallet credited after verified payment: ₹${userAfterTopup.balance}`);

    // Test idempotency
    const duplicateVerify = paymentRepo.completePayment(paymentRecord.id);
    assert(duplicateVerify.alreadyProcessed === true, 'Duplicate payment webhook safely ignored (Idempotency check)');

    // TEST 7: Maintenance Mode Settings
    console.log('\n--- TEST 7: Maintenance Mode Settings ---');
    settingsRepo.set('maintenance_enabled', 'true');
    assert(settingsRepo.getBoolean('maintenance_enabled') === true, 'Maintenance mode enabled');
    settingsRepo.set('maintenance_enabled', 'false');
    assert(settingsRepo.getBoolean('maintenance_enabled') === false, 'Maintenance mode disabled');

    // TEST 8: USD Currency Conversion Rate
    console.log('\n--- TEST 8: Dynamic USD Conversion Rate ---');
    settingsRepo.set('usd_conversion_rate', '83.0');
    assert(settingsRepo.getUsdRate() === 83.0, 'USD rate set to 83.0');
    const calculatedUsd1 = settingsRepo.calculateUsd(700);
    assert(calculatedUsd1 === 8.43, `₹700 @ 83.0 rate = $${calculatedUsd1} (Expected 8.43)`);

    settingsRepo.set('usd_conversion_rate', '85.0');
    assert(settingsRepo.getUsdRate() === 85.0, 'USD rate updated to 85.0');
    const calculatedUsd2 = settingsRepo.calculateUsd(850);
    assert(calculatedUsd2 === 10.0, `₹850 @ 85.0 rate = $${calculatedUsd2} (Expected 10.00)`);
    settingsRepo.set('usd_conversion_rate', '83.0'); // reset to 83.0

    // TEST 9: Clean Vertical Keyboards & Customer Labels
    console.log('\n--- TEST 9: Clean Vertical Keyboards & UX Formatting ---');
    const allServices = serviceRepo.getAll(true);
    const servicesKb = keyboards.servicesList(allServices);
    // In GrammY inline keyboard, verify each service is in its own row
    assert(servicesKb.inline_keyboard.length === allServices.length + 1, 'Vertical product layout (Each product on its own line)');

    const validityKb = keyboards.validitiesList('srv_apple', validities, 83.0);
    const firstValButtonText = validityKb.inline_keyboard[0][0].text;
    assert(firstValButtonText.includes('1 Day | ₹450 | $5.42'), `Validity label format: "${firstValButtonText}"`);
    assert(!firstValButtonText.includes('API') && !firstValButtonText.includes('Stock') && !firstValButtonText.includes('Provider'), 'Zero technical/API/stock badges on customer validity label');

    // TEST 10: Live Provider Stock Verification Flow
    console.log('\n--- TEST 10: Live Provider Stock Check ---');
    const liveStockAvailable = await licenseApiService.checkStock('LD_PROD_APPLE_7D');
    assert(liveStockAvailable.success && liveStockAvailable.in_stock, 'Live stock check returns in_stock = true for available product');

    const liveStockOos = await licenseApiService.checkStock('LD_PROD_FREEFIRE_30D');
    assert(liveStockOos.in_stock === false, 'Live stock check returns in_stock = false for out-of-stock product');

    const liveStockNotFound = await licenseApiService.checkStock('INVALID_PID_9999');
    assert(!liveStockNotFound.success && liveStockNotFound.error_code === 'PRODUCT_NOT_FOUND', 'Live stock check returns exact error for non-existent product');

    console.log(`\n========================================`);
    console.log(`Simulation Test Summary: ${passed} / ${total} Tests Passed`);
    console.log(`========================================\n`);

    if (passed === total) {
      console.log('🎉 ALL TESTS PASSED WITH 100% SUCCESS!');
    } else {
      console.error('⚠️ Some tests failed.');
    }
  } finally {
    // Clean up temporary test fixtures
    try {
      db.exec(`
        DELETE FROM api_mappings WHERE service_id = 'srv_apple';
        DELETE FROM licenses WHERE service_id = 'srv_apple';
        DELETE FROM validities WHERE service_id = 'srv_apple';
        DELETE FROM services WHERE id = 'srv_apple';
      `);
    } catch {}
    server.close();
  }

  if (passed !== total) {
    process.exit(1);
  }
}

runSimulationTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
