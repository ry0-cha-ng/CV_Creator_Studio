import { lazy, Suspense } from 'react';

/** 競合タブは開いたときに読み込む。ほかの分析タブの初期表示に影響させない。 */
const CompetitorsRoot = lazy(() => import('./CompetitorsRoot'));

export const CompetitorsTab = () => (
  <Suspense fallback={<p className="an-muted" style={{ padding: '24px 32px' }}>競合を読み込んでいます…</p>}>
    <CompetitorsRoot />
  </Suspense>
);
