import { describe, expect, it } from 'vitest';

import {
  SCREENING_EDUCATION_CATALOG,
  filterScreeningEducationTopics,
} from './screeningKnowledge';

describe('screening education knowledge catalog', () => {
  it('contains only versioned education-only topics and verified official source links', () => {
    expect(SCREENING_EDUCATION_CATALOG.catalogVersion).toBe(
      'household-screening-education@0.1.0'
    );
    expect(SCREENING_EDUCATION_CATALOG.personalizedPlanAvailable).toBe(false);
    expect(SCREENING_EDUCATION_CATALOG.topics.length).toBeGreaterThanOrEqual(8);

    for (const topic of SCREENING_EDUCATION_CATALOG.topics) {
      expect(topic.evidenceCategory).toBe('education_only');
      expect(topic.sources.length).toBeGreaterThan(0);
      expect(topic.contentVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(topic).not.toHaveProperty('interval');
      expect(topic).not.toHaveProperty('dueDate');
      expect(topic).not.toHaveProperty('eligibility');

      for (const source of topic.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.reviewStatus).toBe(
          'source_link_verified_medical_review_pending'
        );
        expect(source.retrievedAt).toBe('2026-07-28');
      }
    }
  });

  it('keeps sex-specific navigation separate while including shared topics', () => {
    const female = filterScreeningEducationTopics('female');
    const male = filterScreeningEducationTopics('male');
    const systemic = filterScreeningEducationTopics('systemic');

    expect(female.map(topic => topic.topicId)).toEqual(
      expect.arrayContaining(['breast', 'cervical', 'lung', 'colorectal'])
    );
    expect(female.map(topic => topic.topicId)).not.toContain('prostate');

    expect(male.map(topic => topic.topicId)).toEqual(
      expect.arrayContaining(['prostate', 'lung', 'colorectal'])
    );
    expect(male.map(topic => topic.topicId)).not.toContain('cervical');

    expect(
      systemic.every(topic => topic.anatomyLayers.includes('systemic'))
    ).toBe(true);
  });

  it('provides front and back navigation points without risk values', () => {
    const regions = SCREENING_EDUCATION_CATALOG.topics.flatMap(
      topic => topic.regions
    );

    expect(regions.some(region => region.orientation === 'front')).toBe(true);
    expect(regions.some(region => region.orientation === 'back')).toBe(true);
    expect(JSON.stringify(regions)).not.toMatch(
      /probability|riskScore|healthScore|dueDate/i
    );
  });

  it('keeps a source update state visible instead of treating an old page as current', () => {
    const prostate = SCREENING_EDUCATION_CATALOG.topics.find(
      topic => topic.topicId === 'prostate'
    );

    expect(prostate?.sources[0].sourceStatus).toBe('update_in_progress');
  });
});
