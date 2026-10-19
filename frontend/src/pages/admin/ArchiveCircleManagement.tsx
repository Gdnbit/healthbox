/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin workflow */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconPlus,
  IconRefresh,
  IconShieldLock,
  IconUserMinus,
} from '@tabler/icons-react';
import AdminLayout from '../../components/admin/AdminLayout';
import archiveCircleApi, {
  type ArchiveAdminSubject,
  type ArchiveCircle,
  type ArchiveCircleMember,
  type ArchiveCircleStatus,
} from '../../services/api/archiveCircleApi';
import logger from '../../services/logger';
import './archive-circle-management.css';

const circleStatusLabel: Record<ArchiveCircleStatus, string> = {
  active: '互见已启用',
  paused: '互见已暂停',
  archived: '已归档',
};

const memberStatusLabel: Record<ArchiveCircleMember['status'], string> = {
  active: '可互相查看',
  paused: '已暂停',
  removed: '已移除',
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const ArchiveCircleManagement = () => {
  const [circles, setCircles] = useState<ArchiveCircle[]>([]);
  const [subjects, setSubjects] = useState<ArchiveAdminSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newMembers, setNewMembers] = useState<Record<number, string | null>>(
    {}
  );
  const [moveTargets, setMoveTargets] = useState<Record<string, string | null>>(
    {}
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [circleResponse, subjectResponse] = await Promise.all([
        archiveCircleApi.listCircles(),
        archiveCircleApi.listAdminSubjects(),
      ]);
      setCircles(circleResponse.circles);
      setSubjects(subjectResponse.subjects);
    } catch (loadError) {
      logger.error('archive_circle_management_load_error', {
        component: 'ArchiveCircleManagement',
        error: errorMessage(loadError),
      });
      setError('无法载入档案互见设置，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTargets = useMemo(
    () =>
      circles
        .filter(circle => circle.status === 'active')
        .map(circle => ({
          value: String(circle.id),
          label: circle.name,
        })),
    [circles]
  );

  const mutate = async (key: string, operation: () => Promise<unknown>) => {
    if (busyKey) return;
    setBusyKey(key);
    setError('');
    try {
      await operation();
      await load();
    } catch (mutationError) {
      logger.error('archive_circle_management_mutation_error', {
        component: 'ArchiveCircleManagement',
        operation: key,
        error: errorMessage(mutationError),
      });
      setError(`操作没有完成：${errorMessage(mutationError)}`);
    } finally {
      setBusyKey('');
    }
  };

  const createCircle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;
    void mutate('create', async () => {
      await archiveCircleApi.createCircle(
        normalizedName,
        description.trim() || null
      );
      setName('');
      setDescription('');
    });
  };

  return (
    <AdminLayout>
      <div className="archive-circle-page">
        <Group justify="space-between" align="flex-start" gap="md">
          <div>
            <Text className="archive-circle-eyebrow">仅系统管理员可见</Text>
            <Title order={1}>档案互见管理</Title>
            <Text c="dimmed" mt={6}>
              在这里维护内部可见范围。普通成员只会看到“可查看的档案”，不会看到组名、分组关系或其他账号信息。
            </Text>
          </div>
          <Button
            variant="light"
            leftSection={<IconRefresh size={17} />}
            onClick={() => void load()}
            loading={loading}
          >
            刷新
          </Button>
        </Group>

        <Alert
          icon={<IconShieldLock size={19} />}
          color="blue"
          variant="light"
          title="固定共享边界"
        >
          同一启用组内的成员可以双向查看彼此的结构化指标和趋势；不共享报告原件、文字描述、导出、修改、AI
          分析或个性化提醒。重叠组不会产生跨组传递。
        </Alert>

        {error ? (
          <Alert
            icon={<IconAlertCircle size={19} />}
            color="red"
            title="需要处理"
          >
            {error}
          </Alert>
        ) : null}

        <Card withBorder radius="lg" padding="lg">
          <form onSubmit={createCircle}>
            <Stack gap="md">
              <div>
                <Title order={2}>新建内部组</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  名称仅供你管理使用，不会展示给普通成员。
                </Text>
              </div>
              <div className="archive-circle-create-grid">
                <TextInput
                  label="组名"
                  placeholder="例如：家人"
                  value={name}
                  onChange={event => setName(event.currentTarget.value)}
                  maxLength={80}
                  required
                />
                <Textarea
                  label="管理备注（可选）"
                  placeholder="记录该组的用途"
                  value={description}
                  onChange={event => setDescription(event.currentTarget.value)}
                  maxLength={240}
                  autosize
                  minRows={1}
                  maxRows={3}
                />
              </div>
              <Group justify="flex-end">
                <Button
                  type="submit"
                  leftSection={<IconPlus size={17} />}
                  loading={busyKey === 'create'}
                  disabled={!name.trim()}
                >
                  创建内部组
                </Button>
              </Group>
            </Stack>
          </form>
        </Card>

        {loading && circles.length === 0 ? (
          <div className="archive-circle-loading">
            <Loader />
            <Text c="dimmed">正在载入互见设置…</Text>
          </div>
        ) : circles.length === 0 ? (
          <Card withBorder radius="lg" padding="xl">
            <Stack align="center" gap="xs">
              <IconShieldLock size={30} />
              <Title order={3}>还没有内部组</Title>
              <Text c="dimmed" ta="center">
                创建后再加入成员；加入立即生效，不需要成员逐一确认。
              </Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap="lg">
            {circles.map(circle => {
              const currentPatientIds = new Set(
                circle.members
                  .filter(member => member.status !== 'removed')
                  .map(member => member.patient_id)
              );
              const addOptions = subjects
                .filter(
                  subject =>
                    subject.account_active &&
                    !currentPatientIds.has(subject.patient_id)
                )
                .map(subject => ({
                  value: String(subject.patient_id),
                  label: `${subject.display_name}（${subject.username}）`,
                }));

              return (
                <Card
                  key={circle.id}
                  withBorder
                  radius="lg"
                  padding="lg"
                  className="archive-circle-card"
                >
                  <Stack gap="lg">
                    <Group justify="space-between" align="flex-start" gap="md">
                      <div>
                        <Group gap="sm">
                          <Title order={2}>{circle.name}</Title>
                          <Badge
                            color={
                              circle.status === 'active'
                                ? 'teal'
                                : circle.status === 'paused'
                                  ? 'yellow'
                                  : 'gray'
                            }
                            variant="light"
                          >
                            {circleStatusLabel[circle.status]}
                          </Badge>
                        </Group>
                        {circle.description ? (
                          <Text c="dimmed" size="sm" mt={5}>
                            {circle.description}
                          </Text>
                        ) : null}
                      </div>
                      {circle.status !== 'archived' ? (
                        <Button
                          variant="light"
                          color={circle.status === 'active' ? 'yellow' : 'teal'}
                          loading={busyKey === `circle:${circle.id}`}
                          onClick={() =>
                            void mutate(`circle:${circle.id}`, () =>
                              archiveCircleApi.setCircleStatus(
                                circle.id,
                                circle.status === 'active' ? 'paused' : 'active'
                              )
                            )
                          }
                        >
                          {circle.status === 'active'
                            ? '暂停整组互见'
                            : '恢复整组互见'}
                        </Button>
                      ) : null}
                    </Group>

                    {circle.status === 'active' ? (
                      <Group align="flex-end" gap="sm">
                        <Select
                          label="添加成员"
                          placeholder={
                            addOptions.length
                              ? '选择一个账号档案'
                              : '没有可添加的档案'
                          }
                          data={addOptions}
                          searchable
                          value={newMembers[circle.id] || null}
                          onChange={value =>
                            setNewMembers(current => ({
                              ...current,
                              [circle.id]: value,
                            }))
                          }
                          className="archive-circle-member-select"
                          disabled={!addOptions.length}
                        />
                        <Button
                          variant="light"
                          leftSection={<IconPlus size={17} />}
                          disabled={!newMembers[circle.id]}
                          loading={busyKey === `add:${circle.id}`}
                          onClick={() => {
                            const patientId = Number(newMembers[circle.id]);
                            if (!patientId) return;
                            void mutate(`add:${circle.id}`, async () => {
                              await archiveCircleApi.addMember(
                                circle.id,
                                patientId
                              );
                              setNewMembers(current => ({
                                ...current,
                                [circle.id]: null,
                              }));
                            });
                          }}
                        >
                          加入并立即生效
                        </Button>
                      </Group>
                    ) : null}

                    <div className="archive-circle-members">
                      {circle.members.length ? (
                        circle.members.map(member => {
                          const memberKey = `${circle.id}:${member.patient_id}`;
                          const moveOptions = activeTargets.filter(
                            target => target.value !== String(circle.id)
                          );
                          return (
                            <div
                              className="archive-circle-member"
                              key={memberKey}
                            >
                              <div>
                                <Group gap="xs">
                                  <Text fw={650}>{member.display_name}</Text>
                                  <Badge
                                    size="sm"
                                    variant="dot"
                                    color={
                                      member.status === 'active'
                                        ? 'teal'
                                        : member.status === 'paused'
                                          ? 'yellow'
                                          : 'gray'
                                    }
                                  >
                                    {memberStatusLabel[member.status]}
                                  </Badge>
                                </Group>
                                <Text c="dimmed" size="xs" mt={3}>
                                  账号：{member.username}
                                  {!member.account_active
                                    ? ' · 账号已停用'
                                    : ''}
                                </Text>
                              </div>

                              {member.status !== 'removed' ? (
                                <div className="archive-circle-member-actions">
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    color={
                                      member.status === 'active'
                                        ? 'yellow'
                                        : 'teal'
                                    }
                                    loading={busyKey === `member:${memberKey}`}
                                    onClick={() =>
                                      void mutate(`member:${memberKey}`, () =>
                                        archiveCircleApi.setMembershipStatus(
                                          circle.id,
                                          member.patient_id,
                                          member.status === 'active'
                                            ? 'paused'
                                            : 'active'
                                        )
                                      )
                                    }
                                  >
                                    {member.status === 'active'
                                      ? '暂停'
                                      : '恢复'}
                                  </Button>
                                  <Select
                                    size="xs"
                                    aria-label={`移动 ${member.display_name}`}
                                    placeholder="移动到…"
                                    data={moveOptions}
                                    value={moveTargets[memberKey] || null}
                                    onChange={value =>
                                      setMoveTargets(current => ({
                                        ...current,
                                        [memberKey]: value,
                                      }))
                                    }
                                    disabled={!moveOptions.length}
                                    className="archive-circle-move-select"
                                  />
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    leftSection={
                                      <IconArrowsExchange size={15} />
                                    }
                                    disabled={!moveTargets[memberKey]}
                                    loading={busyKey === `move:${memberKey}`}
                                    onClick={() => {
                                      const targetCircleId = Number(
                                        moveTargets[memberKey]
                                      );
                                      if (!targetCircleId) return;
                                      void mutate(
                                        `move:${memberKey}`,
                                        async () => {
                                          await archiveCircleApi.moveMember(
                                            member.patient_id,
                                            circle.id,
                                            targetCircleId
                                          );
                                          setMoveTargets(current => ({
                                            ...current,
                                            [memberKey]: null,
                                          }));
                                        }
                                      );
                                    }}
                                  >
                                    移动
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    color="red"
                                    leftSection={<IconUserMinus size={15} />}
                                    loading={busyKey === `remove:${memberKey}`}
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          `确认将“${member.display_name}”移出“${circle.name}”吗？`
                                        )
                                      ) {
                                        return;
                                      }
                                      void mutate(`remove:${memberKey}`, () =>
                                        archiveCircleApi.removeMember(
                                          circle.id,
                                          member.patient_id
                                        )
                                      );
                                    }}
                                  >
                                    移除
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <Text c="dimmed" size="sm">
                          暂无成员。至少加入两人后才会产生彼此可见关系。
                        </Text>
                      )}
                    </div>
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}
      </div>
    </AdminLayout>
  );
};

export default ArchiveCircleManagement;
