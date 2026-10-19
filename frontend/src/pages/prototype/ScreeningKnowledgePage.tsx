/* eslint-disable i18next/no-literal-string -- Chinese-first household health experience */
import { useMemo, useState } from 'react';
import {
  IconArrowLeft,
  IconBook2,
  IconExternalLink,
  IconInfoCircle,
  IconShieldCheck,
} from '@tabler/icons-react';

import {
  SCREENING_EDUCATION_CATALOG,
  filterScreeningEducationTopics,
  type ScreeningAnatomyLayer,
  type ScreeningBodyOrientation,
  type ScreeningEducationTopic,
} from '../../features/householdHealth/screeningKnowledge';
import './ScreeningKnowledgePage.css';

const LAYER_OPTIONS: Array<{
  value: ScreeningAnatomyLayer;
  label: string;
  description: string;
}> = [
  { value: 'female', label: '女性', description: '女性与通用主题' },
  { value: 'male', label: '男性', description: '男性与通用主题' },
  { value: 'shared', label: '通用', description: '不按性别区分的主题' },
  { value: 'systemic', label: '全身', description: '全身与基础筛查原则' },
];

const ORIENTATION_OPTIONS: Array<{
  value: ScreeningBodyOrientation;
  label: string;
}> = [
  { value: 'front', label: '正面' },
  { value: 'back', label: '背面' },
];

function BodyOutline({
  layer,
  orientation,
  topics,
  selectedTopicId,
  onSelect,
}: {
  layer: ScreeningAnatomyLayer;
  orientation: ScreeningBodyOrientation;
  topics: ScreeningEducationTopic[];
  selectedTopicId: string;
  onSelect: (_topicId: string) => void;
}) {
  const points = topics.flatMap(topic =>
    topic.regions
      .filter(region => region.orientation === orientation)
      .map(region => ({ ...region, topic }))
  );
  const isFemale = layer === 'female';

  return (
    <div className="hhp-screening-body-stage">
      <span className="hhp-screening-body-caption">
        {isFemale ? '女性' : layer === 'male' ? '男性' : '通用'} ·
        {orientation === 'front' ? ' 正面' : ' 背面'}
      </span>
      <svg
        viewBox="0 0 100 150"
        className="hhp-screening-body"
        aria-label={`${isFemale ? '女性' : layer === 'male' ? '男性' : '通用'}人体${orientation === 'front' ? '正面' : '背面'}资料导航`}
      >
        <circle className="hhp-screening-body-shape" cx="50" cy="14" r="10" />
        <path
          className="hhp-screening-body-shape"
          d={
            isFemale
              ? 'M38 28 C32 39 34 57 39 68 L34 94 L44 94 L45 137 L50 137 L55 94 L66 94 L61 68 C66 57 68 39 62 28 Z'
              : 'M35 28 L29 62 L39 65 L41 92 L45 137 L50 137 L55 92 L61 65 L71 62 L65 28 Z'
          }
        />
        <path
          className="hhp-screening-body-limb"
          d="M37 33 L22 75 M63 33 L78 75"
        />
        <path
          className="hhp-screening-body-limb"
          d="M45 92 L36 139 M55 92 L64 139"
        />
        {orientation === 'back' ? (
          <path className="hhp-screening-body-detail" d="M50 28 L50 90" />
        ) : (
          <path className="hhp-screening-body-detail" d="M43 46 Q50 51 57 46" />
        )}
        {points.map(point => (
          <g
            key={`${point.topic.topicId}-${point.regionId}-${point.orientation}`}
            role="button"
            tabIndex={0}
            aria-label={`人体图主题：${point.topic.titleZh}`}
            className={`hhp-screening-hotspot ${
              selectedTopicId === point.topic.topicId ? 'is-selected' : ''
            }`}
            onClick={() => onSelect(point.topic.topicId)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(point.topic.topicId);
              }
            }}
          >
            <circle cx={point.x} cy={point.y} r="5.8" />
            <text x={point.x} y={point.y + 1.6} textAnchor="middle">
              {point.topic.shortLabel.slice(0, 1)}
            </text>
          </g>
        ))}
      </svg>
      <p>
        <IconInfoCircle size={17} />
        人体图仅用于查找资料，不代表患病风险
      </p>
    </div>
  );
}

