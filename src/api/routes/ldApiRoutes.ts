import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { mappingRepo } from '../../database/repositories/mappingRepo.js';
import { serviceRepo } from '../../database/repositories/serviceRepo.js';
import { validityRepo } from '../../database/repositories/validityRepo.js';
import { licenseApiService } from '../../services/licenseApiService.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const ldApiRoutes = Router();

// Get LD Config & Status
ldApiRoutes.get('/', requireAdmin, (req, res) => {
  const endpoint = licenseApiService.getEndpoint();
  const token = licenseApiService.getToken();

  return res.json({
    success: true,
    endpoint,
    tokenMasked: token ? token.slice(0, 4) + '...' + token.slice(-4) : '',
    isConfigured: licenseApiService.isConfigured()
  });
});

// Update LD Token / Endpoint
ldApiRoutes.post('/config', requireAdmin, (req, res) => {
  const { endpoint, token } = req.body;

  if (endpoint !== undefined && endpoint.trim()) {
    settingsRepo.set('ld_api_endpoint', endpoint.trim());
  }

  if (token !== undefined && token.trim() && !token.includes('...')) {
    settingsRepo.set('ld_api_token', token.trim());
    settingsRepo.set('ld_api_is_configured', 'true');
  }

  return res.json({
    success: true,
    message: 'License Dashboard API settings saved successfully!'
  });
});

// Test Connection
ldApiRoutes.post('/test', requireAdmin, async (req, res) => {
  const result = await licenseApiService.testConnection();
  return res.json({
    success: result.success,
    status: result.success ? 'API Connected / Working' : 'API Connection Failed',
    message: result.message,
    balance: result.balance,
    currency: result.currency
  });
});

// Check LD Balance
ldApiRoutes.get('/balance', requireAdmin, async (req, res) => {
  const result = await licenseApiService.checkBalance();
  return res.json(result);
});

// Fetch provider products
ldApiRoutes.get('/products', requireAdmin, async (req, res) => {
  const result = await licenseApiService.getProducts();
  return res.json(result);
});

// Get all API Mappings
ldApiRoutes.get('/mappings', requireAdmin, (req, res) => {
  const mappings = mappingRepo.getAll();
  return res.json({ success: true, mappings });
});

// Upsert API Mapping: (service_id, validity_id) <-> external_product_id
ldApiRoutes.post('/mappings', requireAdmin, (req, res) => {
  const { serviceId, validityId, externalProductId, externalProductName, isEnabled } = req.body;

  if (!serviceId || !validityId || !externalProductId) {
    return res.status(400).json({ success: false, message: 'Service ID, Validity ID, and External Product ID are required' });
  }

  const service = serviceRepo.getById(serviceId);
  if (!service) {
    return res.status(400).json({ success: false, message: 'Invalid Service ID' });
  }

  const validity = validityRepo.getById(validityId);
  if (!validity || validity.service_id !== serviceId) {
    return res.status(400).json({ success: false, message: 'Invalid Validity ID for selected service' });
  }

  try {
    const mapping = mappingRepo.upsert(
      serviceId,
      validityId,
      externalProductId,
      externalProductName || `Provider Product (${externalProductId})`,
      isEnabled ?? 1
    );

    return res.json({
      success: true,
      message: `Successfully mapped ${service.name} (${validity.name}) to external product ${externalProductId}`,
      mapping
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Delete API Mapping
ldApiRoutes.delete('/mappings/:id', requireAdmin, (req, res) => {
  try {
    mappingRepo.delete(String(req.params.id));
    return res.json({ success: true, message: 'Mapping removed successfully' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
