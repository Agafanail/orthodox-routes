import type { Metadata } from 'next';
import { DesignPreview } from './design-preview';

export const metadata: Metadata = {
  title: 'Initial Design System Preview | Orthodox Routes',
  description: 'Isolated development preview for the Orthodox Routes Initial Design System.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignPreviewPage() {
  return <DesignPreview />;
}
