// State Management
const state = {
  token: localStorage.getItem('admin_token') || '',
  user: null,
  currentView: 'overview',
  services: [],
  validities: [],
  ldProducts: [],
  mappings: [],
  maintenance: { enabled: false, message: '' }
};

// API Helper
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers
    });

    if (res.status === 401) {
      if (endpoint !== '/auth/login') {
        handleLogout();
        throw new Error('Session expired. Please log in again.');
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Invalid admin username or password');
    }

    const data = await res.json();
    if (!res.ok && !data.success) {
      throw new Error(data.message || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add('hidden');
}

function openModal(modalId) {
  document.getElementById(modalId)?.classList.remove('hidden');
}

function safeOn(idOrElement, event, handler) {
  const el = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
  if (el) {
    el.addEventListener(event, handler);
  }
}

// Initialization & Auth
function boot() {
  initApp();
  setupEventListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

async function initApp() {
  if (!state.token) {
    showLoginView();
    return;
  }

  try {
    const res = await api('/auth/status');
    if (res.success && res.authenticated) {
      state.user = res.user;
      showAppLayout();
      loadViewData(state.currentView);
    } else {
      showLoginView();
    }
  } catch {
    showLoginView();
  }
}

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('hidden');
}

function showAppLayout() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');
  if (state.user) {
    document.getElementById('current-admin-name').textContent = state.user.username || 'Administrator';
  }
}

function handleLogout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('admin_token');
  showLoginView();
}

// Navigation
function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `view-${viewName}`);
  });

  const titles = {
    overview: { title: 'Overview Dashboard', sub: 'Real-time store statistics and quick metrics' },
    services: { title: 'Services & Validities', sub: 'Manage products, validity plans, pricing, and stock visibility' },
    licenses: { title: 'License Stock Inventory', sub: 'Upload bulk keys and manage available license codes' },
    'ld-api': { title: 'API / License Provider', sub: 'Manage License Dashboard connection, balance, and external mapping' },
    payments: { title: 'Payment Gateways & Top-Ups', sub: 'Configure Binance Pay, UPI Auto QR, and verify top-ups' },
    orders: { title: 'Orders & Fulfillment History', sub: 'Audit and inspect all customer digital license purchases' },
    users: { title: 'User & Wallet Management', sub: 'Search users, inspect balances, adjust credits, and view history' },
    maintenance: { title: 'Maintenance Mode', sub: 'Instantly pause shopping flows with custom notice messages' },
    backups: { title: 'Backup & Restore Management', sub: 'Automated 12:01 AM IST backups, Telegram delivery & disaster recovery' },
    broadcasts: { title: 'Mass Broadcast & Inventory Alerts', sub: 'Compose promotional messages with instant preview and manage stock alerts' }
  };

  const meta = titles[viewName] || { title: 'Admin Dashboard', sub: '' };
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-subtitle').textContent = meta.sub;

  loadViewData(viewName);
}

function loadViewData(viewName) {
  switch (viewName) {
    case 'overview':
      loadOverviewData();
      break;
    case 'services':
      loadServicesData();
      break;
    case 'licenses':
      loadLicensesData();
      loadServicesForFilters();
      break;
    case 'ld-api':
      loadLdApiData();
      break;
    case 'payments':
      loadPaymentsData();
      break;
    case 'orders':
      loadOrdersData();
      break;
    case 'users':
      loadUsersData();
      break;
    case 'maintenance':
      loadMaintenanceData();
      break;
    case 'backups':
      loadBackupsData();
      break;
    case 'broadcasts':
      loadBroadcastsData();
      break;
    case 'support':
      loadSupportData();
      break;
  }
}

