export type ScreeningAnatomyLayer = 'female' | 'male' | 'shared' | 'systemic';
export type ScreeningBodyOrientation = 'front' | 'back';

export interface ScreeningEducationSource {
  sourceId: string;
  institution: string;
  region: string;
  title: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  sourceStatus: 'current' | 'update_in_progress';
  reviewStatus: 'source_link_verified_medical_review_pending';
}

export interface ScreeningTopicRegion {
  regionId: string;
  orientation: ScreeningBodyOrientation;
  x: number;
  y: number;
}

export interface ScreeningEducationTopic {
  topicId: string;
  titleZh: string;
  shortLabel: string;
  summaryZh: string;
  anatomyLayers: ScreeningAnatomyLayer[];
  regionIds: string[];
  regions: ScreeningTopicRegion[];
  contentVersion: string;
  evidenceCategory: 'education_only';
  sources: ScreeningEducationSource[];
}

export interface ScreeningEducationCatalog {
  catalogVersion: string;
  retrievedAt: string;
  personalizedPlanAvailable: false;
  personalizedUnavailableReason: 'medical_review_required';
  topics: ScreeningEducationTopic[];
}

const pendingSource = (
  source: Omit<ScreeningEducationSource, 'retrievedAt' | 'reviewStatus'>
): ScreeningEducationSource => ({
  ...source,
  retrievedAt: '2026-07-28',
  reviewStatus: 'source_link_verified_medical_review_pending',
});

const nhcLungColorectal = pendingSource({
  sourceId: 'nhc-lung-colorectal-2024',
  institution: '国家卫生健康委员会',
  region: '中国大陆',
  title:
    '肺癌筛查与早诊早治方案（2024年版）和结直肠癌筛查与早诊早治方案（2024年版）',
  url: 'https://www.nhc.gov.cn/ylyjs/gzdt/202408/42f43b5f0c4c4ebe90c78ee127959b92.shtml',
  publishedAt: '2024-08-27',
  sourceStatus: 'current',
});

const nhcUpperDigestive = pendingSource({
  sourceId: 'nhc-upper-digestive-2024',
  institution: '国家卫生健康委员会',
  region: '中国大陆',
  title:
    '食管癌筛查与早诊早治方案（2024年版）和胃癌筛查与早诊早治方案（2024年版）',
  url: 'https://www.nhc.gov.cn/ylyjs/gzdt/202406/2bb28e7a39ce4734bee4e31ff5442e0f.shtml',
  publishedAt: '2024-06-21',
  sourceStatus: 'current',
});

const nhcCervicalBreast = pendingSource({
  sourceId: 'nhc-cervical-breast-2021',
  institution: '国家卫生健康委员会',
  region: '中国大陆',
  title: '宫颈癌筛查工作方案和乳腺癌筛查工作方案',
  url: 'https://www.nhc.gov.cn/fys/c100078/202201/e4209b0a6e604f6aba3e793d8eddebf3.shtml',
  publishedAt: '2022-01-18',
  sourceStatus: 'current',
});

const uspstfProstate = pendingSource({
  sourceId: 'uspstf-prostate-2018',
  institution: '美国预防服务工作组（USPSTF）',
  region: '美国',
  title: 'Prostate Cancer: Screening',
  url: 'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prostate-cancer-screening',
  publishedAt: '2018-05-08',
  sourceStatus: 'update_in_progress',
});

const uspstfOsteoporosis = pendingSource({
  sourceId: 'uspstf-osteoporosis-2025',
  institution: '美国预防服务工作组（USPSTF）',
  region: '美国',
  title: 'Osteoporosis to Prevent Fractures: Screening',
  url: 'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/osteoporosis-screening',
  publishedAt: '2025-01-14',
  sourceStatus: 'current',
});

const whoScreeningPrinciples = pendingSource({
  sourceId: 'who-cancer-screening-guide-2022',
  institution: '世界卫生组织（WHO）',
  region: '国际',
  title:
    'A short guide to cancer screening: increase effectiveness, maximize benefits and minimize harm',
  url: 'https://www.who.int/publications/i/item/9789289057561',
  publishedAt: '2022-02-01',
  sourceStatus: 'current',
});

const topic = (
  value: Omit<
    ScreeningEducationTopic,
    'contentVersion' | 'evidenceCategory' | 'regionIds'
  >
): ScreeningEducationTopic => ({
  ...value,
  regionIds: [...new Set(value.regions.map(region => region.regionId))],
  contentVersion: '0.1.0',
  evidenceCategory: 'education_only',
});

