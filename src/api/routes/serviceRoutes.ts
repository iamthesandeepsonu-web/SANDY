import { Router } from 'express';
import { serviceRepo } from '../../database/repositories/serviceRepo.js';
import { validityRepo } from '../../database/repositories/validityRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const serviceRoutes = Router();

// Public / User access: List active services & validities
serviceRoutes.get('/catalog', (req, res) => {
  const services = serviceRepo.getAll(true);
  const catalog = services.map(srv => {
    const validities = validityRepo.getByServiceIdWithStock(srv.id, true);
    return {
      ...srv,
      validities
    };
  });
  return res.json({ success: true, catalog });
});

// Admin access: Full CRUD
serviceRoutes.get('/', requireAdmin, (req, res) => {
  const services = serviceRepo.getAllWithStats();
  const fullList = services.map(srv => {
    const validities = validityRepo.getByServiceIdWithStock(srv.id, false);
    return {
      ...srv,
      validities
    };
  });
  return res.json({ success: true, services: fullList });
});

serviceRoutes.post('/', requireAdmin, (req, res) => {
  const { id, name, description, is_active, sort_order } = req.body;

  if (!id || !name) {
    return res.status(400).json({ success: false, message: 'Service ID and Name are required' });
  }

  try {
    const service = serviceRepo.create(id, name, description, is_active ?? 1, sort_order ?? 0);
    return res.json({ success: true, service });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

serviceRoutes.put('/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const { name, description, is_active, sort_order } = req.body;

  try {
    const updated = serviceRepo.update(id, { name, description, is_active, sort_order });
    return res.json({ success: true, service: updated });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

serviceRoutes.delete('/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  try {
    serviceRepo.delete(id);
    return res.json({ success: true, message: 'Service deleted successfully' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Validities sub-endpoints
serviceRoutes.post('/:serviceId/validities', requireAdmin, (req, res) => {
  const serviceId = String(req.params.serviceId);
  const { id, name, price, is_active, sort_order } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ success: false, message: 'Validity Name and Price are required' });
  }

  const numPrice = parseFloat(price);
  if (isNaN(numPrice) || numPrice < 0) {
    return res.status(400).json({ success: false, message: 'Price must be a valid positive number' });
  }

  try {
    const validity = validityRepo.create(serviceId, name, numPrice, id, is_active ?? 1, sort_order ?? 0);
    return res.json({ success: true, validity });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

serviceRoutes.put('/validities/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const { name, price, is_active, sort_order } = req.body;

  try {
    const numPrice = price !== undefined ? parseFloat(price) : undefined;
    const updated = validityRepo.update(id, { name, price: numPrice, is_active, sort_order });
    return res.json({ success: true, validity: updated });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

serviceRoutes.delete('/validities/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  try {
    validityRepo.delete(id);
    return res.json({ success: true, message: 'Validity deleted successfully' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
