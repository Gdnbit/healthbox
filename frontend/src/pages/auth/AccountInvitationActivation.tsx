/* eslint-disable i18next/no-literal-string -- Public activation is Chinese-first */
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NativeSelect,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconShieldCheck,
  IconUserPlus,
} from '@tabler/icons-react';
import accountInvitationApi, {
  type AccountGender,
  type AccountInvitationActivationResult,
  type AccountInvitationInspection,
} from '../../services/api/accountInvitationApi';
import { consumeInvitationToken } from '../../services/accountInvitationTokenVault';
import './account-invitation-activation.css';

type PageState = 'loading' | 'ready' | 'unavailable' | 'activated' | 'declined';

const genderOptions = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
  { value: 'other', label: '其他' },
  { value: 'prefer_not_to_say', label: '暂不说明' },
];

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

const formatExpiry = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const AccountInvitationActivation = () => {
  const [token] = useState(() => consumeInvitationToken());
  const [pageState, setPageState] = useState<PageState>(
    token ? 'loading' : 'unavailable'
  );
  const [inspection, setInspection] =
    useState<AccountInvitationInspection | null>(null);
  const [activationResult, setActivationResult] =
    useState<AccountInvitationActivationResult | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<AccountGender | ''>('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declineOpened, setDeclineOpened] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    let active = true;
    accountInvitationApi
      .inspectInvitation(token)
      .then(response => {
        if (!active) return;
        setInspection(response);
        setPageState('ready');
      })
      .catch(() => {
        if (!active) return;
        setPageState('unavailable');
      });

    return () => {
      active = false;
    };
  }, [token]);

  const normalizedUsername = username.trim().toLowerCase();
  const passwordBytes = utf8ByteLength(password);
  const passwordValid =
    passwordBytes >= 10 &&
    passwordBytes <= 72 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password) &&
    (!normalizedUsername ||
      !password.toLowerCase().includes(normalizedUsername));
  const usernameValid = /^[a-zA-Z0-9_-]{3,50}$/.test(normalizedUsername);
  const birthDateValid =
    Boolean(birthDate) && birthDate <= new Date().toISOString().slice(0, 10);
  const formValid = useMemo(
    () =>
      displayName.trim().length >= 2 &&
      usernameValid &&
      birthDateValid &&
      Boolean(gender) &&
      passwordValid &&
      password === passwordConfirmation &&
      noticeAccepted,
    [
      birthDateValid,
      displayName,
      gender,
      noticeAccepted,
      password,
      passwordConfirmation,
      passwordValid,
      usernameValid,
    ]
  );

  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !inspection || !formValid || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await accountInvitationApi.activateInvitation({
        token,
        username: normalizedUsername,
        display_name: displayName.trim(),
        birth_date: birthDate,
        gender: gender as AccountGender,
        password,
        privacy_notice_version: inspection.privacy_notice.notice_version,
        privacy_notice_accepted: true,
      });
      setActivationResult(result);
      setPassword('');
      setPasswordConfirmation('');
      setPageState('activated');
    } catch {
      setError(
        '暂时无法创建账号。请检查用户名和密码，或联系管理员确认邀请是否仍然有效。'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await accountInvitationApi.declineInvitation(token);
      setPageState('declined');
      setDeclineOpened(false);
    } catch {
      setDeclineOpened(false);
      setError('暂时无法完成操作，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  if (pageState === 'loading') {
    return (
      <main className="health-prototype account-activation-page">
        <section
          className="account-activation-card account-activation-card--status"
          aria-live="polite"
        >
          <Loader color="teal" />
          <Text>正在确认邀请链接…</Text>
        </section>
      </main>
    );
  }

  if (pageState === 'unavailable') {
    return (
      <main className="health-prototype account-activation-page">
        <section className="account-activation-card account-activation-card--status">
          <span className="account-activation-card__status-icon">
            <IconAlertCircle size={30} aria-hidden="true" />
          </span>
          <Title order={1}>这个邀请链接无法使用</Title>
          <Text c="dimmed">
            链接可能已经过期、被使用或被管理员撤销。请联系管理员重新发送。
          </Text>
          <Button component="a" href="/login" variant="light">
            返回登录
          </Button>
        </section>
      </main>
    );
  }

  if (pageState === 'activated') {
    return (
      <main className="health-prototype account-activation-page">
        <section className="account-activation-card account-activation-card--status">
          <span className="account-activation-card__status-icon account-activation-card__status-icon--success">
            <IconCheck size={30} aria-hidden="true" />
          </span>
          <Title order={1}>账号已经创建</Title>
          <Text c="dimmed">
            欢迎，{activationResult?.display_name}
            。系统不会自动登录，请使用刚才设置的账号密码进入。
          </Text>
          <Button
            component="a"
            href={activationResult?.login_path || '/login'}
            rightSection={<IconArrowRight size={18} aria-hidden="true" />}
          >
            前往登录
          </Button>
        </section>
      </main>
    );
  }

  if (pageState === 'declined') {
    return (
      <main className="health-prototype account-activation-page">
        <section className="account-activation-card account-activation-card--status">
          <span className="account-activation-card__status-icon">
            <IconShieldCheck size={30} aria-hidden="true" />
          </span>
          <Title order={1}>已选择暂不加入</Title>
          <Text c="dimmed">
            没有创建账号，也没有保存你的个人资料。如需加入，请联系管理员获取新链接。
          </Text>
          <Button component="a" href="/login" variant="light">
            返回登录
          </Button>
        </section>
      </main>
    );
  }

  if (!inspection) return null;
  const notice = inspection.privacy_notice;

  return (
    <main className="health-prototype account-activation-page">
      <article
        className="account-activation-card"
        aria-labelledby="account-activation-title"
      >
        <header className="account-activation-header">
          <img src="/healthbox-icon.svg" alt="" width={48} height={48} />
          <div>
            <Text className="account-activation-header__eyebrow">
              受邀成员专用
            </Text>
            <Title id="account-activation-title" order={1}>
              创建你的 HealthBox 账号
            </Title>
            <Text>
              你将拥有自己的账号和独立健康档案。先阅读说明，再填写基本资料。
            </Text>
          </div>
        </header>

        <div className="account-activation-expiry">
          <IconClock size={18} aria-hidden="true" />
          <Text size="sm">
            请在 {formatExpiry(inspection.expires_at)} 前完成
          </Text>
        </div>

        <section
          className="account-activation-notice"
          aria-labelledby="account-activation-notice-title"
        >
          <Text className="account-activation-notice__kicker">
            {notice.kicker}
          </Text>
          <Title id="account-activation-notice-title" order={2}>
            {notice.title}
          </Title>
          <Text className="account-activation-notice__summary">
            {notice.summary}
          </Text>

          <div className="account-activation-notice__sections">
            {notice.sections.map((section, index) => (
              <section
                key={section.key}
                className="account-activation-notice__section"
              >
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <Title order={3}>{section.title}</Title>
                  <Text>{section.body}</Text>
                </div>
              </section>
            ))}
          </div>

          <div className="account-activation-external-boundary">
            <IconExternalLink size={20} aria-hidden="true" />
            <div>
              <Text fw={700}>{notice.external_processing_title}</Text>
              <Text size="sm">{notice.external_processing_body}</Text>
            </div>
          </div>
        </section>

        <form
          className="account-activation-form"
          onSubmit={event => void activate(event)}
        >
          <div>
            <Group gap="sm">
              <IconUserPlus size={22} aria-hidden="true" />
              <Title order={2}>填写账号资料</Title>
            </Group>
            <Text c="dimmed" size="sm" mt={5}>
              这些资料用于识别你自己的档案。健康报告需要登录后由你本人上传。
            </Text>
          </div>

          <div className="account-activation-form__grid">
            <TextInput
              label="显示名"
              aria-label="显示名"
              placeholder="家人和朋友看到的名字"
              value={displayName}
              onChange={event => setDisplayName(event.currentTarget.value)}
              minLength={2}
              maxLength={100}
              required
            />
            <TextInput
              label="登录用户名"
              aria-label="登录用户名"
              placeholder="3–50 位字母、数字、_ 或 -"
              value={username}
              onChange={event => setUsername(event.currentTarget.value)}
              error={
                username && !usernameValid
                  ? '只能使用 3–50 位字母、数字、下划线或短横线'
                  : undefined
              }
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
            <TextInput
              type="date"
              label="出生日期"
              aria-label="出生日期"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={event => setBirthDate(event.currentTarget.value)}
              required
            />
            <NativeSelect
              label="性别"
              aria-label="性别"
              data={[{ value: '', label: '请选择' }, ...genderOptions]}
              value={gender}
              onChange={event =>
                setGender(event.currentTarget.value as AccountGender | '')
              }
              required
            />
            <PasswordInput
              label="设置密码"
              aria-label="设置密码"
              placeholder="至少 10 字节，须有字母和数字"
              value={password}
              onChange={event => setPassword(event.currentTarget.value)}
              error={
                password && !passwordValid
                  ? '密码需为 10–72 字节，包含字母和数字，且不能包含用户名'
                  : undefined
              }
              autoComplete="new-password"
              required
            />
            <PasswordInput
              label="再次输入密码"
              aria-label="再次输入密码"
              placeholder="再次输入同一个密码"
              value={passwordConfirmation}
              onChange={event =>
                setPasswordConfirmation(event.currentTarget.value)
              }
              error={
                passwordConfirmation && password !== passwordConfirmation
                  ? '两次输入的密码不一致'
                  : undefined
              }
              autoComplete="new-password"
              required
            />
          </div>

          <Checkbox
            className="account-activation-confirmation"
            label={notice.confirmation_text}
            checked={noticeAccepted}
            onChange={event => setNoticeAccepted(event.currentTarget.checked)}
          />

          {error ? (
            <Alert
              color="red"
              icon={<IconAlertCircle size={19} aria-hidden="true" />}
              title="没有完成创建"
            >
              {error}
            </Alert>
          ) : null}

          <footer className="account-activation-form__footer">
            <Text size="xs" c="dimmed">
              {notice.version_label}：{notice.notice_version}
            </Text>
            <div className="account-activation-form__actions">
              <Button
                type="button"
                variant="default"
                onClick={() => setDeclineOpened(true)}
                disabled={submitting}
              >
                {notice.decline_label}
              </Button>
              <Button
                type="submit"
                loading={submitting}
                disabled={!formValid}
                rightSection={<IconArrowRight size={18} aria-hidden="true" />}
              >
                创建账号
              </Button>
            </div>
          </footer>
        </form>
      </article>

      <Modal
        opened={declineOpened}
        onClose={() => {
          if (!submitting) setDeclineOpened(false);
        }}
        title="确定暂不加入吗？"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            确认后这份邀请会立即失效，不会创建账号，也不会保存表单内容。
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeclineOpened(false)}
              disabled={submitting}
            >
              继续填写
            </Button>
            <Button
              color="red"
              onClick={() => void decline()}
              loading={submitting}
            >
              确认暂不加入
            </Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
};

export default AccountInvitationActivation;