export const SCREENING_EDUCATION_CATALOG: ScreeningEducationCatalog = {
  catalogVersion: 'household-screening-education@0.1.0',
  retrievedAt: '2026-07-28',
  personalizedPlanAvailable: false,
  personalizedUnavailableReason: 'medical_review_required',
  topics: [
    topic({
      topicId: 'lung',
      titleZh: '肺部筛查资料',
      shortLabel: '肺部',
      summaryZh: '查看肺部相关筛查方案的官方原文和版本信息。',
      anatomyLayers: ['shared'],
      regions: [
        { regionId: 'chest', orientation: 'front', x: 50, y: 35 },
        { regionId: 'upper-back', orientation: 'back', x: 50, y: 35 },
      ],
      sources: [nhcLungColorectal],
    }),
    topic({
      topicId: 'breast',
      titleZh: '乳腺筛查资料',
      shortLabel: '乳腺',
      summaryZh: '查看乳腺筛查工作方案的官方原文和版本信息。',
      anatomyLayers: ['female'],
      regions: [{ regionId: 'chest', orientation: 'front', x: 39, y: 38 }],
      sources: [nhcCervicalBreast],
    }),
    topic({
      topicId: 'cervical',
      titleZh: '宫颈筛查资料',
      shortLabel: '宫颈',
      summaryZh: '查看宫颈筛查工作方案的官方原文和版本信息。',
      anatomyLayers: ['female'],
      regions: [{ regionId: 'pelvis', orientation: 'front', x: 50, y: 66 }],
      sources: [nhcCervicalBreast],
    }),
    topic({
      topicId: 'colorectal',
      titleZh: '结直肠筛查资料',
      shortLabel: '结直肠',
      summaryZh: '查看结直肠相关筛查方案的官方原文和版本信息。',
      anatomyLayers: ['shared'],
      regions: [
        { regionId: 'lower-abdomen', orientation: 'front', x: 50, y: 57 },
        { regionId: 'lower-back', orientation: 'back', x: 50, y: 57 },
      ],
      sources: [nhcLungColorectal],
    }),
    topic({
      topicId: 'upper-digestive',
      titleZh: '食管与胃筛查资料',
      shortLabel: '食管与胃',
      summaryZh: '查看食管和胃筛查方案的官方原文和版本信息。',
      anatomyLayers: ['shared'],
      regions: [
        { regionId: 'upper-abdomen', orientation: 'front', x: 50, y: 47 },
      ],
      sources: [nhcUpperDigestive],
    }),
    topic({
      topicId: 'prostate',
      titleZh: '前列腺筛查资料',
      shortLabel: '前列腺',
      summaryZh: '查看前列腺筛查建议的官方原文和版本信息。',
      anatomyLayers: ['male'],
      regions: [{ regionId: 'pelvis', orientation: 'front', x: 50, y: 68 }],
      sources: [uspstfProstate],
    }),
    topic({
      topicId: 'bone-health',
      titleZh: '骨骼健康筛查资料',
      shortLabel: '骨骼健康',
      summaryZh: '查看骨质疏松筛查建议的官方原文和版本信息。',
      anatomyLayers: ['systemic'],
      regions: [],
      sources: [uspstfOsteoporosis],
    }),
    topic({
      topicId: 'screening-principles',
      titleZh: '筛查原则与局限',
      shortLabel: '筛查原则',
      summaryZh: '了解筛查、诊断、获益、伤害和局限之间的基本区别。',
      anatomyLayers: ['systemic'],
      regions: [],
      sources: [whoScreeningPrinciples],
    }),
  ],
};

export function filterScreeningEducationTopics(
  layer: ScreeningAnatomyLayer
): ScreeningEducationTopic[] {
  return SCREENING_EDUCATION_CATALOG.topics.filter(topicItem => {
    if (layer === 'female') {
      return (
        topicItem.anatomyLayers.includes('female') ||
        topicItem.anatomyLayers.includes('shared')
      );
    }
    if (layer === 'male') {
      return (
        topicItem.anatomyLayers.includes('male') ||
        topicItem.anatomyLayers.includes('shared')
      );
    }
    return topicItem.anatomyLayers.includes(layer);
  });
}