// 1. OVERVIEW VIEW
async function loadOverviewData() {
  try {
    const data = await api('/stats/overview');
    if (!data.success) return;

    const stats = data.stats;
    document.getElementById('stat-revenue').textContent = `₹${stats.totalRevenue.toFixed(2)}`;
    document.getElementById('stat-orders').textContent = stats.totalOrders.toLocaleString();
    document.getElementById('stat-users').textContent = stats.totalUsers.toLocaleString();
    document.getElementById('stat-available-stock').textContent = stats.availableStock.toLocaleString();

    // Update maintenance chip in header
    const maintBadge = document.getElementById('maintenance-badge');
    if (stats.maintenanceEnabled) {
      maintBadge.className = 'status-chip chip-danger';
      maintBadge.innerHTML = '<span class="pulse-dot"></span><span>Maintenance Mode ON</span>';
    } else {
      maintBadge.className = 'status-chip chip-success';
      maintBadge.innerHTML = '<span class="pulse-dot"></span><span>Store Live</span>';
    }

    // Render Recent Orders
    const ordersTbody = document.getElementById('overview-recent-orders');
    if (data.recentOrders && data.recentOrders.length > 0) {
      ordersTbody.innerHTML = data.recentOrders.map(o => `
        <tr>
          <td><code>${escapeHtml(o.id)}</code></td>
          <td>${escapeHtml(o.user_username ? '@' + o.user_username : o.telegram_id)}</td>
          <td><strong>${escapeHtml(o.service_name)}</strong> <small class="text-muted">(${escapeHtml(o.validity_name)})</small></td>
          <td><strong>₹${o.price_paid.toFixed(2)}</strong></td>
          <td><span class="badge ${o.fulfillment_type === 'LOCAL' ? 'badge-success' : 'badge-info'}">${o.fulfillment_type}</span></td>
          <td><small class="text-muted">${new Date(o.created_at).toLocaleTimeString()}</small></td>
        </tr>
      `).join('');
    } else {
      ordersTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No orders placed yet.</td></tr>';
    }

    // Render Recent Payments
    const payTbody = document.getElementById('overview-recent-payments');
    if (data.recentPayments && data.recentPayments.length > 0) {
      payTbody.innerHTML = data.recentPayments.map(p => `
        <tr>
          <td><code>${escapeHtml(p.reference_id)}</code></td>
          <td><span class="badge badge-purple">${p.payment_method}</span></td>
          <td><strong>₹${p.amount.toFixed(2)}</strong></td>
          <td><span class="badge ${p.status === 'COMPLETED' ? 'badge-success' : (p.status === 'PENDING' ? 'badge-warning' : 'badge-danger')}">${p.status}</span></td>
          <td><small class="text-muted">${new Date(p.created_at).toLocaleTimeString()}</small></td>
        </tr>
      `).join('');
    } else {
      payTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No payment transactions yet.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load overview data', 'error');
  }
}

// 2. SERVICES & VALIDITIES VIEW
async function loadServicesData() {
  try {
    const [data, genSettings] = await Promise.all([
      api('/services'),
      api('/settings/general')
    ]);

    if (genSettings && genSettings.success && genSettings.settings) {
      state.usdRate = genSettings.settings.usdRate || 83.0;
      const rateInput = document.getElementById('input-usd-rate');
      if (rateInput) rateInput.value = state.usdRate;
    }

    if (!data.success) return;

    state.services = data.services;
    const container = document.getElementById('services-catalog-container');

    if (state.services.length === 0) {
      container.innerHTML = `
        <div class="glass-card text-center p-5">
          <p class="text-muted">No products created yet. Click "Add New Product" above to add your first product!</p>
        </div>
      `;
      return;
    }

    const currentUsdRate = state.usdRate || 83.0;

    container.innerHTML = state.services.map(srv => {
      const validitiesHtml = srv.validities && srv.validities.length > 0 
        ? srv.validities.map(v => {
          const usdVal = currentUsdRate > 0 ? (v.price / currentUsdRate).toFixed(2) : '0.00';
          return `
          <tr>
            <td><strong>${escapeHtml(v.name)}</strong></td>
            <td><code>${escapeHtml(v.id)}</code></td>
            <td>
              <strong class="text-success">₹${v.price.toFixed(2)}</strong>
              <small class="text-muted" style="margin-left: 4px;">($${usdVal})</small>
            </td>
            <td>
              <span class="badge ${v.available_stock > 0 ? 'badge-success' : 'badge-warning'}">
                ${v.available_stock} Available
              </span>
              <small class="text-muted">(${v.used_stock} used)</small>
            </td>
            <td>
              ${v.is_api_mapped 
                ? `<span class="badge badge-info" title="Mapped to: ${escapeHtml(v.external_product_id)}"><i class="fa-solid fa-link"></i> Mapped: ${escapeHtml(v.external_product_id)}</span>` 
                : '<span class="badge badge-secondary">Local Only</span>'}
            </td>
            <td>
              <span class="badge ${v.is_active ? 'badge-success' : 'badge-danger'}">
                ${v.is_active ? 'Active' : 'Disabled'}
              </span>
            </td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="editValidityModal('${srv.id}', '${v.id}')"><i class="fa-solid fa-pen"></i></button>
              <button class="btn btn-sm btn-danger" onclick="deleteValidity('${v.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `;
        }).join('')
        : '<tr><td colspan="7" class="text-center text-muted">No validities created for this service yet.</td></tr>';

      return `
        <div class="service-card">
          <div class="service-card-header">
            <div class="service-title-meta">
              <div class="service-icon-box"><i class="fa-solid fa-gamepad"></i></div>
              <div>
                <h3>${escapeHtml(srv.name)} <small class="text-muted">(${escapeHtml(srv.id)})</small></h3>
                <p>${srv.description ? escapeHtml(srv.description) : 'No description'} • <strong>${srv.validities_count} Validities</strong> • <strong>${srv.available_licenses} Keys in Stock</strong></p>
              </div>
            </div>
            <div class="service-header-actions">
              <span class="badge ${srv.is_active ? 'badge-success' : 'badge-danger'}">${srv.is_active ? 'Visible' : 'Hidden'}</span>
              <button class="btn btn-sm btn-primary" onclick="openAddValidityModal('${srv.id}')">
                <i class="fa-solid fa-plus"></i> Add Validity
              </button>
              <button class="btn btn-sm btn-outline" onclick="editServiceModal('${srv.id}')">
                <i class="fa-solid fa-pen"></i> Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteService('${srv.id}')">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          <div class="validities-subtable-container">
            <div class="validities-subtable-header">
              <h4>Validity Pricing Plans & Stock</h4>
            </div>
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Validity Name</th>
                    <th>Validity ID</th>
                    <th>Price</th>
                    <th>Stock Count</th>
                    <th>API Fulfillment Status</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${validitiesHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load services', 'error');
  }
}

// 3. LICENSE STOCK VIEW
async function loadLicensesData() {
  const serviceId = document.getElementById('lic-filter-service').value;
  const validityId = document.getElementById('lic-filter-validity').value;
  const isUsed = document.getElementById('lic-filter-status').value;
  const search = document.getElementById('lic-filter-search').value;

  const params = new URLSearchParams();
  if (serviceId) params.append('serviceId', serviceId);
  if (validityId) params.append('validityId', validityId);
  if (isUsed !== '') params.append('isUsed', isUsed);
  if (search) params.append('search', search);

  try {
    const data = await api(`/licenses?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('licenses-table-body');
    if (data.licenses && data.licenses.length > 0) {
      tbody.innerHTML = data.licenses.map(l => `
        <tr>
          <td>#${l.id}</td>
          <td><strong>${escapeHtml(l.service_name || l.service_id)}</strong></td>
          <td>${escapeHtml(l.validity_name || l.validity_id)}</td>
          <td><code>${escapeHtml(l.license_key)}</code></td>
          <td>
            <span class="badge ${l.is_used === 0 ? 'badge-success' : 'badge-danger'}">
              ${l.is_used === 0 ? 'Available' : 'Delivered / Used'}
            </span>
          </td>
          <td>${l.used_by_order_id ? `<code>${escapeHtml(l.used_by_order_id)}</code>` : '<span class="text-muted">—</span>'}</td>
          <td><small class="text-muted">${new Date(l.added_at).toLocaleString()}</small></td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteLicense(${l.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No licenses found matching current filter.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load licenses', 'error');
  }
}

async function loadServicesForFilters() {
  if (state.services.length === 0) {
    const data = await api('/services');
    if (data.success) state.services = data.services;
  }

  const srvSelect = document.getElementById('lic-filter-service');
  const bulkSrvSelect = document.getElementById('bulk-service-select');
  const mapSrvSelect = document.getElementById('map-service-select');

  const optionsHtml = '<option value="">Select Service</option>' + state.services.map(s => `
    <option value="${s.id}">${escapeHtml(s.name)} (${s.id})</option>
  `).join('');

  if (srvSelect) srvSelect.innerHTML = '<option value="">All Services</option>' + state.services.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (bulkSrvSelect) bulkSrvSelect.innerHTML = optionsHtml;
  if (mapSrvSelect) mapSrvSelect.innerHTML = optionsHtml;
}

// 4. API / LICENSE PROVIDER (LD API) VIEW
async function loadLdApiData() {
  try {
    const [cfgRes, diagRes, mapRes] = await Promise.all([
      api('/settings/ld'),
      api('/settings/ld/test', { method: 'POST' }),
      api('/settings/ld/mappings')
    ]);

    if (cfgRes.success) {
      document.getElementById('ld-endpoint-input').value = cfgRes.endpoint;
      if (cfgRes.tokenMasked) {
        document.getElementById('ld-token-input').placeholder = `Current token: ${cfgRes.tokenMasked}`;
      }
    }

    if (diagRes) {
      const isWorking = diagRes.success;
      const statusBadge = document.getElementById('ld-live-status-badge');
      statusBadge.className = `badge ${isWorking ? 'badge-success' : 'badge-danger'}`;
      statusBadge.textContent = isWorking ? 'API Connected / Working' : 'API Connection Failed';

      document.getElementById('diag-ld-status').textContent = diagRes.status || (isWorking ? 'Connected' : 'Failed');
      document.getElementById('diag-ld-balance').textContent = `$${(diagRes.balance || 0).toFixed(2)}`;
      document.getElementById('diag-ld-msg').textContent = diagRes.message || 'Status updated';
      document.getElementById('ld-balance-val').textContent = `$${(diagRes.balance || 0).toFixed(2)}`;
    }

    if (mapRes.success) {
      state.mappings = mapRes.mappings;
      renderMappingsTable();
    }
  } catch (err) {
    showToast('Failed to load LD API data', 'error');
  }
}

function renderMappingsTable() {
  const tbody = document.getElementById('api-mappings-table-body');
  if (state.mappings && state.mappings.length > 0) {
    tbody.innerHTML = state.mappings.map(m => `
      <tr>
        <td><strong>${escapeHtml(m.service_name || m.service_id)}</strong></td>
        <td>${escapeHtml(m.validity_name || m.validity_id)}</td>
        <td><code>${escapeHtml(m.external_product_id)}</code></td>
        <td>${escapeHtml(m.external_product_name || '—')}</td>
        <td><span class="badge ${m.is_enabled ? 'badge-success' : 'badge-danger'}">${m.is_enabled ? 'Active Mapped' : 'Disabled'}</span></td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteMapping('${m.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No external API product mappings defined. Local stock will be used exclusively.</td></tr>';
  }
}

// 5. PAYMENTS & GATEWAYS VIEW
async function loadPaymentsData() {
  try {
    const [cfgRes, payRes] = await Promise.all([
      api('/settings/payments'),
      api('/payments?limit=100')
    ]);

    if (cfgRes.success) {
      if (cfgRes.binance) {
        const apiKeyEl = document.getElementById('binance-api-key');
        if (apiKeyEl) apiKeyEl.value = cfgRes.binance.apiKeyMasked || '';
        const merchEl = document.getElementById('binance-merchant-id');
        if (merchEl) merchEl.value = cfgRes.binance.merchantId || '';
        const bepEl = document.getElementById('binance-bep20');
        if (bepEl) bepEl.value = cfgRes.binance.bep20Address || '';
        const relayEl = document.getElementById('binance-relay-url');
        if (relayEl) relayEl.value = cfgRes.binance.relayUrl || '';
        const whSecEl = document.getElementById('binance-webhook-secret');
        if (whSecEl) whSecEl.value = cfgRes.binance.webhookSecretMasked || '';
      }
      if (cfgRes.emailWorker) {
        const ew = cfgRes.emailWorker;
        const vpaEl = document.getElementById('email-upi-vpa');
        if (vpaEl) vpaEl.value = ew.config.merchantVpa || 'iamsandeepjha@fam';
        const nameEl = document.getElementById('email-upi-name');
        if (nameEl) nameEl.value = ew.config.merchantName || 'SANDEEP KUMAR JHA';
        const userEl = document.getElementById('email-upi-user');
        if (userEl) userEl.value = ew.config.imapUser || 'iamsandeepsonu@gmail.com';
        const timeoutEl = document.getElementById('email-upi-timeout');
        if (timeoutEl) timeoutEl.value = ew.config.timeoutMinutes || 15;
        const toggleEl = document.getElementById('email-upi-enabled-input');
        if (toggleEl) toggleEl.checked = ew.config.enabled;

        const badge = document.getElementById('email-worker-badge');
        if (badge) {
          if (ew.isRunning) {
            badge.className = 'badge badge-success';
            badge.innerHTML = '🟢 Running (Active)';
          } else {
            badge.className = 'badge badge-danger';
            badge.innerHTML = '🔴 Stopped';
          }
        }
      }
    }

    if (payRes.success) {
      const tbody = document.getElementById('payments-table-body');
      if (payRes.payments && payRes.payments.length > 0) {
        tbody.innerHTML = payRes.payments.map(p => `
          <tr>
            <td><code>${escapeHtml(p.reference_id)}</code></td>
            <td><strong>${escapeHtml(p.user_name || p.telegram_id)}</strong></td>
            <td><span class="badge ${p.payment_method === 'BINANCE_PAY' ? 'badge-warning' : 'badge-purple'}">${p.payment_method}</span></td>
            <td><strong>₹${p.amount.toFixed(2)}</strong></td>
            <td><span class="badge ${p.status === 'COMPLETED' ? 'badge-success' : (p.status === 'PENDING' ? 'badge-warning' : 'badge-danger')}">${p.status}</span></td>
            <td><small class="text-muted">${new Date(p.created_at).toLocaleString()}</small></td>
            <td>
              ${p.status === 'PENDING' ? `
                <div style="display:flex; gap:5px; flex-wrap:wrap;">
                  ${p.payment_method === 'BINANCE_PAY' ? `
                    <button class="btn btn-sm btn-outline" onclick="reconcileBinancePayment('${p.id}')" title="Query Binance API for live payment">
                      <i class="fa-solid fa-arrows-rotate"></i> Reconcile
                    </button>
                  ` : ''}
                  <button class="btn btn-sm btn-primary" onclick="approvePayment('${p.id}')">
                    <i class="fa-solid fa-check"></i> Approve
                  </button>
                </div>
              ` : '<span class="text-muted">—</span>'}
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No top-up payment transactions recorded.</td></tr>';
      }
    }
  } catch (err) {
    showToast('Failed to load payments data', 'error');
  }
}

// 6. ORDERS & HISTORY VIEW
async function loadOrdersData() {
  const fulfillmentType = document.getElementById('orders-filter-type').value;
  const search = document.getElementById('orders-filter-search').value;

  const params = new URLSearchParams();
  if (fulfillmentType) params.append('fulfillmentType', fulfillmentType);
  if (search) params.append('search', search);

  try {
    const data = await api(`/orders?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('orders-table-body');
    if (data.orders && data.orders.length > 0) {
      tbody.innerHTML = data.orders.map(o => `
        <tr>
          <td><code>${escapeHtml(o.id)}</code></td>
          <td><strong>${escapeHtml(o.user_name || o.telegram_id)}</strong></td>
          <td><strong>${escapeHtml(o.service_name)}</strong></td>
          <td>${escapeHtml(o.validity_name)}</td>
          <td><strong class="text-success">₹${o.price_paid.toFixed(2)}</strong></td>
          <td><span class="badge ${o.fulfillment_type === 'LOCAL' ? 'badge-success' : 'badge-info'}">${o.fulfillment_type}</span></td>
          <td><code>${escapeHtml(o.license_key)}</code></td>
          <td><small class="text-muted">${new Date(o.created_at).toLocaleString()}</small></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No orders found.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load orders', 'error');
  }
}

// 7. USERS & WALLETS VIEW
async function loadUsersData() {
  const search = document.getElementById('users-search-input').value;
  const params = new URLSearchParams();
  if (search) params.append('search', search);

  try {
    const data = await api(`/users?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('users-table-body');
    if (data.users && data.users.length > 0) {
      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td><code>${u.telegram_id}</code></td>
          <td><strong>${escapeHtml(u.first_name || '—')}</strong></td>
          <td>${u.username ? '@' + escapeHtml(u.username) : '<span class="text-muted">—</span>'}</td>
          <td><span class="badge badge-purple">${u.account_type}</span></td>
          <td><strong class="text-success">₹${u.balance.toFixed(2)}</strong></td>
          <td>${u.total_orders}</td>
          <td>₹${u.total_spent.toFixed(2)}</td>
          <td><small class="text-muted">${new Date(u.created_at).toLocaleDateString()}</small></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="viewUserDetail('${u.id}')">
              <i class="fa-solid fa-user-gear"></i> Inspect & Adjust
            </button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No users found.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load users', 'error');
  }
}

async function viewUserDetail(userId) {
  try {
    const data = await api(`/users/${userId}`);
    if (!data.success) return;

    const u = data.user;
    document.getElementById('modal-user-name').textContent = `Account: ${u.first_name || u.telegram_id} (@${u.username || 'no_user'})`;

    const body = document.getElementById('user-detail-body');
    body.innerHTML = `
      <div class="stats-grid mb-4">
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Current Balance</span>
            <h3 class="stat-value text-success">₹${u.balance.toFixed(2)}</h3>
          </div>
        </div>
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Total Orders</span>
            <h3 class="stat-value">${u.total_orders}</h3>
          </div>
        </div>
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Total Spent</span>
            <h3 class="stat-value">₹${u.total_spent.toFixed(2)}</h3>
          </div>
        </div>
      </div>

      <div class="glass-card mb-4">
        <h4 class="mb-3"><i class="fa-solid fa-coins"></i> Adjust Wallet Balance</h4>
        <form onsubmit="handleUserBalanceAdjust(event, '${u.id}')">
          <div class="grid-2-col">
            <div class="form-group">
              <label>Amount (Positive to Add, Negative to Deduct)</label>
              <input type="number" step="0.01" id="adj-amount-${u.id}" class="form-control" placeholder="e.g., 500 or -200" required>
            </div>
            <div class="form-group">
              <label>Reason / Audit Note</label>
              <input type="text" id="adj-reason-${u.id}" class="form-control" placeholder="e.g., Promotional bonus / manual correction">
            </div>
          </div>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-wallet"></i> Apply Balance Change</button>
        </form>
      </div>

      <div class="glass-card">
        <h4 class="mb-3"><i class="fa-solid fa-clock-rotate-left"></i> Wallet Audit Log</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Before</th>
                <th>After</th>
                <th>Description</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${data.walletTransactions && data.walletTransactions.length > 0
                ? data.walletTransactions.map(t => `
                  <tr>
                    <td><span class="badge ${t.type === 'TOPUP' || t.amount > 0 ? 'badge-success' : 'badge-danger'}">${t.type}</span></td>
                    <td><strong>${t.amount > 0 ? '+' : ''}₹${t.amount.toFixed(2)}</strong></td>
                    <td>₹${t.balance_before.toFixed(2)}</td>
                    <td>₹${t.balance_after.toFixed(2)}</td>
                    <td>${escapeHtml(t.description || '—')}</td>
                    <td><small class="text-muted">${new Date(t.created_at).toLocaleString()}</small></td>
                  </tr>
                `).join('')
                : '<tr><td colspan="6" class="text-center text-muted">No wallet transactions logged yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    openModal('modal-user-detail');
  } catch (err) {
    showToast('Failed to load user details', 'error');
  }
}

async function handleUserBalanceAdjust(event, userId) {
  event.preventDefault();
  const amount = parseFloat(document.getElementById(`adj-amount-${userId}`).value);
  const description = document.getElementById(`adj-reason-${userId}`).value;

  try {
    const res = await api(`/users/${userId}/balance`, {
      method: 'POST',
      body: JSON.stringify({ amount, description })
    });

    if (res.success) {
      showToast(res.message, 'success');
      viewUserDetail(userId);
      loadUsersData();
    } else {
      showToast(res.message || 'Balance adjustment failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 8. MAINTENANCE MODE VIEW
async function loadMaintenanceData() {
  try {
    const data = await api('/settings/maintenance');
    if (!data.success) return;

    state.maintenance = data.maintenance;
    document.getElementById('maintenance-toggle-input').checked = data.maintenance.enabled;
    document.getElementById('maintenance-msg-input').value = data.maintenance.message;
  } catch (err) {
    showToast('Failed to load maintenance settings', 'error');
  }
}

// 9. SUPPORT & STORE SETTINGS VIEW
async function loadSupportData() {
  try {
    const res = await api('/settings/general');
    if (!res || !res.success || !res.settings) return;
    const s = res.settings;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : '';
    };

    setVal('support-username-input', s.supportUsername || '');
    setVal('support-link-input', s.supportLink || '');
    setVal('support-btn-text-input', s.supportBtnText || '💬 Chat with Support Agent');
    setVal('support-button-label-input', s.supportButtonLabel || '🎧 Support');
    setVal('support-channel-url-input', s.supportChannelUrl || '');
    setVal('support-channel-label-input', s.supportChannelLabel || '📢 Official Updates Channel');
    setVal('support-message-input', s.supportMessage || '');
    setVal('brand-name-input', s.brandName || 'ALPHA DIGITAL STORE');
    setVal('usd-rate-general-input', s.usdRate || 83.0);

    updateSupportPreview();
  } catch (err) {
    showToast('Failed to load support settings', 'error');
  }
}

function updateSupportPreview() {
  const username = document.getElementById('support-username-input')?.value.trim().replace(/^@/, '') || 'AlphaSupport';
  const btnText = document.getElementById('support-btn-text-input')?.value.trim() || '💬 Chat with Support Agent';
  const channelUrl = document.getElementById('support-channel-url-input')?.value.trim();
  const channelLabel = document.getElementById('support-channel-label-input')?.value.trim() || '📢 Official Updates Channel';
  const customMessage = document.getElementById('support-message-input')?.value.trim();
  const brand = document.getElementById('brand-name-input')?.value.trim() || 'ALPHA STORE BOT';

  const previewBrand = document.getElementById('preview-brand-title');
  if (previewBrand) previewBrand.textContent = brand;

  const previewUser = document.getElementById('preview-username-val');
  if (previewUser) previewUser.textContent = username;

  const previewBtn = document.getElementById('preview-btn-label');
  if (previewBtn) previewBtn.textContent = btnText;

  const channelBtn = document.getElementById('preview-channel-btn');
  const channelBtnLabel = document.getElementById('preview-channel-label');
  if (channelBtn) {
    if (channelUrl) {
      channelBtn.classList.remove('hidden');
      if (channelBtnLabel) channelBtnLabel.textContent = channelLabel;
    } else {
      channelBtn.classList.add('hidden');
    }
  }

  const contentEl = document.getElementById('support-preview-text');
  if (contentEl) {
    if (customMessage) {
      contentEl.innerHTML = customMessage.replace(/\n/g, '<br>');
    } else {
      contentEl.innerHTML = `🎧 <b>24/7 Customer Support</b><br><br>Need help with an order, balance top-up, or license key issue?<br>Our dedicated support team is available around the clock to assist you!<br><br>💬 <b>Official Support:</b> @<span id="preview-username-val">${username}</span><br>⏰ <b>Response Time:</b> Usually within minutes`;
    }
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Login Form
  safeOn('login-form', 'submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errBox = document.getElementById('login-error');
    const loginBtn = document.getElementById('login-btn');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
      if (errBox) {
        errBox.textContent = 'Please enter both username and password';
        errBox.classList.remove('hidden');
      }
      return;
    }

    if (errBox) {
      errBox.classList.add('hidden');
      errBox.textContent = '';
    }

    const origBtnHtml = loginBtn ? loginBtn.innerHTML : 'Sign In';
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authenticating...';
    }

    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (res && res.success && res.token) {
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('admin_token', res.token);
        showAppLayout();
        switchView('overview');
      } else {
        if (errBox) {
          errBox.textContent = (res && res.message) || 'Invalid admin username or password';
          errBox.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || 'Login failed. Please check credentials.';
        errBox.classList.remove('hidden');
      }
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = origBtnHtml;
      }
    }
  });

  // Logout
  safeOn('logout-btn', 'click', handleLogout);

  // Global Refresh
  safeOn('btn-refresh-global', 'click', () => {
    loadViewData(state.currentView);
    showToast('Dashboard refreshed');
  });

  // USD Rate Form
  safeOn('usd-rate-form', 'submit', async (e) => {
    e.preventDefault();
    const usdRate = parseFloat(document.getElementById('input-usd-rate')?.value);
    if (isNaN(usdRate) || usdRate <= 0) {
      showToast('Please enter a valid positive number for USD rate', 'error');
      return;
    }

    try {
      const res = await api('/settings/general', {
        method: 'POST',
        body: JSON.stringify({ usdRate })
      });

      if (res.success) {
        state.usdRate = res.settings.usdRate;
        showToast(`USD Conversion Rate updated to 1 USD = ₹${state.usdRate}!`);
        loadServicesData();
      } else {
        showToast(res.message || 'Failed to update rate', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Sidebar navigation links
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });

  // Services View Actions
  safeOn('btn-add-service', 'click', () => {
    document.getElementById('modal-service-title').textContent = 'Add New Service';
    document.getElementById('service-is-edit').value = '0';
    document.getElementById('service-id-input').value = '';
    document.getElementById('service-id-input').readOnly = false;
    document.getElementById('service-name-input').value = '';
    document.getElementById('service-desc-input').value = '';
    document.getElementById('service-active-input').value = '1';
    openModal('modal-service');
  });

  safeOn('form-service', 'submit', async (e) => {
    e.preventDefault();
    const isEdit = document.getElementById('service-is-edit').value === '1';
    const id = document.getElementById('service-id-input').value.trim();
    const name = document.getElementById('service-name-input').value.trim();
    const description = document.getElementById('service-desc-input').value.trim();
    const is_active = parseInt(document.getElementById('service-active-input').value, 10);

    try {
      const endpoint = isEdit ? `/services/${id}` : '/services';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await api(endpoint, {
        method,
        body: JSON.stringify({ id, name, description, is_active })
      });

      if (res.success) {
        showToast(`Service ${isEdit ? 'updated' : 'created'} successfully!`);
        closeModal('modal-service');
        loadServicesData();
      } else {
        showToast(res.message || 'Operation failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Validity Form
  safeOn('form-validity', 'submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('val-service-id').value;
    const isEdit = document.getElementById('val-is-edit').value === '1';
    const valId = document.getElementById('val-id-edit').value;
    const name = document.getElementById('val-name-input').value.trim();
    const price = parseFloat(document.getElementById('val-price-input').value);
    const is_active = parseInt(document.getElementById('val-active-input').value, 10);

    try {
      const endpoint = isEdit ? `/services/validities/${valId}` : `/services/${serviceId}/validities`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await api(endpoint, {
        method,
        body: JSON.stringify({ name, price, is_active })
      });

      if (res.success) {
        showToast(`Validity ${isEdit ? 'updated' : 'added'} successfully!`);
        closeModal('modal-validity');
        loadServicesData();
      } else {
        showToast(res.message || 'Operation failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Bulk License Modal Trigger
  safeOn('btn-bulk-license-modal', 'click', () => {
    loadServicesForFilters();
    openModal('modal-bulk-license');
  });

  // Bulk Service select change -> update validities
  safeOn('bulk-service-select', 'change', async (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('bulk-validity-select');
    if (!valSelect) return;
    if (!srvId) {
      valSelect.innerHTML = '<option value="">Select Service First</option>';
      return;
    }

    const srv = state.services.find(s => s.id === srvId);
    if (srv && srv.validities) {
      valSelect.innerHTML = srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (Price: ₹${v.price})</option>`).join('');
    }
  });

  // Bulk Upload Form
  safeOn('form-bulk-license', 'submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('bulk-service-select').value;
    const validityId = document.getElementById('bulk-validity-select').value;
    const keysText = document.getElementById('bulk-keys-textarea').value.trim();

    try {
      const res = await api('/licenses/bulk', {
        method: 'POST',
        body: JSON.stringify({ serviceId, validityId, keysText })
      });

      if (res.success) {
        showToast(res.message);
        closeModal('modal-bulk-license');
        document.getElementById('bulk-keys-textarea').value = '';
        loadLicensesData();
      } else {
        showToast(res.message || 'Failed to upload keys', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Filters for Licenses
  safeOn('lic-filter-service', 'change', (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('lic-filter-validity');
    if (valSelect) {
      if (!srvId) {
        valSelect.innerHTML = '<option value="">All Validities</option>';
      } else {
        const srv = state.services.find(s => s.id === srvId);
        if (srv && srv.validities) {
          valSelect.innerHTML = '<option value="">All Validities</option>' + srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
        }
      }
    }
    loadLicensesData();
  });
  safeOn('lic-filter-validity', 'change', loadLicensesData);
  safeOn('lic-filter-status', 'change', loadLicensesData);
  safeOn('lic-filter-search', 'input', debounce(loadLicensesData, 300));

  // LD API Settings
  safeOn('ld-settings-form', 'submit', async (e) => {
    e.preventDefault();
    const endpoint = document.getElementById('ld-endpoint-input').value.trim();
    const token = document.getElementById('ld-token-input').value.trim();

    try {
      const res = await api('/settings/ld/config', {
        method: 'POST',
        body: JSON.stringify({ endpoint, token })
      });

      if (res.success) {
        showToast(res.message);
        loadLdApiData();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('btn-test-ld-connection', 'click', async () => {
    try {
      const res = await api('/settings/ld/test', { method: 'POST' });
      showToast(res.message, res.success ? 'success' : 'error');
      loadLdApiData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('btn-fetch-ld-products', 'click', async () => {
    try {
      const res = await api('/settings/ld/products');
      if (res.success && res.products) {
        state.ldProducts = res.products;
        showToast(`Fetched ${res.products.length} products from provider!`);
        openModal('modal-mapping');
        populateMappingModal();
      } else {
        showToast(res.message || 'Failed to fetch provider products', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('btn-create-mapping-modal', 'click', () => {
    loadServicesForFilters();
    openModal('modal-mapping');
    populateMappingModal();
  });

  safeOn('map-service-select', 'change', (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('map-validity-select');
    if (!valSelect) return;
    const srv = state.services.find(s => s.id === srvId);
    if (srv && srv.validities) {
      valSelect.innerHTML = srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
    }
  });

  safeOn('form-mapping', 'submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('map-service-select').value;
    const validityId = document.getElementById('map-validity-select').value;
    const selectProd = document.getElementById('map-provider-product-select').value;
    const customProd = document.getElementById('map-external-id-custom').value.trim();
    const externalProductId = customProd || selectProd;

    if (!externalProductId) {
      showToast('Please select or enter an external provider product ID', 'error');
      return;
    }

    try {
      const res = await api('/settings/ld/mappings', {
        method: 'POST',
        body: JSON.stringify({ serviceId, validityId, externalProductId })
      });

      if (res.success) {
        showToast(res.message);
        closeModal('modal-mapping');
        loadLdApiData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Binance & UPI Settings
  safeOn('binance-settings-form', 'submit', async (e) => {
    e.preventDefault();
    const apiKey = document.getElementById('binance-api-key').value;
    const secretKey = document.getElementById('binance-secret-key').value;
    const merchantId = document.getElementById('binance-merchant-id').value;
    const bep20Address = document.getElementById('binance-bep20').value;
    const relayUrl = document.getElementById('binance-relay-url').value;
    const webhookSecret = document.getElementById('binance-webhook-secret')?.value;

    try {
      const res = await api('/settings/payments/binance', {
        method: 'POST',
        body: JSON.stringify({ apiKey, secretKey, merchantId, bep20Address, relayUrl, webhookSecret })
      });
      showToast(res.message, res.success ? 'success' : 'error');
      if (res.success) {
        loadPaymentsData();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('btn-test-binance-connection', 'click', async () => {
    const resultBox = document.getElementById('binance-integrity-result');
    if (resultBox) {
      resultBox.className = 'alert alert-info';
      resultBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running comprehensive live Binance Integrity Check...';
      resultBox.classList.remove('hidden');
    }

    try {
      const res = await api('/settings/payments/binance/test', { method: 'POST' });
      showToast(res.message, res.success ? 'success' : 'error');

      if (resultBox && res.report) {
        const report = res.report;
        resultBox.className = report.success ? 'alert alert-success' : 'alert alert-warning';
        
        let html = `
          <div style="font-weight:600; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>${escapeHtml(report.summaryMessage)}</span>
            <span style="font-size:11px; opacity:0.8;">Latency: ${report.latencyMs}ms</span>
          </div>
          <table style="width:100%; font-size:12px; border-collapse:collapse; margin-top:6px;">
        `;

        for (const check of report.checks) {
          const badgeColor = check.status === 'PASS' ? '#10b981' : (check.status === 'WARN' ? '#f59e0b' : '#ef4444');
          const icon = check.status === 'PASS' ? '✓ PASS' : (check.status === 'WARN' ? '⚠ WARN' : '✕ FAIL');
          html += `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.06); padding:4px 0;">
              <td style="padding:4px 0; font-weight:500;">${escapeHtml(check.name)}</td>
              <td style="padding:4px 8px; color:${badgeColor}; font-weight:600; font-family:monospace;">${icon}</td>
              <td style="padding:4px 0; color:rgba(255,255,255,0.8);">${escapeHtml(check.message)}</td>
            </tr>
          `;
        }

        html += `</table>`;
        resultBox.innerHTML = html;
      }
    } catch (err) {
      showToast(err.message, 'error');
      if (resultBox) {
        resultBox.className = 'alert alert-danger';
        resultBox.innerHTML = `✕ Integrity Check Error: ${escapeHtml(err.message)}`;
      }
    }
  });

  safeOn('btn-reconcile-all-binance', 'click', async () => {
    if (!confirm('Reconcile all pending Binance payments against live transactions?')) return;
    try {
      const res = await api('/settings/payments/binance/reconcile', { method: 'POST' });
      showToast(`Reconciliation complete: ${res.reconciledCount} payments verified & completed!`, 'success');
      loadPaymentsData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('upi-settings-form', 'submit', async (e) => {
    e.preventDefault();
    const merchantVpa = document.getElementById('upi-vpa')?.value;
    const merchantName = document.getElementById('upi-name')?.value;
    const webhookSecret = document.getElementById('upi-secret')?.value;

    try {
      const res = await api('/settings/payments/upi', {
        method: 'POST',
        body: JSON.stringify({ merchantVpa, merchantName, webhookSecret })
      });
      showToast(res.message);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Email UPI (IMAP Auto-Verification) Form
  safeOn('email-upi-settings-form', 'submit', async (e) => {
    e.preventDefault();
    const merchantVpa = document.getElementById('email-upi-vpa')?.value.trim();
    const merchantName = document.getElementById('email-upi-name')?.value.trim();
    const imapUser = document.getElementById('email-upi-user')?.value.trim();
    const imapPassword = document.getElementById('email-upi-pass')?.value.trim();
    const timeoutMinutes = parseInt(document.getElementById('email-upi-timeout')?.value, 10);
    const enabled = document.getElementById('email-upi-enabled-input')?.checked ?? true;

    try {
      const res = await api('/settings/payments/email-upi', {
        method: 'POST',
        body: JSON.stringify({
          merchantVpa,
          merchantName,
          imapUser,
          imapPassword: imapPassword || undefined,
          timeoutMinutes: isNaN(timeoutMinutes) ? 15 : timeoutMinutes,
          enabled
        })
      });

      if (res.success) {
        showToast(res.message || 'Email UPI settings saved!', 'success');
        loadPaymentsData();
      } else {
        showToast(res.message || 'Failed to save settings', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Test IMAP Connection
  safeOn('btn-test-email-imap', 'click', async () => {
    const resBox = document.getElementById('email-test-result');
    const btn = document.getElementById('btn-test-email-imap');
    if (resBox) {
      resBox.className = 'alert alert-info';
      resBox.textContent = '🔄 Connecting to imap.gmail.com:993...';
      resBox.classList.remove('hidden');
    }
    if (btn) btn.disabled = true;

    try {
      const imapUser = document.getElementById('email-upi-user')?.value.trim();
      const imapPassword = document.getElementById('email-upi-pass')?.value.trim();

      const res = await api('/settings/payments/email-upi/test', {
        method: 'POST',
        body: JSON.stringify({
          imapUser: imapUser || undefined,
          imapPassword: imapPassword || undefined
        })
      });

      if (resBox) {
        if (res.success) {
          resBox.className = 'alert alert-success';
          resBox.innerHTML = `<strong>✅ Success:</strong> Connected & authenticated with Gmail IMAP successfully!`;
        } else {
          resBox.className = 'alert alert-danger';
          resBox.innerHTML = `<strong>❌ Connection Failed:</strong> ${escapeHtml(res.message || 'Authentication error')}`;
        }
      }
      showToast(res.message, res.success ? 'success' : 'error');
    } catch (err) {
      if (resBox) {
        resBox.className = 'alert alert-danger';
        resBox.innerHTML = `<strong>❌ Error:</strong> ${escapeHtml(err.message)}`;
      }
      showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Toggle Email UPI Worker ON/OFF
  safeOn('email-upi-enabled-input', 'change', async (e) => {
    const enabled = e.target.checked;
    try {
      const res = await api('/settings/payments/email-upi/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled })
      });
      showToast(res.message, enabled ? 'success' : 'info');
      loadPaymentsData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Maintenance Toggle & Form
  safeOn('maintenance-toggle-input', 'change', async (e) => {
    const enabled = e.target.checked;
    try {
      const res = await api('/settings/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled })
      });
      showToast(res.message, enabled ? 'error' : 'success');
      loadOverviewData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  safeOn('maintenance-form', 'submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('maintenance-msg-input').value;
    try {
      const res = await api('/settings/maintenance', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      showToast('Maintenance notice message saved successfully!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Support Settings Form & Live Preview
  safeOn('support-settings-form', 'submit', async (e) => {
    e.preventDefault();
    const supportUsername = document.getElementById('support-username-input')?.value.trim();
    const supportLink = document.getElementById('support-link-input')?.value.trim();
    const supportBtnText = document.getElementById('support-btn-text-input')?.value.trim();
    const supportButtonLabel = document.getElementById('support-button-label-input')?.value.trim();
    const supportChannelUrl = document.getElementById('support-channel-url-input')?.value.trim();
    const supportChannelLabel = document.getElementById('support-channel-label-input')?.value.trim();
    const supportMessage = document.getElementById('support-message-input')?.value;
    const brandName = document.getElementById('brand-name-input')?.value.trim();
    const usdRate = parseFloat(document.getElementById('usd-rate-general-input')?.value);

    try {
      const res = await api('/settings/general', {
        method: 'POST',
        body: JSON.stringify({
          supportUsername,
          supportLink,
          supportBtnText,
          supportButtonLabel,
          supportChannelUrl,
          supportChannelLabel,
          supportMessage,
          brandName,
          usdRate: isNaN(usdRate) ? undefined : usdRate
        })
      });

      if (res && res.success) {
        showToast('Support & Store settings updated successfully!', 'success');
        if (brandName) {
          const brandEl = document.getElementById('sidebar-brand-name');
          if (brandEl) brandEl.textContent = brandName;
        }
        updateSupportPreview();
      } else {
        showToast(res.message || 'Failed to save support settings', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Live preview typing listeners
  const supportInputs = [
    'support-username-input',
    'support-link-input',
    'support-btn-text-input',
    'support-button-label-input',
    'support-channel-url-input',
    'support-channel-label-input',
    'support-message-input',
    'brand-name-input'
  ];
  supportInputs.forEach(id => {
    safeOn(id, 'input', updateSupportPreview);
  });

  // Database Download (.db)
  safeOn('btn-download-db', 'click', () => {
    const token = state.token || localStorage.getItem('admin_token');
    const downloadUrl = `/api/settings/db/download?token=${encodeURIComponent(token || '')}`;
    window.open(downloadUrl, '_blank');
    showToast('Starting database download...', 'info');
  });

  // Database Export (JSON)
  safeOn('btn-export-backup-json', 'click', async () => {
    try {
      showToast('Exporting database backup...', 'info');
      const res = await api('/settings/db/export');
      if (res.success && res.data) {
        const jsonStr = JSON.stringify(res.data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bot_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ Database backup exported successfully!', 'success');
      } else {
        showToast('Failed to export backup: ' + (res.message || 'Unknown error'), 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Database Restore (JSON)
  safeOn('btn-restore-backup', 'click', async () => {
    const fileInput = document.getElementById('import-backup-file');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      showToast('Please select a JSON backup file to restore.', 'error');
      return;
    }

    const file = fileInput.files[0];
    if (!confirm(`Are you sure you want to restore data from "${file.name}"? This will safely update/merge all products, validities, keys, and users.`)) {
      return;
    }

    try {
      showToast('Reading and importing backup...', 'info');
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          const backupData = parsed.data || parsed;

          const res = await api('/settings/db/import', {
            method: 'POST',
            body: JSON.stringify({ data: backupData })
          });

          if (res.success) {
            showToast(res.message, 'success');
            fileInput.value = '';
            // Reload all dashboard tabs
            loadOverviewData();
            loadServicesData();
            loadLicensesData();
            loadLdApiData();
            loadUsersData();
            loadOrdersData();
          } else {
            showToast(res.message || 'Failed to restore backup.', 'error');
          }
        } catch (parseErr) {
          showToast('Invalid JSON file format: ' + parseErr.message, 'error');
        }
      };
      reader.readAsText(file);
    } catch (err) {
      showToast('Restore failed: ' + err.message, 'error');
    }
  });

  // Orders and Users filters
  safeOn('orders-filter-type', 'change', loadOrdersData);
  safeOn('orders-filter-search', 'input', debounce(loadOrdersData, 300));
  safeOn('users-search-input', 'input', debounce(loadUsersData, 300));

  // Backup & Restore Events
  safeOn('btn-create-backup-now', 'click', handleCreateBackupNow);
  safeOn('btn-refresh-backups', 'click', loadBackupsData);
  safeOn('btn-execute-restore', 'click', handleExecuteRestore);

  const dropzone = document.getElementById('backup-dropzone');
  const fileInput = document.getElementById('backup-file-input');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        document.getElementById('selected-upload-name').textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
        document.getElementById('btn-submit-upload-restore').disabled = false;
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#6366f1';
      dropzone.style.background = 'rgba(99, 102, 241, 0.1)';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'rgba(255,255,255,0.15)';
      dropzone.style.background = 'rgba(255,255,255,0.02)';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(255,255,255,0.15)';
      dropzone.style.background = 'rgba(255,255,255,0.02)';
      if (e.dataTransfer.files?.length) {
        fileInput.files = e.dataTransfer.files;
        const file = e.dataTransfer.files[0];
        document.getElementById('selected-upload-name').textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
        document.getElementById('btn-submit-upload-restore').disabled = false;
      }
    });
  }

  safeOn('btn-submit-upload-restore', 'click', handleUploadRestoreClick);

  // Broadcast & Marketing Events
  safeOn('btn-refresh-broadcasts', 'click', loadBroadcastsData);
  safeOn('btn-test-broadcast', 'click', handleTestBroadcast);
  safeOn('btn-audit-stock', 'click', handleAuditStock);

  const bcInputs = ['bc-message-input', 'bc-photo-url-input', 'bc-btn-text-input', 'bc-btn-url-input'];
  bcInputs.forEach(id => safeOn(id, 'input', updateBroadcastLivePreview));

  safeOn('btn-template-promo', 'click', () => {
    const msgEl = document.getElementById('bc-message-input');
    const photoEl = document.getElementById('bc-photo-url-input');
    const btnTextEl = document.getElementById('bc-btn-text-input');
    const btnUrlEl = document.getElementById('bc-btn-url-input');

    if (msgEl) msgEl.value = `🔥 <b>WEEKEND FLASH SALE IS LIVE!</b>\n\nGet <b>30% OFF</b> on all VIP Digital License Keys!\n\n⚡ <i>Instant Delivery</i>\n🔒 <i>100% Stock Protection</i>\n\n👉 <b>Tap below to grab your key now!</b>`;
    if (photoEl) photoEl.value = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800';
    if (btnTextEl) btnTextEl.value = '🛒 Claim Discount Now';
    if (btnUrlEl) btnUrlEl.value = 'https://t.me/sandy69services_bot?start=shop';
    updateBroadcastLivePreview();
    showToast('Promo template loaded!');
  });

  safeOn('btn-template-stock', 'click', () => {
    const msgEl = document.getElementById('bc-message-input');
    const photoEl = document.getElementById('bc-photo-url-input');
    const btnTextEl = document.getElementById('bc-btn-text-input');
    const btnUrlEl = document.getElementById('bc-btn-url-input');

    if (msgEl) msgEl.value = `⚡ <b>NEW STOCK REFILL ALERT!</b>\n\nFresh stock of VIP License Keys has just been added!\n\n🎮 <b>Products:</b> Apple VIP, BGMI, Free Fire\n🚀 <b>Delivery:</b> Instant Delivery within 2 seconds!\n\n<i>Order now before stock runs out!</i>`;
    if (photoEl) photoEl.value = '';
    if (btnTextEl) btnTextEl.value = '⚡ Buy License Key';
    if (btnUrlEl) btnUrlEl.value = 'https://t.me/sandy69services_bot?start=shop';
    updateBroadcastLivePreview();
    showToast('Stock refill template loaded!');
  });

  safeOn('form-broadcast', 'submit', handleSendBroadcast);
  safeOn('form-stock-settings', 'submit', handleSaveStockAlertSettings);
}

// ----------------------------------------------------
// BROADCAST & MARKETING MODULE
// ----------------------------------------------------
function updateBroadcastLivePreview() {
  const message = document.getElementById('bc-message-input')?.value || '';
  const photoUrl = document.getElementById('bc-photo-url-input')?.value.trim() || '';
  const btnText = document.getElementById('bc-btn-text-input')?.value.trim() || '';

  const previewText = document.getElementById('preview-text');
  const previewPhoto = document.getElementById('preview-photo');
  const previewBtnWrap = document.getElementById('preview-button-wrap');
  const previewBtnLabel = document.getElementById('preview-button-label');

  if (previewText) {
    if (message.trim()) {
      previewText.innerHTML = message;
    } else {
      previewText.textContent = 'Your message preview will appear here in real-time...';
    }
  }

  if (previewPhoto) {
    if (photoUrl) {
      previewPhoto.src = photoUrl;
      previewPhoto.style.display = 'block';
    } else {
      previewPhoto.style.display = 'none';
      previewPhoto.src = '';
    }
  }

  if (previewBtnWrap && previewBtnLabel) {
    if (btnText) {
      previewBtnLabel.textContent = btnText;
      previewBtnWrap.style.display = 'block';
    } else {
      previewBtnWrap.style.display = 'none';
    }
  }
}

async function loadBroadcastsData() {
  const tbody = document.getElementById('broadcasts-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 25px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading broadcast history...</td></tr>';
  }

  try {
    const [historyRes, auditRes, usersRes] = await Promise.all([
      api('/broadcasts/history'),
      api('/broadcasts/stock-alerts/audit'),
      api('/users?limit=1')
    ]);

    // 1. Update audience count
    const totalUsers = usersRes.total || (usersRes.users ? usersRes.users.length : 0);
    document.getElementById('bc-total-users').textContent = totalUsers.toLocaleString();

    // 2. Update stock alerts stats
    if (auditRes.success) {
      const isEnabled = auditRes.enabled;
      const threshold = auditRes.threshold || 2;
      const lowStockItems = (auditRes.items || []).filter(i => i.needsAlert);

      document.getElementById('bc-alert-status').textContent = isEnabled ? 'Active' : 'Disabled';
      document.getElementById('bc-alert-status').style.color = isEnabled ? '#10b981' : '#94a3b8';
      document.getElementById('bc-alert-threshold-text').textContent = `Threshold: \u2264 ${threshold} keys`;
      document.getElementById('bc-low-stock-count').textContent = lowStockItems.length;

      const thresholdInput = document.getElementById('stock-threshold-input');
      const toggleInput = document.getElementById('stock-alerts-enabled-input');
      if (thresholdInput) thresholdInput.value = threshold;
      if (toggleInput) toggleInput.checked = isEnabled;
    }

    // 3. Render campaigns history
    if (historyRes.success) {
      const history = historyRes.history || [];
      document.getElementById('bc-total-campaigns').textContent = history.length;
      document.getElementById('bc-history-count').textContent = `${history.length} Campaigns`;

      if (tbody) {
        if (history.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">
                <i class="fa-solid fa-paper-plane" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                No promotional broadcasts sent yet. Compose your first announcement above!
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = history.map(c => {
            const successRate = c.total_targets > 0 
              ? ((c.sent_count / c.total_targets) * 100).toFixed(0) + '%' 
              : '100%';

            return `
              <tr>
                <td><small style="color: #cbd5e1;">${formatISTDate(c.created_at)}</small></td>
                <td>
                  <span style="font-size: 0.85rem; max-width: 250px; display: inline-block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(c.message.slice(0, 60))}...
                  </span>
                </td>
                <td><strong>${c.total_targets}</strong></td>
                <td><span class="badge badge-success">${c.sent_count} sent</span></td>
                <td><span class="badge ${c.failed_count > 0 ? 'badge-danger' : 'badge-info'}">${c.failed_count}</span></td>
                <td><strong>${successRate}</strong></td>
                <td><small class="text-muted">${escapeHtml(c.created_by || 'Admin')}</small></td>
                <td><span class="status-chip chip-success" style="font-size: 0.75rem; padding: 2px 8px;">COMPLETED</span></td>
              </tr>
            `;
          }).join('');
        }
      }
    }
  } catch (err) {
    console.error('Failed to load broadcasts data:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load broadcasts: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

async function handleTestBroadcast() {
  const message = document.getElementById('bc-message-input')?.value || '';
  const photoUrl = document.getElementById('bc-photo-url-input')?.value.trim() || undefined;
  const buttonText = document.getElementById('bc-btn-text-input')?.value.trim() || undefined;
  const buttonUrl = document.getElementById('bc-btn-url-input')?.value.trim() || undefined;

  if (!message.trim()) {
    showToast('Please type a broadcast message first.', 'error');
    return;
  }

  const btn = document.getElementById('btn-test-broadcast');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Test...';
  }

  try {
    const res = await api('/broadcasts/test', {
      method: 'POST',
      body: JSON.stringify({ message, photoUrl, buttonText, buttonUrl })
    });

    if (res.success) {
      showToast(res.message || '✅ Test broadcast delivered to your Admin Telegram!', 'success');
    } else {
      showToast(res.message || 'Failed to send test preview.', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-vial"></i> Send Test to Admin';
    }
  }
}

async function handleSendBroadcast(e) {
  e.preventDefault();

  const message = document.getElementById('bc-message-input')?.value || '';
  const photoUrl = document.getElementById('bc-photo-url-input')?.value.trim() || undefined;
  const buttonText = document.getElementById('bc-btn-text-input')?.value.trim() || undefined;
  const buttonUrl = document.getElementById('bc-btn-url-input')?.value.trim() || undefined;

  if (!message.trim()) {
    showToast('Please enter a message to broadcast.', 'error');
    return;
  }

  if (!confirm('Are you sure you want to send this mass broadcast to ALL registered Telegram bot users?')) {
    return;
  }

  const btn = document.getElementById('btn-send-broadcast');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Blasting Broadcast...';
  }

  try {
    showToast('🚀 Blasting mass broadcast to all users...', 'info');
    const res = await api('/broadcasts/send', {
      method: 'POST',
      body: JSON.stringify({ message, photoUrl, buttonText, buttonUrl })
    });

    if (res.success) {
      showToast(res.message || '🎉 Broadcast completed successfully!', 'success');
      loadBroadcastsData();
    } else {
      showToast(res.message || 'Broadcast failed.', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Send Mass Broadcast to All Users';
    }
  }
}

async function handleSaveStockAlertSettings(e) {
  e.preventDefault();
  const threshold = document.getElementById('stock-threshold-input')?.value;
  const enabled = document.getElementById('stock-alerts-enabled-input')?.checked;

  try {
    const res = await api('/broadcasts/stock-alerts/settings', {
      method: 'POST',
      body: JSON.stringify({ threshold, enabled })
    });

    if (res.success) {
      showToast(res.message || 'Stock alert settings saved!', 'success');
      loadBroadcastsData();
    } else {
      showToast(res.message || 'Failed to save settings.', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleAuditStock() {
  const btn = document.getElementById('btn-audit-stock');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Auditing...';
  }

  try {
    const res = await api('/broadcasts/stock-alerts/audit');
    if (res.success) {
      const low = (res.items || []).filter(i => i.needsAlert);
      if (low.length === 0) {
        showToast('✅ All products have sufficient inventory!', 'success');
      } else {
        showToast(`⚠️ ${low.length} product plan(s) are at or below threshold! Alert sent to Admin.`, 'warning');
      }
      loadBroadcastsData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Audit Stock';
    }
  }
}

// ----------------------------------------------------
// BACKUP & RESTORE MODULE
// ----------------------------------------------------
let pendingRestoreTarget = null;
let pendingRestoreIsUpload = false;

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatISTDate(isoStr) {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: true
    });
  } catch {
    return isoStr;
  }
}

async function loadBackupsData() {
  const tbody = document.getElementById('backups-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 25px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading backups...</td></tr>';
  }

  try {
    const [backupsRes, logsRes] = await Promise.all([
      api('/backups'),
      api('/backups/audit-logs')
    ]);

    if (backupsRes.success) {
      const list = backupsRes.backups || [];
      const stats = backupsRes.stats || {};

      // Update metric cards
      document.getElementById('bk-total-count').textContent = stats.totalBackups || list.length;
      document.getElementById('bk-table-count').textContent = `${list.length} Files`;

      if (stats.latestBackup) {
        document.getElementById('bk-latest-time').textContent = formatISTDate(stats.latestBackup.createdAt);
        document.getElementById('bk-latest-size').textContent = stats.latestBackup.sizeFormatted;
        document.getElementById('bk-latest-type').textContent = stats.latestBackup.type;
      } else if (list.length > 0) {
        document.getElementById('bk-latest-time').textContent = formatISTDate(list[0].createdAt);
        document.getElementById('bk-latest-size').textContent = list[0].sizeFormatted;
        document.getElementById('bk-latest-type').textContent = list[0].type;
      } else {
        document.getElementById('bk-latest-time').textContent = 'No backups yet';
        document.getElementById('bk-latest-size').textContent = '0 KB';
        document.getElementById('bk-latest-type').textContent = 'Scheduled 12:01 AM IST';
      }

      // Render table
      if (tbody) {
        if (list.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; color: #94a3b8; padding: 30px;">
                <i class="fa-solid fa-shield-cat" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                No backups created yet. Click <strong>"Create Backup Now"</strong> above to generate your first disaster recovery snapshot.
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = list.map(b => {
            const isDb = b.format === 'db';
            const typeBadgeClass = b.type.includes('Daily') ? 'badge-success' : (b.type.includes('Safety') ? 'badge-warning' : 'badge-info');
            return `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid ${isDb ? 'fa-database text-primary' : 'fa-file-code text-warning'}"></i>
                    <strong style="font-family: monospace; font-size: 0.88rem;">${escapeHtml(b.filename)}</strong>
                  </div>
                </td>
                <td><span class="badge ${typeBadgeClass}">${escapeHtml(b.type)}</span></td>
                <td><code>${escapeHtml(b.sizeFormatted)}</code></td>
                <td><small style="color: #cbd5e1;">${formatISTDate(b.createdAt)}</small></td>
                <td><span class="status-chip chip-success" style="font-size: 0.75rem; padding: 2px 8px;"><span class="pulse-dot"></span>Ready</span></td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; gap: 6px;">
                    <button class="btn btn-sm btn-outline" onclick="downloadBackup('${escapeHtml(b.filename)}')" title="Download Backup File">
                      <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="btn btn-sm btn-outline" style="border-color: #ef4444; color: #ef4444;" onclick="openRestoreModal('${escapeHtml(b.filename)}')" title="Restore Server Database from this Backup">
                      <i class="fa-solid fa-rotate-left"></i> Restore
                    </button>
                    <button class="btn btn-sm btn-outline" style="color: #94a3b8;" onclick="deleteBackup('${escapeHtml(b.filename)}')" title="Delete Backup File">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    }

    // Render Audit Logs
    if (logsRes && logsRes.success) {
      renderBackupAuditLogs(logsRes.logs || []);
    }
  } catch (err) {
    console.error('Failed to load backups data:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load backups: ${escapeHtml(err.message)}</td></tr>`;
    }
    showToast(err.message, 'error');
  }
}

function renderBackupAuditLogs(logs) {
  const tbody = document.getElementById('backup-logs-table-body');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No audit events recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const isSuccess = l.status === 'SUCCESS';
    const statusChip = isSuccess
      ? '<span class="status-chip chip-success" style="font-size: 0.75rem; padding: 2px 8px;">SUCCESS</span>'
      : '<span class="status-chip chip-danger" style="font-size: 0.75rem; padding: 2px 8px;">FAILED</span>';

    return `
      <tr>
        <td><small style="color: #cbd5e1;">${formatISTDate(l.created_at)}</small></td>
        <td><strong>${escapeHtml(l.action)}</strong></td>
        <td><code style="font-size: 0.8rem;">${escapeHtml(l.filename || '--')}</code></td>
        <td><span class="badge badge-info">${escapeHtml(l.performed_by || 'system')}</span></td>
        <td>${statusChip}</td>
        <td><small style="color: #94a3b8;">${escapeHtml(l.details || '')}</small></td>
      </tr>
    `;
  }).join('');
}

async function handleCreateBackupNow() {
  const btn = document.getElementById('btn-create-backup-now');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Snapshot...';
  }

  try {
    showToast('Creating full disaster recovery snapshot...', 'info');
    const res = await api('/backups/create', { method: 'POST' });
    if (res.success) {
      showToast('✅ Disaster recovery backup created and delivered to Telegram!', 'success');
      loadBackupsData();
    } else {
      showToast(res.message || 'Failed to create backup', 'error');
    }
  } catch (err) {
    showToast('Backup failed: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Create Backup Now';
    }
  }
}

window.downloadBackup = function(filename) {
  const token = state.token || localStorage.getItem('admin_token');
  const downloadUrl = `/api/backups/${encodeURIComponent(filename)}/download?token=${encodeURIComponent(token || '')}`;
  window.open(downloadUrl, '_blank');
  showToast(`Downloading ${filename}...`, 'info');
};

window.openRestoreModal = function(filename) {
  pendingRestoreTarget = filename;
  pendingRestoreIsUpload = false;
  document.getElementById('confirm-restore-filename').textContent = filename;
  openModal('modal-restore-confirm');
};

function handleUploadRestoreClick() {
  const fileInput = document.getElementById('backup-file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Please select or drop a backup file first.', 'error');
    return;
  }

  const file = fileInput.files[0];
  pendingRestoreTarget = file;
  pendingRestoreIsUpload = true;
  document.getElementById('confirm-restore-filename').textContent = `Uploaded File: ${file.name} (${formatBytes(file.size)})`;
  openModal('modal-restore-confirm');
}

async function handleExecuteRestore() {
  if (!pendingRestoreTarget) return;

  const btn = document.getElementById('btn-execute-restore');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restoring Database...';
  }

  try {
    if (pendingRestoreIsUpload) {
      // Upload & Restore flow
      const file = pendingRestoreTarget;
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const res = await api('/backups/upload-restore', {
          method: 'POST',
          body: JSON.stringify({
            data: parsed,
            format: 'json',
            filename: file.name
          })
        });

        if (res.success) {
          showToast('🎉 System restored successfully from uploaded JSON backup!', 'success');
          closeModal('modal-restore-confirm');
          document.getElementById('backup-file-input').value = '';
          document.getElementById('selected-upload-name').textContent = 'Click or drag backup file here';
          document.getElementById('btn-submit-upload-restore').disabled = true;
          loadBackupsData();
          loadOverviewData();
          loadServicesData();
        } else {
          showToast(res.message || 'Restoration failed', 'error');
        }
      } else {
        // Binary SQLite base64 restore
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64 = e.target.result.split(',')[1];
            const res = await api('/backups/upload-restore', {
              method: 'POST',
              body: JSON.stringify({
                data: base64,
                format: 'db',
                filename: file.name
              })
            });

            if (res.success) {
              showToast('🎉 System restored successfully from uploaded SQLite .db!', 'success');
              closeModal('modal-restore-confirm');
              document.getElementById('backup-file-input').value = '';
              document.getElementById('selected-upload-name').textContent = 'Click or drag backup file here';
              document.getElementById('btn-submit-upload-restore').disabled = true;
              loadBackupsData();
              loadOverviewData();
              loadServicesData();
            } else {
              showToast(res.message || 'Restoration failed', 'error');
            }
          } catch (uploadErr) {
            showToast('Restore failed: ' + uploadErr.message, 'error');
          } finally {
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Yes, Restore System Now';
            }
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    } else {
      // Stored Server Backup Restore Flow
      const filename = pendingRestoreTarget;
      const res = await api('/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ filename })
      });

      if (res.success) {
        showToast(`🎉 System restored successfully from ${filename}!`, 'success');
        closeModal('modal-restore-confirm');
        loadBackupsData();
        loadOverviewData();
        loadServicesData();
      } else {
        showToast(res.message || 'Restore failed', 'error');
      }
    }
  } catch (err) {
    showToast('Restore failed: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Yes, Restore System Now';
    }
  }
}

window.deleteBackup = async function(filename) {
  if (!confirm(`Are you sure you want to delete backup file "${filename}"? This cannot be undone.`)) return;

  try {
    const res = await api(`/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message || 'Backup deleted successfully', 'success');
      loadBackupsData();
    } else {
      showToast(res.message || 'Failed to delete backup', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function populateMappingModal() {
  loadServicesForFilters();
  const select = document.getElementById('map-provider-product-select');
  if (state.ldProducts && state.ldProducts.length > 0) {
    select.innerHTML = '<option value="">-- Select from Provider Catalog --</option>' + state.ldProducts.map(p => `
      <option value="${p.id}">${escapeHtml(p.name)} (${p.id}) - $${p.price || 0}</option>
    `).join('');
  }
}

// Global actions
window.openAddValidityModal = function(serviceId) {
  document.getElementById('modal-validity-title').textContent = 'Add Validity Plan';
  document.getElementById('val-service-id').value = serviceId;
  document.getElementById('val-is-edit').value = '0';
  document.getElementById('val-id-edit').value = '';
  document.getElementById('val-name-input').value = '';
  document.getElementById('val-price-input').value = '';
  document.getElementById('val-active-input').value = '1';
  openModal('modal-validity');
};

window.editServiceModal = function(serviceId) {
  const srv = state.services.find(s => s.id === serviceId);
  if (!srv) return;

  document.getElementById('modal-service-title').textContent = 'Edit Service';
  document.getElementById('service-is-edit').value = '1';
  document.getElementById('service-id-input').value = srv.id;
  document.getElementById('service-id-input').readOnly = true;
  document.getElementById('service-name-input').value = srv.name;
  document.getElementById('service-desc-input').value = srv.description || '';
  document.getElementById('service-active-input').value = String(srv.is_active);
  openModal('modal-service');
};

window.editValidityModal = function(serviceId, validityId) {
  const srv = state.services.find(s => s.id === serviceId);
  if (!srv) return;
  const val = srv.validities.find(v => v.id === validityId);
  if (!val) return;

  document.getElementById('modal-validity-title').textContent = 'Edit Validity Plan';
  document.getElementById('val-service-id').value = serviceId;
  document.getElementById('val-is-edit').value = '1';
  document.getElementById('val-id-edit').value = validityId;
  document.getElementById('val-name-input').value = val.name;
  document.getElementById('val-price-input').value = val.price;
  document.getElementById('val-active-input').value = String(val.is_active);
  openModal('modal-validity');
};

window.deleteService = async function(serviceId) {
  if (!confirm(`Are you sure you want to delete service "${serviceId}" and all its validities and licenses?`)) return;
  try {
    const res = await api(`/services/${serviceId}`, { method: 'DELETE' });
    showToast(res.message);
    loadServicesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteValidity = async function(validityId) {
  if (!confirm('Are you sure you want to delete this validity option?')) return;
  try {
    const res = await api(`/services/validities/${validityId}`, { method: 'DELETE' });
    showToast(res.message);
    loadServicesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteLicense = async function(licenseId) {
  if (!confirm('Delete this license key from inventory?')) return;
  try {
    const res = await api(`/licenses/${licenseId}`, { method: 'DELETE' });
    showToast(res.message);
    loadLicensesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteMapping = async function(mappingId) {
  if (!confirm('Remove this product API mapping?')) return;
  try {
    const res = await api(`/settings/ld/mappings/${mappingId}`, { method: 'DELETE' });
    showToast(res.message);
    loadLdApiData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.approvePayment = async function(paymentId) {
  if (!confirm('Approve this payment and credit the customer wallet balance?')) return;
  try {
    const res = await api(`/payments/${paymentId}/approve`, { method: 'POST' });
    showToast(res.message, res.success ? 'success' : 'error');
    loadPaymentsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.reconcileBinancePayment = async function(paymentId) {
  try {
    showToast('Querying Binance API for payment verification...', 'info');
    const res = await api(`/settings/payments/binance/reconcile/${paymentId}`, { method: 'POST' });
    showToast(res.message, res.success ? 'success' : 'warning');
    loadPaymentsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
