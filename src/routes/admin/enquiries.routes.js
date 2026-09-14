import { Router } from 'express';
import { z } from 'zod';
import { validate, zId } from '../../middleware/validate.js';
import * as contentRepo from '../../repositories/content.repo.js';
import * as patientsRepo from '../../repositories/patients.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { ENQUIRY_STATUS } from '../../config/constants.js';
import { normalisePhone } from '../../utils/format.js';

const router = Router();

router.get('/', validate(z.object({
  status: z.enum(ENQUIRY_STATUS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}), 'query'), (req, res) => {
  const { status, limit, offset } = req.validatedQuery;
  res.json({
    rows: contentRepo.listEnquiries({ status, limit, offset }),
    new_count: contentRepo.newEnquiryCount(),
  });
});

router.put('/:id', validate(z.object({
  status: z.enum(ENQUIRY_STATUS).optional(),
  notes: z.string().trim().max(2000).nullish(),
  assigned_to: zId.nullish(),
})), (req, res) => {
  const id = Number(req.params.id);
  const before = contentRepo.findEnquiry(id);
  if (!before) return res.status(404).json({ error: 'Enquiry not found.', code: 'NOT_FOUND' });

  const fields = { ...req.body };
  if (fields.status === 'contacted' && !before.contacted_at) {
    fields.contacted_at = new Date().toISOString();
  }
  contentRepo.updateEnquiry(id, fields);
  const after = contentRepo.findEnquiry(id);
  audit(ctxFrom(req), {
    action: 'enquiry.update', entity: 'enquiry', entity_id: id,
    summary: `Enquiry from ${after.name} marked ${after.status}`,
    before: { status: before.status }, after: { status: after.status },
  });
  res.json({ ok: true, enquiry: after });
});

/** Turn an enquiry into a patient record. */
router.post('/:id/convert', (req, res) => {
  const id = Number(req.params.id);
  const enquiry = contentRepo.findEnquiry(id);
  if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.', code: 'NOT_FOUND' });

  const phone = normalisePhone(enquiry.phone);
  if (!phone) return res.status(400).json({ error: 'This enquiry has no valid mobile number.', code: 'INVALID_PHONE' });

  const { patient } = patientsRepo.upsertByPhone({
    name: enquiry.name, phone, email: enquiry.email, createdBy: req.user.id,
  });
  contentRepo.updateEnquiry(id, { status: 'converted', converted_patient_id: patient.id });
  audit(ctxFrom(req), {
    action: 'enquiry.convert', entity: 'enquiry', entity_id: id,
    summary: `Converted enquiry from ${enquiry.name} to patient ${patient.code}`,
  });
  res.json({ ok: true, patient });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = contentRepo.findEnquiry(id);
  if (!before) return res.status(404).json({ error: 'Enquiry not found.', code: 'NOT_FOUND' });
  contentRepo.deleteEnquiry(id);
  audit(ctxFrom(req), {
    action: 'enquiry.delete', entity: 'enquiry', entity_id: id,
    summary: `Deleted enquiry from ${before.name}`,
  });
  res.json({ ok: true });
});

export default router;
