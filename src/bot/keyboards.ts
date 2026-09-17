import { InlineKeyboard } from 'grammy';
import { Service } from '../database/repositories/serviceRepo.js';
import { ValidityWithStock } from '../database/repositories/validityRepo.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export const keyboards = {
  mainMenu(): InlineKeyboard {
    const supportLabel = settingsRepo.get('support_button_label', '🎧 Support');
    return new InlineKeyboard()
      .text('🛒 Shop Now', 'menu_shop')
      .text('📦 My Orders', 'menu_orders')
      .row()
      .text('👤 Profile', 'menu_profile')
      .text('💰 Add Balance', 'menu_wallet')
      .row()
      .text(supportLabel || '🎧 Support', 'menu_support');
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

  // 2. Customer-Facing Validity Display:
  // For Indian users: Validity ➔ ₹INR | $USD
  // For International users: Validity ➔ $USDT | ₹INR
  validitiesList(serviceId: string, validities: ValidityWithStock[], isIndia = true, usdRate = 83.0): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const val of validities) {
      const usdPrice = usdRate > 0 ? (val.price / usdRate).toFixed(2) : '0.00';
      if (isIndia) {
        kb.text(`${val.name} ➔ ₹${val.price} | $${usdPrice}`, `shop_val::${serviceId}::${val.id}`).row();
      } else {
        kb.text(`${val.name} ➔ $${usdPrice} USDT | ₹${val.price}`, `shop_val::${serviceId}::${val.id}`).row();
      }
    }
    kb.text('← Back to Services', 'menu_shop');
    return kb;
  },

  // Payment Gateway Options after live stock confirmation:
  // - Gateway 1 (UPI): ALWAYS ₹INR
  // - Gateway 2 (Binance): ALWAYS $USDT
  // - Gateway 3 (Wallet): Formatted in user's default currency
  shopPaymentOptions(serviceId: string, validityId: string, priceInr: number, priceUsd: number, userBalance: number, isIndia = true, usdRate = 83.0): InlineKeyboard {
    const kb = new InlineKeyboard();
    
    // Gateway 1: UPI Auto / QR (Always in INR)
    kb.text(`⚡ Pay with UPI — ₹${priceInr.toFixed(2)}`, `pay_direct_upi::${serviceId}::${validityId}`).row();

    // Gateway 2: Binance Pay / USDT (Always in USD/USDT)
    kb.text(`🟡 Pay with Binance Pay — $${priceUsd.toFixed(2)} USDT`, `pay_direct_binance::${serviceId}::${validityId}`).row();

    // Gateway 3: Pay with Wallet Balance
    const balanceText = isIndia
      ? `₹${userBalance.toFixed(2)}`
      : `$${usdRate > 0 ? (userBalance / usdRate).toFixed(2) : '0.00'} USDT`;
    kb.text(`💳 Pay with Wallet (Balance: ${balanceText})`, `pay_inr::${serviceId}::${validityId}`).row();

    kb.text('← Back to Validities', `shop_srv::${serviceId}`);
    return kb;
  },

  purchaseConfirm(serviceId: string, validityId: string, priceInr: number, priceUsd: number, userBalance: number, isIndia = true, usdRate = 83.0): InlineKeyboard {
    return this.shopPaymentOptions(serviceId, validityId, priceInr, priceUsd, userBalance, isIndia, usdRate);
  },

  backToValidities(serviceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('← Back to Validities', `shop_srv::${serviceId}`)
      .row()
      .text('🛒 All Products', 'menu_shop');
  },

  // Wallet Top-Up Presets:
  // Indian User => INR presets
  // Non-Indian User => USDT presets
  walletPresets(isIndia = true): InlineKeyboard {
    const kb = new InlineKeyboard();

    if (isIndia) {
      kb.text('₹100', 'wallet_preset_inr_100')
        .text('₹250', 'wallet_preset_inr_250')
        .text('₹450', 'wallet_preset_inr_450')
        .row()
        .text('₹800', 'wallet_preset_inr_800')
        .text('₹1500', 'wallet_preset_inr_1500')
        .text('₹2500', 'wallet_preset_inr_2500');
    } else {
      kb.text('$2 USDT', 'wallet_preset_usd_2')
        .text('$5 USDT', 'wallet_preset_usd_5')
        .text('$10 USDT', 'wallet_preset_usd_10')
        .row()
        .text('$25 USDT', 'wallet_preset_usd_25')
        .text('$50 USDT', 'wallet_preset_usd_50')
        .text('$100 USDT', 'wallet_preset_usd_100');
    }

    kb.row()
      .text('✏️ Enter Custom Amount', 'wallet_custom_amount')
      .row()
      .text('← Back to Main Menu', 'menu_main');
    return kb;
  },

  // Gateway Selection Screen:
  // Displays UPI in INR and Binance in USD/USDT
  paymentMethods(amountInr: number, amountUsd: number): InlineKeyboard {
    return new InlineKeyboard()
      .text(`⚡ Pay with UPI Auto — ₹${amountInr.toFixed(2)}`, `pay_method_upi_${amountInr}`).row()
      .text(`🟡 Pay with Binance Pay — $${amountUsd.toFixed(2)} USDT`, `pay_method_binance_${amountInr}`).row()
      .text('← Back to Amount Selection', 'menu_wallet');
  },

  paymentPendingActions(paymentId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('🔄 Check Payment Status', `pay_check_${paymentId}`).row()
      .text('← Back to Main Menu', 'menu_main');
  },

  binancePaymentActions(paymentId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('🔢 Enter Binance Order ID / Txn ID', `binance_enter_order_${paymentId}`).row()
      .text('🔄 Check Live Status', `pay_check_${paymentId}`).row()
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
