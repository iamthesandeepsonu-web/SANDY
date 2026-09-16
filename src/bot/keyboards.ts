import { InlineKeyboard } from 'grammy';
import { Service } from '../database/repositories/serviceRepo.js';
import { ValidityWithStock } from '../database/repositories/validityRepo.js';

export const keyboards = {
  mainMenu(): InlineKeyboard {
    return new InlineKeyboard()
      .text('🛒 Shop Now', 'menu_shop')
      .text('📦 My Orders', 'menu_orders')
      .row()
      .text('👤 Profile', 'menu_profile')
      .text('💰 Add Balance', 'menu_wallet')
      .row()
      .text('🎧 Support', 'menu_support');
  },

  backToMain(): InlineKeyboard {
    return new InlineKeyboard().text('← Back to Main Menu', 'menu_main');
  },

  // 1. Vertical Product Display: One product directly below another
  servicesList(services: Service[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const srv of services) {
      kb.text(`✨ ${srv.name}`, `shop_srv::${srv.id}`).row();
    }
    kb.text('← Back to Main Menu', 'menu_main');
    return kb;
  },

  // 2. Customer-Facing Validity Display: Shows ONLY Validity + INR Price + USD Price
  // Zero API / technical terminology, zero stock badges on button labels
  validitiesList(serviceId: string, validities: ValidityWithStock[], usdRate = 83.0): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const val of validities) {
      const usdPrice = usdRate > 0 ? (val.price / usdRate).toFixed(2) : '0.00';
      kb.text(`${val.name} | ₹${val.price} | $${usdPrice}`, `shop_val::${serviceId}::${val.id}`).row();
    }
    kb.text('← Back to Services', 'menu_shop');
    return kb;
  },

  // Payment Gateway Options after live stock confirmation:
  // - UPI Payment Gateway
  // - Binance Pay Gateway
  // - Wallet Balance (if available)
  shopPaymentOptions(serviceId: string, validityId: string, priceInr: number, priceUsd: number, userBalance: number): InlineKeyboard {
    const kb = new InlineKeyboard();
    
    // Gateway 1: UPI Auto / QR
    kb.text(`⚡ Pay with UPI — ₹${priceInr.toFixed(2)}`, `pay_direct_upi::${serviceId}::${validityId}`).row();

    // Gateway 2: Binance Pay / USDT
    kb.text(`🟡 Pay with Binance Pay — $${priceUsd.toFixed(2)} USDT`, `pay_direct_binance::${serviceId}::${validityId}`).row();

    // Optional: If user has sufficient wallet credits
    if (userBalance >= priceInr) {
      kb.text(`💳 Pay with Wallet Balance (₹${userBalance.toFixed(2)})`, `pay_inr::${serviceId}::${validityId}`).row();
    }

    kb.text('← Back to Validities', `shop_srv::${serviceId}`);
    return kb;
  },

  purchaseConfirm(serviceId: string, validityId: string, priceInr: number, priceUsd: number, userBalance: number): InlineKeyboard {
    return this.shopPaymentOptions(serviceId, validityId, priceInr, priceUsd, userBalance);
  },

  backToValidities(serviceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('← Back to Validities', `shop_srv::${serviceId}`)
      .row()
      .text('🛒 All Products', 'menu_shop');
  },

  walletPresets(): InlineKeyboard {
    return new InlineKeyboard()
      .text('₹100', 'wallet_preset_100')
      .text('₹250', 'wallet_preset_250')
      .text('₹450', 'wallet_preset_450')
      .row()
      .text('₹800', 'wallet_preset_800')
      .text('₹1500', 'wallet_preset_1500')
      .text('₹2500', 'wallet_preset_2500')
      .row()
      .text('✏️ Enter Custom Amount', 'wallet_custom_amount')
      .row()
      .text('← Back to Main Menu', 'menu_main');
  },

  paymentMethods(amount: number): InlineKeyboard {
    return new InlineKeyboard()
      .text(`⚡ Pay with UPI Auto — ₹${amount}`, `pay_method_upi_${amount}`).row()
      .text(`🟡 Pay with Binance Pay — ₹${amount}`, `pay_method_binance_${amount}`).row()
      .text('← Back to Amount Selection', 'menu_wallet');
  },

  paymentPendingActions(paymentId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('🔄 Check Payment Status', `pay_check_${paymentId}`).row()
      .text('← Back to Main Menu', 'menu_main');
  },

  ordersPagination(page: number, totalPages: number): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (page > 1) {
      kb.text('⬅️ Prev', `orders_page_${page - 1}`);
    }
    if (page < totalPages) {
      kb.text('Next ➡️', `orders_page_${page + 1}`);
    }
    kb.row().text('← Back to Main Menu', 'menu_main');
    return kb;
  }
};
