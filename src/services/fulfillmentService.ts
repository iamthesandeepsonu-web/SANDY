import { runTransaction } from '../database/db.js';
import { userRepo } from '../database/repositories/userRepo.js';
import { serviceRepo } from '../database/repositories/serviceRepo.js';
import { validityRepo } from '../database/repositories/validityRepo.js';
import { licenseRepo } from '../database/repositories/licenseRepo.js';
import { mappingRepo } from '../database/repositories/mappingRepo.js';
import { orderRepo, Order } from '../database/repositories/orderRepo.js';
import { licenseApiService } from './licenseApiService.js';
import crypto from 'crypto';

export interface PurchaseResult {
  success: boolean;
  order?: Order;
  licenseKey?: string;
  errorCode?: 'INSUFFICIENT_BALANCE' | 'SERVICE_INACTIVE' | 'OUT_OF_STOCK' | 'SERVER_ERROR' | 'USER_BANNED';
  errorMessage?: string;
}

export const fulfillmentService = {
  async processPurchase(userId: string, serviceId: string, validityId: string): Promise<PurchaseResult> {
    const user = userRepo.getById(userId);
    if (!user) {
      return { success: false, errorCode: 'SERVER_ERROR', errorMessage: 'User profile not found.' };
    }

    if (user.is_banned) {
      return { success: false, errorCode: 'USER_BANNED', errorMessage: 'Your account is currently suspended. Please contact support.' };
    }

    const service = serviceRepo.getById(serviceId);
    if (!service || !service.is_active) {
      return { success: false, errorCode: 'SERVICE_INACTIVE', errorMessage: 'This service is currently unavailable.' };
    }

    const validity = validityRepo.getById(validityId);
    if (!validity || !validity.is_active || validity.service_id !== serviceId) {
      return { success: false, errorCode: 'SERVICE_INACTIVE', errorMessage: 'Selected validity option is not available.' };
    }

    if (user.balance < validity.price) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_BALANCE',
        errorMessage: `Insufficient balance. Price: ₹${validity.price}, Your balance: ₹${user.balance.toFixed(2)}`
      };
    }

    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    // STEP 1 & 2: Check Local Stock and attempt atomic claim
    const localStockCount = licenseRepo.getAvailableCount(serviceId, validityId);

    if (localStockCount > 0) {
      try {
        const order = runTransaction(() => {
          // 1. Deduct user balance
          userRepo.adjustBalance(
            userId,
            -validity.price,
            'PURCHASE',
            `Purchased ${service.name} (${validity.name})`,
            orderId
          );

          // 2. Lock & Claim 1 local key
          const claimedLicense = licenseRepo.claimOneLocalLicense(serviceId, validityId, userId, orderId);
          if (!claimedLicense) {
            throw new Error('LOCAL_STOCK_CONFLICT');
          }

          // 3. Create Order Record
          return orderRepo.create({
            id: orderId,
            user_id: userId,
            telegram_id: user.telegram_id,
            service_id: service.id,
            service_name: service.name,
            validity_id: validity.id,
            validity_name: validity.name,
            price_paid: validity.price,
            license_key: claimedLicense.license_key,
            fulfillment_type: 'LOCAL',
            api_tx_id: null,
            status: 'COMPLETED'
          });
        });

        return {
          success: true,
          order,
          licenseKey: order.license_key
        };
      } catch (err: any) {
        if (err.message !== 'LOCAL_STOCK_CONFLICT') {
          return { success: false, errorCode: 'SERVER_ERROR', errorMessage: 'Transaction error occurred. Please try again.' };
        }
        // If conflict happened, continue to external API fallback
      }
    }

    // STEP 3: Check External API Mapping for exact service_id + validity_id
    const mapping = mappingRepo.getByServiceAndValidity(serviceId, validityId);

    if (!mapping) {
      // No local stock and no external API mapping
      return {
        success: false,
        errorCode: 'OUT_OF_STOCK',
        errorMessage: 'Out of Stock'
      };
    }

    // STEP 4: External API Fulfillment
    // Safely deduct balance first in transaction
    try {
      userRepo.adjustBalance(
        userId,
        -validity.price,
        'PURCHASE',
        `Purchased ${service.name} (${validity.name}) via External API`,
        orderId
      );
    } catch (err) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_BALANCE',
        errorMessage: 'Insufficient balance for purchase.'
      };
    }

    // Call external LD API
    const apiResult = await licenseApiService.orderProduct(mapping.external_product_id, orderId);

    if (apiResult.success && apiResult.license_key) {
      // API succeeded: Record order and deliver
      const order = orderRepo.create({
        id: orderId,
        user_id: userId,
        telegram_id: user.telegram_id,
        service_id: service.id,
        service_name: service.name,
        validity_id: validity.id,
        validity_name: validity.name,
        price_paid: validity.price,
        license_key: apiResult.license_key,
        fulfillment_type: 'API',
        api_tx_id: apiResult.external_tx_id || null,
        status: 'COMPLETED'
      });

      return {
        success: true,
        order,
        licenseKey: apiResult.license_key
      };
    }

    // API returned failure: Rollback user balance immediately
    userRepo.adjustBalance(
      userId,
      validity.price,
      'REFUND',
      `Auto-refund for failed order ${orderId} (${apiResult.error_message || 'Provider issue'})`,
      orderId
    );

    if (apiResult.error_code === 'OUT_OF_STOCK') {
      return {
        success: false,
        errorCode: 'OUT_OF_STOCK',
        errorMessage: 'Out of Stock'
      };
    }

    return {
      success: false,
      errorCode: 'SERVER_ERROR',
      errorMessage: 'Server is not responding. Please try again later.'
    };
  }
};