export default function ScreeningKnowledgePage({
  onBack,
}: {
  onBack: () => void;
}) {
  const [layer, setLayer] = useState<ScreeningAnatomyLayer>('female');
  const [orientation, setOrientation] =
    useState<ScreeningBodyOrientation>('front');
  const [selectedTopicId, setSelectedTopicId] = useState('breast');

  const topics = useMemo(() => filterScreeningEducationTopics(layer), [layer]);
  const selectedTopic =
    topics.find(topic => topic.topicId === selectedTopicId) ?? topics[0];
  const selectedLayer = LAYER_OPTIONS.find(option => option.value === layer);

  const chooseLayer = (nextLayer: ScreeningAnatomyLayer) => {
    const nextTopics = filterScreeningEducationTopics(nextLayer);
    setLayer(nextLayer);
    setSelectedTopicId(nextTopics[0]?.topicId ?? '');
  };

  return (
    <section
      className="hhp-page hhp-screening-page"
      aria-labelledby="screening-knowledge-title"
    >
      <div className="hhp-screening-heading">
        <button type="button" className="hhp-screening-back" onClick={onBack}>
          <IconArrowLeft size={20} />
          返回更多
        </button>
        <div>
          <p className="hhp-eyebrow">教育资料与权威原链接</p>
          <h1 id="screening-knowledge-title">身体与筛查资料</h1>
          <p>
            按身体部位和全身主题查找资料。这里不判断你是否需要检查，也不计算到期时间。
          </p>
        </div>
      </div>

      <div className="hhp-screening-review-gate" role="status">
        <span>
          <IconShieldCheck size={22} />
        </span>
        <div>
          <strong>当前未启用个性化筛查计划</strong>
          <p>
            官方来源链接已经核对，但尚未完成医学规则复核。系统不会根据年龄、性别或既往报告生成检查周期。
          </p>
        </div>
      </div>

      <div
        className="hhp-screening-layer-tabs"
        role="group"
        aria-label="选择资料导航视图"
      >
        {LAYER_OPTIONS.map(option => (
          <button
            type="button"
            key={option.value}
            className={layer === option.value ? 'is-active' : ''}
            aria-pressed={layer === option.value}
            onClick={() => chooseLayer(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="hhp-screening-layer-description">
        当前显示：{selectedLayer?.description}
      </p>

      <div className="hhp-screening-layout">
        <article className="hhp-card hhp-screening-navigator">
          <div className="hhp-screening-card-heading">
            <div>
              <p className="hhp-eyebrow">身体导航</p>
              <h2>{layer === 'systemic' ? '全身主题' : '选择一个部位'}</h2>
            </div>
            {layer !== 'systemic' ? (
              <div
                className="hhp-screening-orientation"
                role="group"
                aria-label="选择人体方向"
              >
                {ORIENTATION_OPTIONS.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={orientation === option.value ? 'is-active' : ''}
                    aria-pressed={orientation === option.value}
                    onClick={() => setOrientation(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {layer !== 'systemic' ? (
            <BodyOutline
              layer={layer}
              orientation={orientation}
              topics={topics}
              selectedTopicId={selectedTopic?.topicId ?? ''}
              onSelect={setSelectedTopicId}
            />
          ) : (
            <div className="hhp-screening-systemic-visual" aria-hidden="true">
              <IconBook2 size={46} />
              <strong>全身与基础原则</strong>
              <span>这些主题不能可靠地固定到单一身体部位</span>
            </div>
          )}

          <div className="hhp-screening-topic-list">
            <div>
              <strong>等价主题列表</strong>
              <span>可用键盘和读屏直接操作</span>
            </div>
            {topics.map(topicItem => (
              <button
                type="button"
                key={topicItem.topicId}
                className={
                  selectedTopic?.topicId === topicItem.topicId
                    ? 'is-selected'
                    : ''
                }
                aria-label={`打开主题：${topicItem.titleZh}`}
                onClick={() => setSelectedTopicId(topicItem.topicId)}
              >
                <span>{topicItem.shortLabel}</span>
                <small>{topicItem.sources.length} 个官方来源</small>
              </button>
            ))}
          </div>
        </article>

        <article className="hhp-card hhp-screening-topic-detail">
          {selectedTopic ? (
            <>
              <div className="hhp-screening-detail-heading">
                <span>
                  <IconBook2 size={24} />
                </span>
                <div>
                  <small>资料导航 · 待医学复核</small>
                  <h2>{selectedTopic.titleZh}</h2>
                </div>
              </div>
              <p className="hhp-screening-topic-summary">
                {selectedTopic.summaryZh}
              </p>

              <div className="hhp-screening-source-list">
                <h3>权威来源</h3>
                {selectedTopic.sources.map(source => (
                  <div key={source.sourceId}>
                    <span>
                      {source.region} · {source.institution}
                    </span>
                    <strong>{source.title}</strong>
                    <small>
                      发布 {source.publishedAt} · 获取 {source.retrievedAt} ·
                      {source.sourceStatus === 'update_in_progress'
                        ? ' 来源正在更新'
                        : ' 当前来源页'}
                    </small>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`查看${source.institution}原文`}
                    >
                      查看官方原文
                      <IconExternalLink size={17} />
                    </a>
                  </div>
                ))}
              </div>

              <div className="hhp-screening-safety-note">
                <IconInfoCircle size={20} />
                <p>
                  筛查不是诊断，正常或未到期也不代表没有疾病。如有症状、既往异常或新的健康顾虑，应咨询专业人员。
                </p>
              </div>
              <p className="hhp-screening-version">
                目录版本：{SCREENING_EDUCATION_CATALOG.catalogVersion}
              </p>
            </>
          ) : (
            <p>当前视图暂无可展示的教育主题。</p>
          )}
        </article>
      </div>
    </section>
  );
}
