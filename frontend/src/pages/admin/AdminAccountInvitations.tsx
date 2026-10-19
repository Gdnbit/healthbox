/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin workflow */
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconCopy,
  IconLink,
  IconRefresh,
  IconShieldLock,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import AdminLayout from '../../components/admin/AdminLayout';
import accountInvitationApi, {
  type AccountInvitation,
  type AccountInvitationStatus,
} from '../../services/api/accountInvitationApi';
import './admin-account-invitations.css';

const statusPresentation: Record<
  AccountInvitationStatus,
  { label: string; color: string }
> = {
  pending: { label: '等待激活', color: 'teal' },
  activated: { label: '已经激活', color: 'blue' },
  declined: { label: '对方未加入', color: 'gray' },
  cancelled: { label: '已经撤销', color: 'red' },
  expired: { label: '已经过期', color: 'orange' },
};

const expiryOptions = [
  { value: '24', label: '24 小时' },
  { value: '72', label: '3 天（推荐）' },
  { value: '168', label: '7 天' },
];

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const AdminAccountInvitations = () => {
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [recipientLabel, setRecipientLabel] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<24 | 72 | 168>(72);
  const [generatedLink, setGeneratedLink] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AccountInvitation | null>(
    null
  );
  const [cancelReason, setCancelReason] = useState('');
  const generatedLinkInput = useRef<HTMLInputElement>(null);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await accountInvitationApi.listInvitations();
      setInvitations(response.items);
    } catch {
      setError('暂时无法载入邀请记录，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLabel = recipientLabel.trim();
    if (normalizedLabel.length < 2 || creating) return;

    setCreating(true);
    setError('');
    setGeneratedLink('');
    setCopyStatus('');
    try {
      const response = await accountInvitationApi.createInvitation({
        recipient_label: normalizedLabel,
        expires_in_hours: expiresInHours,
      });
      const absoluteLink = new URL(
        response.activation_path,
        window.location.origin
      ).toString();
      setGeneratedLink(absoluteLink);
      setInvitations(current => [
        response.invitation,
        ...current.filter(item => item.id !== response.invitation.id),
      ]);
      setRecipientLabel('');
    } catch {
      setError('没有生成邀请链接，请检查账号容量后再试。');
    } finally {
      setCreating(false);
    }
  };

  const copyGeneratedLink = async () => {
    if (!generatedLink) return;
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopyStatus('链接已复制，可以直接发给受邀成员。');
    } catch {
      generatedLinkInput.current?.focus();
      generatedLinkInput.current?.select();
      setCopyStatus('自动复制失败，链接已选中，请手动复制。');
    }
  };

  const cancelInvitation = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3 || cancelling) {
      return;
    }
    setCancelling(true);
    setError('');
    try {
      const updated = await accountInvitationApi.cancelInvitation(
        cancelTarget.id,
        cancelReason.trim()
      );
      setInvitations(current =>
        current.map(item => (item.id === updated.id ? updated : item))
      );
      setCancelTarget(null);
      setCancelReason('');
    } catch {
      setError('没有撤销这份邀请，请刷新页面后再试。');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AdminLayout>
      <div className="health-prototype account-invitation-page">
        <header className="account-invitation-page__header">
          <div>
            <Text className="account-invitation-page__eyebrow">
              仅系统管理员可见
            </Text>
            <Title order={1}>成员邀请</Title>
            <Text className="account-invitation-page__intro">
              为家人或朋友生成一次性链接，由对方自行填写账号资料并确认隐私说明。
            </Text>
          </div>
          <Button
            variant="light"
            leftSection={<IconRefresh size={18} aria-hidden="true" />}
            onClick={() => void loadInvitations()}
            loading={loading}
          >
            刷新记录
          </Button>
        </header>

        <Alert
          className="account-invitation-page__boundary"
          icon={<IconShieldLock size={20} aria-hidden="true" />}
          title="账号创建与共享范围分开处理"
          color="teal"
          variant="light"
        >
          激活只会创建成员自己的账号和健康档案，不会自动建立任何互见关系；共享范围需要由你在档案互见管理中另行配置。
        </Alert>

        {error ? (
          <Alert
            icon={<IconAlertCircle size={20} aria-hidden="true" />}
            color="red"
            title="这次操作没有完成"
          >
            {error}
          </Alert>
        ) : null}

        <Card
          component="section"
          withBorder
          radius="lg"
          padding="xl"
          className="account-invitation-page__create-card"
        >
          <form onSubmit={event => void createInvitation(event)}>
            <Stack gap="lg">
              <div>
                <Group gap="sm">
                  <IconUserPlus size={24} aria-hidden="true" />
                  <Title order={2}>生成一份新邀请</Title>
                </Group>
                <Text c="dimmed" size="sm" mt={6}>
                  备注只供你辨认邀请对象，不会作为对方的显示名。
                </Text>
              </div>

              <div className="account-invitation-page__form-grid">
                <TextInput
                  label="成员备注"
                  aria-label="成员备注"
                  placeholder="例如：妈妈、朋友小李"
                  value={recipientLabel}
                  onChange={event =>
                    setRecipientLabel(event.currentTarget.value)
                  }
                  minLength={2}
                  maxLength={100}
                  required
                />
                <Select
                  label="链接有效期"
                  aria-label="链接有效期"
                  data={expiryOptions}
                  value={String(expiresInHours)}
                  onChange={value =>
                    setExpiresInHours(Number(value || 72) as 24 | 72 | 168)
                  }
                  allowDeselect={false}
                />
              </div>

              <Group justify="flex-end">
                <Button
                  type="submit"
                  leftSection={<IconLink size={18} aria-hidden="true" />}
                  loading={creating}
                  disabled={recipientLabel.trim().length < 2}
                >
                  生成邀请链接
                </Button>
              </Group>
            </Stack>
          </form>
        </Card>

        {generatedLink ? (
          <Card
            component="section"
            withBorder
            radius="lg"
            padding="xl"
            className="account-invitation-page__secret-card"
          >
            <Stack gap="md">
              <div>
                <Group gap="sm">
                  <IconCheck size={22} aria-hidden="true" />
                  <Title order={2}>链接只在本次显示</Title>
                </Group>
                <Text size="sm" mt={6}>
                  复制后发给对应成员。离开或刷新本页后，系统不会再次展示这段链接。
                </Text>
              </div>
              <div className="account-invitation-page__copy-row">
                <TextInput
                  ref={generatedLinkInput}
                  label="新生成的激活链接"
                  aria-label="新生成的激活链接"
                  value={generatedLink}
                  readOnly
                />
                <Button
                  type="button"
                  leftSection={<IconCopy size={18} aria-hidden="true" />}
                  onClick={() => void copyGeneratedLink()}
                >
                  复制链接
                </Button>
              </div>
              {copyStatus ? (
                <Text size="sm" role="status">
                  {copyStatus}
                </Text>
              ) : null}
            </Stack>
          </Card>
        ) : null}

        <section className="account-invitation-page__records">
          <div className="account-invitation-page__section-heading">
            <div>
              <Title order={2}>邀请记录</Title>
              <Text c="dimmed" size="sm" mt={4}>
                这里只保留状态和管理备注，不会保存可重复使用的邀请密钥。
              </Text>
            </div>
            <Badge variant="light" color="gray">
              共 {invitations.length} 份
            </Badge>
          </div>

          {loading && invitations.length === 0 ? (
            <div className="account-invitation-page__empty">
              <Loader size="sm" />
              <Text c="dimmed">正在载入邀请记录…</Text>
            </div>
          ) : invitations.length === 0 ? (
            <div className="account-invitation-page__empty">
              <IconLink size={28} aria-hidden="true" />
              <Text fw={650}>还没有邀请记录</Text>
              <Text c="dimmed" size="sm">
                生成第一份邀请后会显示在这里。
              </Text>
            </div>
          ) : (
            <div className="account-invitation-page__record-grid">
              {invitations.map(invitation => {
                const presentation = statusPresentation[invitation.status];
                return (
                  <Card
                    key={invitation.id}
                    withBorder
                    radius="lg"
                    padding="lg"
                    className="account-invitation-page__record"
                  >
                    <Stack gap="md">
                      <Group
                        justify="space-between"
                        align="flex-start"
                        gap="sm"
                        wrap="nowrap"
                      >
                        <div>
                          <Text fw={700}>{invitation.recipient_label}</Text>
                          <Text c="dimmed" size="xs" mt={3}>
                            创建于 {formatDateTime(invitation.created_at)}
                          </Text>
                        </div>
                        <Badge
                          color={presentation.color}
                          variant="light"
                          className="account-invitation-page__status"
                        >
                          {presentation.label}
                        </Badge>
                      </Group>

                      {invitation.status === 'activated' &&
                      invitation.activated_member ? (
                        <Text size="sm">
                          已创建账号：
                          {invitation.activated_member.display_name}（
                          {invitation.activated_member.username}）
                        </Text>
                      ) : (
                        <Group gap={6}>
                          <IconClock size={16} aria-hidden="true" />
                          <Text size="sm" c="dimmed">
                            有效至 {formatDateTime(invitation.expires_at)}
                          </Text>
                        </Group>
                      )}

                      {invitation.status === 'pending' ? (
                        <Button
                          type="button"
                          variant="subtle"
                          color="red"
                          leftSection={<IconX size={17} aria-hidden="true" />}
                          onClick={() => {
                            setCancelTarget(invitation);
                            setCancelReason('');
                          }}
                        >
                          撤销邀请
                        </Button>
                      ) : null}
                    </Stack>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <Modal
          opened={Boolean(cancelTarget)}
          onClose={() => {
            if (cancelling) return;
            setCancelTarget(null);
            setCancelReason('');
          }}
          title="确认撤销这份邀请？"
          centered
        >
          <Stack gap="md">
            <Text size="sm">
              撤销后原链接会立即失效，且无法恢复。已经激活的账号不受影响。
            </Text>
            <Textarea
              label="撤销原因"
              aria-label="撤销原因"
              placeholder="至少填写 3 个字"
              value={cancelReason}
              onChange={event => setCancelReason(event.currentTarget.value)}
              minLength={3}
              maxLength={200}
              autosize
              minRows={3}
              required
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                disabled={cancelling}
              >
                返回
              </Button>
              <Button
                color="red"
                onClick={() => void cancelInvitation()}
                loading={cancelling}
                disabled={cancelReason.trim().length < 3}
              >
                确认撤销
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </AdminLayout>
  );
};

export default AdminAccountInvitations;
