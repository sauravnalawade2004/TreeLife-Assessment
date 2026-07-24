import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticAiService } from '../src/services/ai/semantic-ai.service.js';

test('falls back to generic structural inference for unfamiliar records', async () => {
  const { facts } = await semanticAiService.extractFacts([
    {
      inputId: 'student-1',
      source: 'pipedrive',
      title: 'Student Enrollment',
      organization: 'Northview College',
      content: 'Student Name: Asha Rao\nCourse Enrolled: Data Science\nFee Status: Pending\nAssigned to Priya\nResponsible: Rina',
      customFields: {
        studentName: { value: 'Asha Rao' },
        courseEnrolled: { value: 'Data Science' },
        feeStatus: { value: 'Pending' }
      },
      notes: []
    }
  ]);

  assert.equal(facts[0].topic, 'student_enrollment');
  assert.equal(facts[0].lifecycleClaim, 'open');
  assert.equal(facts[0].ownerRaw, 'Priya');
});
