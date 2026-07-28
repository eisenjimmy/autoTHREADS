import { useApp } from '../store/appStore'

interface Props {
  onClose(): void
}

export default function ThreadsTokenHelp({ onClose }: Props) {
  const language = useApp((s) => s.settings?.language)
  const ko = language === 'ko'
  const t = (en: string, kr: string) => (ko ? kr : en)

  return (
    <div className="modal-backdrop">
      <div
        className="confirm-modal token-help"
        role="dialog"
        aria-modal="true"
        aria-label={t('Get Threads access token', 'Threads 액세스 토큰 받기')}
      >
        <div className="confirm-title">{t('Get a Threads access token', 'Threads 액세스 토큰 받기')}</div>
        <ol className="help-list">
          <li>{t('Open Meta Developers and select your app.', 'Meta Developers에서 앱을 선택하세요.')}</li>
          <li>
            {t(
              'Add the Threads API use case if it is not already added.',
              'Threads API use case가 없으면 추가하세요.'
            )}
          </li>
          <li>{t('Open Threads API settings.', 'Threads API 설정을 여세요.')}</li>
          <li>
            {t(
              'Click Add or Remove Threads Testers and add your Threads account.',
              'Add or Remove Threads Testers에서 본인 Threads 계정을 추가하세요.'
            )}
          </li>
          <li>
            {t(
              'Accept the tester invite in Threads if Meta asks.',
              'Meta가 요청하면 Threads에서 테스터 초대를 수락하세요.'
            )}
          </li>
          <li>
            {t(
              'Return to User Token Generator and generate a token.',
              'User Token Generator로 돌아가 토큰을 생성하세요.'
            )}
          </li>
          <li>
            {t(
              'Include permissions for publishing, replies, and mentions (',
              '게시·답글·멘션 권한을 포함하세요 ('
            )}
            <code>threads_manage_mentions</code>
            {t(
              ' is required for Full-Auto to answer @mentions).',
              ' 은 완전 자동 @멘션 응대에 필요합니다).'
            )}
          </li>
          <li>
            {t(
              'Paste that token into AutoThreads. Leave User ID blank unless testing tells you otherwise.',
              'AutoThreads에 토큰을 붙여넣으세요. 보통 User ID는 비워 둡니다.'
            )}
          </li>
        </ol>
        <div className="help-note">
          {t(
            'Keep the token private. AutoThreads stores it encrypted with your OS keychain. If mentions never show up, regenerate the token with',
            '토큰은 비공개로 유지하세요. AutoThreads는 OS 키체인으로 암호화 저장합니다. 멘션이 안 보이면 다음 권한으로 토큰을 다시 발급하세요:'
          )}{' '}
          <code>threads_manage_mentions</code>.
        </div>
        <div className="confirm-actions">
          <button className="btn primary" onClick={onClose}>
            {t('Got it', '확인')}
          </button>
        </div>
      </div>
    </div>
  )
}
