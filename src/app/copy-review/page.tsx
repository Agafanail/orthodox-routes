import type { Metadata } from 'next';
import { CopyReview } from './copy-review';

export const metadata: Metadata = {
  title: 'Russian UX copy review | Orthodox Routes',
  description: 'Isolated temporary surface for manual owner review of proposed Russian UX copy.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function CopyReviewPage() {
  return <CopyReview />;
}
