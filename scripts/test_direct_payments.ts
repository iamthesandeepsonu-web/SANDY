import { initDatabase } from '../src/database/db.js';
import { userRepo } from '../src/database/repositories/userRepo.js';
import { serviceRepo } from '../src/database/repositories/serviceRepo.js';
import { validityRepo } from '../src/database/repositories/validityRepo.js';
import { paymentRepo } from '../src/database/repositories/paymentRepo.js';
import { orderRepo } from '../src/database/repositories/orderRepo.js';
import { fulfillmentService } from '../src/services/fulfillmentService.js';
import { upiService } from '../src/services/upiService.js';
import { binancePayService } from '../src/services/binancePayService.js';

async function testDirectPayments() {
  console.log('Testing direct payment creation and fulfillment...');
  initDatabase();

  const user = userRepo.upsertFromTelegram(999888777, 'testbuyer', 'Test Buyer');
  const services = serviceRepo.getAll(true);
  if (services.length === 0) throw new Error('No services found');

  const srv = services[0];
  const validities = validityRepo.getByServiceId(srv.id, true);
  if (validities.length === 0) throw new Error('No validities found');

  const val = validities[0];
  console.log(`Testing Product: ${srv.name} (${val.name}) - Price: ₹${val.price}`);

  const { licenseRepo } = await import('../src/database/repositories/licenseRepo.js');
  licenseRepo.addBulk(srv.id, val.id, 'APPLE-1D-TEST-KEY-' + Date.now());

  // Test 1: Direct UPI QR Generation
  const refIdUpi = 'UPI_TEST_' + Date.now();
  const upiQr = await upiService.generateUpiQr(val.price, refIdUpi);
  console.log('UPI QR generated successfully:', Boolean(upiQr.qrBuffer));

  const upiPayment = paymentRepo.create({
    userId: user.id,
    telegramId: user.telegram_id,
    paymentMethod: 'UPI_AUTO',
    amount: val.price,
    referenceId: refIdUpi,
    qrPayload: upiQr.payload,
    metadata: {
      serviceId: srv.id,
      validityId: val.id,
      productName: srv.name,
      validityName: val.name
    }
  });
  console.log('UPI Payment Record created:', upiPayment.id, upiPayment.status);

  // Test 2: Direct Binance Payload Generation
  const refIdBin = 'BIN_TEST_' + Date.now();
  const binPayload = await binancePayService.generateOrderPayload(val.price, 5.0, refIdBin);
  console.log('Binance Payload generated successfully:', Boolean(binPayload.bep20Address));

  const binPayment = paymentRepo.create({
    userId: user.id,
    telegramId: user.telegram_id,
    paymentMethod: 'BINANCE_PAY',
    amount: val.price,
    referenceId: refIdBin,
    qrPayload: binPayload.checkoutUrl || binPayload.prepayId,
    metadata: {
      serviceId: srv.id,
      validityId: val.id,
      productName: srv.name,
      validityName: val.name
    }
  });
  console.log('Binance Payment Record created:', binPayment.id, binPayment.status);

  // Test 3: Complete UPI Payment & Fulfill Order
  const compResult = paymentRepo.completePayment(upiPayment.id, 'UTR_123456');
  console.log('Payment marked complete, user balance topped up');

  // Trigger fulfillment
  const meta = JSON.parse(upiPayment.metadata || '{}');
  const fulfillment = await fulfillmentService.processPurchase(upiPayment.user_id, meta.serviceId, meta.validityId);
  console.log('Fulfillment result:', fulfillment.success, 'Error:', fulfillment.errorCode, fulfillment.errorMessage, 'Key:', fulfillment.licenseKey, 'Order ID:', fulfillment.order?.id);

  if (!fulfillment.success || !fulfillment.licenseKey) {
    throw new Error('Fulfillment failed!');
  }

  // Verify order in database
  const savedOrder = orderRepo.getById(fulfillment.order!.id);
  console.log('Saved order in DB:', savedOrder?.id, 'License Key:', savedOrder?.license_key);

  console.log('✅ Direct Payment & Fulfillment test passed 100%!');
}

testDirectPayments().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
