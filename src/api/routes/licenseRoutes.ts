import { Router } from 'express';
import { licenseRepo } from '../../database/repositories/licenseRepo.js';
import { serviceRepo } from '../../database/repositories/serviceRepo.js';
import { validityRepo } from '../../database/repositories/validityRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const licenseRoutes = Router();

licenseRoutes.get('/', requireAdmin, (req, res) => {
  const { serviceId, validityId, isUsed, limit, offset, search } = req.query;

  const result = licenseRepo.list({
    serviceId: serviceId ? String(serviceId) : undefined,
    validityId: validityId ? String(validityId) : undefined,
    isUsed: isUsed !== undefined ? parseInt(String(isUsed), 10) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 50,
    offset: offset ? parseInt(String(offset), 10) : 0,
    search: search ? String(search) : undefined
  });

  return res.json({ success: true, ...result });
});

licenseRoutes.post('/bulk', requireAdmin, (req, res) => {
  const { serviceId, validityId, keysText } = req.body;

  if (!serviceId || !validityId || !keysText) {
    return res.status(400).json({ success: false, message: 'Service ID, Validity ID, and Keys Text are required' });
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
    const result = licenseRepo.addBulk(serviceId, validityId, keysText);
    return res.json({
      success: true,
      message: `Successfully added ${result.added} license keys!`,
      result
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

licenseRoutes.delete('/:id', requireAdmin, (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: 'Invalid ID' });
  }

  try {
    licenseRepo.delete(id);
    return res.json({ success: true, message: 'License key removed successfully' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
