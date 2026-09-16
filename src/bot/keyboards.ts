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

  servicesList(services: Service[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (let i = 0; i < services.length; i++) {
      const srv = services[i];
      kb.text(`✨ ${srv.name}`, `shop_srv_${srv.id}`);
      if (i % 2 === 1) kb.row();
    }
    if (services.length % 2 !== 0) kb.row();
    kb.text('← Back to Main Menu', 'menu_main');
    return kb;
  },

  validitiesList(serviceId: string, validities: ValidityWithStock[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const val of validities) {
      const stockBadge = val.available_stock > 0 
        ? `(In Stock: ${val.available_stock})` 
        : (val.is_api_mapped ? '(Instant Auto-API)' : '(Out of Stock)');
      
      kb.text(`${val.name} — ₹${val.price} ${stockBadge}`, `shop_val_${serviceId}_${val.id}`).row();
    }
    kb.text('← Back to Services', 'menu_shop');
    return kb;
  },

  purchaseConfirm(serviceId: string, validityId: string, price: number, userBalance: number): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (userBalance >= price) {
      kb.text(`✅ Confirm Purchase (Pay ₹${price})`, `buy_confirm_${serviceId}_${validityId}`).row();
    } else {
      const needed = price - userBalance;
      kb.text(`💳 Top Up Wallet (+₹${needed.toFixed(0)})`, `wallet_topup_amount_${Math.ceil(needed)}`).row();
    }
    kb.text('← Back to Validities', `shop_srv_${serviceId}`);
    return kb;
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
